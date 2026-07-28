'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { apiPost, newIdempotencyKey, toUserMessage } from '@/lib/api-client';
import { APPLICATION_STATUS_LABEL, formatFullDateTimeKo, labelOf } from '@/lib/format';
import type { ApplicationStatus, NotificationCategory, NotificationChannel } from '@/types/api';

import { AdminPage, Notice, Panel } from '../../_components/console';
import {
  BROADCAST_SEGMENT_HINT,
  BROADCAST_SEGMENT_LABEL,
  NOTIFICATION_CATEGORY_LABEL,
  NOTIFICATION_CHANNEL_LABEL,
  toOptions,
} from '../../_lib/labels';
import { useAdminAction } from '../../_lib/use-admin-action';
import type {
  AdminBroadcast,
  AdminBroadcastSegment,
  CreateBroadcastBody,
} from '../../_lib/types';

/** 이벤트를 지정해야 하는 세그먼트. 서버가 eventId 없이는 400 을 준다. */
const EVENT_SCOPED: AdminBroadcastSegment[] = [
  'EVENT_APPLICANTS',
  'EVENT_APPLICANTS_BY_STATUS',
  'EVENT_SELECTED',
  'EVENT_NOT_SELECTED',
];

const APPLICATION_STATUS_KEYS: ApplicationStatus[] = [
  'PENDING_DEPOSIT',
  'VALID',
  'CONFIRMED',
  'NOT_SELECTED',
  'EXPIRED',
  'CANCELED',
  'REJECTED',
  'EVENT_CANCELED',
];

/**
 * 공지 작성. (D-10)
 *
 * 두 가지가 이 화면의 핵심이다.
 *
 * 1. **멱등키를 화면이 붙잡고 있는다.** 작성 화면에 들어올 때 한 번 만들고 재시도에도
 *    같은 값을 쓴다. 매번 새로 만들면 네트워크가 한 번 끊겼을 때 같은 공지가 두 개 생기고,
 *    그건 수천 명에게 같은 알림을 두 번 보낸다는 뜻이다.
 * 2. **작성이 곧 발송이 아니다.** 여기서는 초안(또는 예약)만 만들고, 실제 팬아웃은
 *    상세 화면에서 한 번 더 확인한 뒤 실행한다. 되돌릴 수 없는 일에 확인 단계를 하나 둔다.
 */
export default function NewBroadcastPage() {
  const router = useRouter();

  // 화면당 하나. 재시도해도 같은 키가 나가야 공지가 두 번 만들어지지 않는다.
  const idempotencyKey = useRef(newIdempotencyKey());

  const [segment, setSegment] = useState<AdminBroadcastSegment | ''>('');
  const [titleKo, setTitleKo] = useState('');
  const [bodyKo, setBodyKo] = useState('');
  const [channels, setChannels] = useState<NotificationChannel[]>(['IN_APP']);
  const [category, setCategory] = useState<NotificationCategory>('ANNOUNCEMENT');
  const [eventId, setEventId] = useState('');
  const [statuses, setStatuses] = useState<ApplicationStatus[]>([]);
  const [regionCode, setRegionCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [inactiveDays, setInactiveDays] = useState('90');
  const [userIdsText, setUserIdsText] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');

  const create = useAdminAction(
    (body: CreateBroadcastBody) =>
      apiPost<AdminBroadcast>('/api/admin/broadcasts', body, {
        // 서버가 본문의 idempotencyKey 로 중복을 막는다. 헤더가 아니라 본문인 이유는
        // Broadcast.idempotencyKey 가 전역 유니크 컬럼이기 때문이다.
        idempotencyKey: idempotencyKey.current,
      }),
    {
      successTitle: '공지를 만들었습니다',
      successDescription: '아직 보내지 않았습니다. 상세에서 발송을 실행하세요.',
      silentError: true,
      onDone: (data) => router.push(`/admin/broadcasts/${data.id}`),
    },
  );

  const userIds = useMemo(
    () =>
      userIdsText
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    [userIdsText],
  );

  const needsEvent = segment !== '' && EVENT_SCOPED.includes(segment);
  const needsStatuses = segment === 'EVENT_APPLICANTS_BY_STATUS';
  const needsRegion = segment === 'REGION';
  const needsCategory = segment === 'CATEGORY_INTEREST';
  const needsInactive = segment === 'INACTIVE_USERS';
  const needsUserList = segment === 'EXPLICIT_USER_LIST';

  const inactiveDaysNumber = Number(inactiveDays);
  const inactiveValid =
    !needsInactive ||
    (Number.isInteger(inactiveDaysNumber) && inactiveDaysNumber >= 7 && inactiveDaysNumber <= 3650);

  const scheduledAt = scheduledLocal ? new Date(scheduledLocal) : null;
  const scheduleValid = !scheduledAt || (!Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now());

  const ready =
    segment !== '' &&
    titleKo.trim().length > 0 &&
    bodyKo.trim().length > 0 &&
    channels.length > 0 &&
    (!needsEvent || eventId.trim().length > 0) &&
    (!needsStatuses || statuses.length > 0) &&
    (!needsRegion || regionCode.trim().length > 0) &&
    (!needsCategory || categoryId.trim().length > 0) &&
    (!needsUserList || (userIds.length > 0 && userIds.length <= 500)) &&
    inactiveValid &&
    scheduleValid;

  const submit = () => {
    // ready의 첫 조건이 segment !== '' 라, 여기를 통과하면 TS가 이미 좁혀 준다.
    if (!ready) return;

    create.mutate({
      segment,
      titleKo: titleKo.trim(),
      bodyKo: bodyKo.trim(),
      channels,
      category,
      idempotencyKey: idempotencyKey.current,
      ...(needsEvent ? { eventId: eventId.trim() } : {}),
      ...(needsStatuses ? { applicationStatuses: statuses } : {}),
      ...(needsRegion ? { regionCode: regionCode.trim() } : {}),
      ...(needsCategory ? { categoryId: categoryId.trim() } : {}),
      ...(needsInactive ? { inactiveDays: inactiveDaysNumber } : {}),
      ...(needsUserList ? { userIds } : {}),
      ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
    });
  };

  const toggleChannel = (channel: NotificationChannel) => {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((item) => item !== channel) : [...prev, channel],
    );
  };

  const toggleStatus = (status: ApplicationStatus) => {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status],
    );
  };

  return (
    <AdminPage
      back={{ href: '/admin/broadcasts', label: '공지 목록' }}
      title="공지 작성"
      description="여기서는 만들기만 합니다. 실제 발송은 다음 화면에서 한 번 더 확인한 뒤 실행해요."
    >
      <Notice tone="warning" title="공지 문구에 넣으면 안 되는 것">
        다른 사람의 신청 금액, 개인 순위, 커트라인은 어떤 문구에도 들어가면 안 됩니다.
        &ldquo;8만원에 밀리셨습니다&rdquo; 같은 문장은 커트라인을 그대로 알려주는 것과 같아요.
        기간 중 공개할 수 있는 경쟁 정보는 <strong>경쟁률뿐</strong>입니다.
      </Notice>

      <Panel title="받는 사람">
        <div className="space-y-4">
          <Field
            label="세그먼트"
            htmlFor="broadcast-segment"
            required
            hint={
              segment && BROADCAST_SEGMENT_HINT[segment]
                ? BROADCAST_SEGMENT_HINT[segment]
                : '대상 조건은 공지에 그대로 저장됩니다. 발송이 나중에 일어나도 같은 기준이 쓰여요.'
            }
          >
            <Select
              id="broadcast-segment"
              value={segment}
              placeholder="누구에게 보낼까요?"
              options={toOptions(BROADCAST_SEGMENT_LABEL)}
              onChange={(event) => setSegment(event.currentTarget.value as AdminBroadcastSegment)}
            />
          </Field>

          {needsEvent ? (
            <Field
              label="이벤트 ID"
              htmlFor="broadcast-event-id"
              required
              hint="이벤트 운영 화면에서 ID 를 복사해 붙여 넣으세요."
            >
              <Input
                id="broadcast-event-id"
                value={eventId}
                onChange={(event) => setEventId(event.currentTarget.value)}
                placeholder="clx..."
                autoComplete="off"
              />
            </Field>
          ) : null}

          {needsStatuses ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">
                신청 상태 <span className="text-primary">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {APPLICATION_STATUS_KEYS.map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={statuses.includes(status)}
                      onChange={() => toggleStatus(status)}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    {labelOf(APPLICATION_STATUS_LABEL, status)}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {needsRegion ? (
            <Field
              label="지역 코드"
              htmlFor="broadcast-region"
              required
              hint="이용자가 관심 지역으로 저장해 둔 코드와 대조합니다."
            >
              <Input
                id="broadcast-region"
                value={regionCode}
                onChange={(event) => setRegionCode(event.currentTarget.value)}
                maxLength={10}
                autoComplete="off"
              />
            </Field>
          ) : null}

          {needsCategory ? (
            <Field label="업종 ID" htmlFor="broadcast-category-id" required>
              <Input
                id="broadcast-category-id"
                value={categoryId}
                onChange={(event) => setCategoryId(event.currentTarget.value)}
                autoComplete="off"
              />
            </Field>
          ) : null}

          {needsInactive ? (
            <Field
              label="마지막 로그인 기준 일수"
              htmlFor="broadcast-inactive"
              required
              hint="7일 ~ 3650일. 이 기간 동안 로그인하지 않은 계정에 보냅니다."
            >
              <Input
                id="broadcast-inactive"
                type="number"
                inputMode="numeric"
                min={7}
                max={3650}
                value={inactiveDays}
                onChange={(event) => setInactiveDays(event.currentTarget.value)}
                trailing="일"
                {...(inactiveValid ? {} : { error: '7 ~ 3650 사이의 정수여야 합니다.' })}
              />
            </Field>
          ) : null}

          {needsUserList ? (
            <Field
              label="계정 ID 목록"
              htmlFor="broadcast-user-ids"
              required
              hint={`한 줄에 하나씩, 최대 500개. 지금 ${userIds.length}개 인식했습니다.`}
            >
              <Textarea
                id="broadcast-user-ids"
                value={userIdsText}
                onChange={(event) => setUserIdsText(event.currentTarget.value)}
                placeholder={'clx...\nclx...'}
                className="min-h-[120px] font-mono text-sm"
                {...(userIds.length > 500 ? { error: '한 번에 500개까지만 보낼 수 있습니다.' } : {})}
              />
            </Field>
          ) : null}
        </div>
      </Panel>

      <Panel title="내용">
        <div className="space-y-4">
          <Field label="제목" htmlFor="broadcast-title" required>
            <Input
              id="broadcast-title"
              value={titleKo}
              onChange={(event) => setTitleKo(event.currentTarget.value)}
              maxLength={120}
              placeholder="알림함에 굵게 뜨는 한 줄"
            />
          </Field>

          <Field
            label="본문"
            htmlFor="broadcast-body"
            required
            hint="앱 내 알림과 이메일에 같은 문구가 나갑니다."
          >
            <Textarea
              id="broadcast-body"
              value={bodyKo}
              onChange={(event) => setBodyKo(event.currentTarget.value)}
              maxLength={5000}
              showCount
              className="min-h-[180px]"
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">
              채널 <span className="text-primary">*</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {(['IN_APP', 'EMAIL'] as const).map((channel) => (
                <label
                  key={channel}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={channels.includes(channel)}
                    onChange={() => toggleChannel(channel)}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  {labelOf(NOTIFICATION_CHANNEL_LABEL, channel)}
                </label>
              ))}
            </div>
            {channels.includes('EMAIL') ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                이메일은 발송 아웃박스를 거쳐 나갑니다. 수신 거부한 사람에게는 가지 않아요.
              </p>
            ) : null}
          </fieldset>

          <Field
            label="알림 분류"
            htmlFor="broadcast-category"
            hint="이용자의 알림 설정이 이 분류로 수신 여부를 정합니다. 마케팅으로 보내면 동의한 사람에게만 갑니다."
          >
            <Select
              id="broadcast-category"
              value={category}
              options={toOptions(NOTIFICATION_CATEGORY_LABEL)}
              onChange={(event) =>
                setCategory(event.currentTarget.value as NotificationCategory)
              }
            />
          </Field>
        </div>
      </Panel>

      <Panel title="발송 시각">
        <Field
          label="예약 발송 (선택)"
          htmlFor="broadcast-schedule"
          hint={
            scheduledAt && !Number.isNaN(scheduledAt.getTime())
              ? `${formatFullDateTimeKo(scheduledAt)} 에 발송 예약됩니다. 입력한 시각은 이 브라우저의 시간대 기준으로 해석했습니다.`
              : '비워 두면 초안으로 만들어집니다. 발송은 상세 화면에서 직접 실행해요.'
          }
        >
          <Input
            id="broadcast-schedule"
            type="datetime-local"
            value={scheduledLocal}
            onChange={(event) => setScheduledLocal(event.currentTarget.value)}
            {...(scheduleValid ? {} : { error: '예약 시각은 현재보다 뒤여야 합니다.' })}
          />
        </Field>
      </Panel>

      {create.isError ? <Notice tone="danger">{toUserMessage(create.error)}</Notice> : null}

      <div className="flex flex-wrap items-center justify-end gap-2 pb-6">
        <Button variant="outline" onClick={() => router.back()} disabled={create.isPending}>
          취소
        </Button>
        <Button onClick={submit} disabled={!ready} loading={create.isPending}>
          공지 만들기
        </Button>
      </div>
    </AdminPage>
  );
}
