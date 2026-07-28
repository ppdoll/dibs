'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { Badge, Button, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { apiGet, apiPost, toUserMessage } from '@/lib/api-client';
import { APPLICATION_STATUS_LABEL, formatFullDateTimeKo, formatNumber, labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';

import { ActionButton, ActionDialog } from '../../_components/action-dialog';
import {
  ActionRow,
  AdminPage,
  CopyableId,
  KeyValue,
  KeyValueGrid,
  Notice,
  Panel,
  TimeCell,
} from '../../_components/console';
import {
  BROADCAST_SEGMENT_LABEL,
  BROADCAST_STATUS_LABEL,
  BROADCAST_STATUS_TONE,
  NOTIFICATION_CATEGORY_LABEL,
  NOTIFICATION_CHANNEL_LABEL,
} from '../../_lib/labels';
import { useAdminAction } from '../../_lib/use-admin-action';
import type { AdminBroadcast, AdminBroadcastSendResult } from '../../_lib/types';

/**
 * 공지 상세 · 발송.
 *
 * 발송은 **여러 번 불려도 안전하다** — 팬아웃 전 구간이 중복을 건너뛰게 되어 있고,
 * 대상이 많으면 배치로 나눠 `hasMore: true` 를 돌려준다. 그래서 화면은 자동으로 이어
 * 보내지 않고 버튼을 남긴다. 자동 반복은 함수 타임아웃과 겹치면 무슨 일이 어디까지
 * 됐는지 사람이 못 따라가는데, 이건 수천 명에게 나가는 일이라 그러면 안 된다.
 */
export function BroadcastDetail({ broadcastId }: { broadcastId: string }) {
  const [pendingBatch, setPendingBatch] = useState<AdminBroadcastSendResult | null>(null);

  const query = useQuery({
    queryKey: qk.admin.broadcastDetail(broadcastId),
    queryFn: () => apiGet<AdminBroadcast>(`/api/admin/broadcasts/${broadcastId}`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'SENDING' || status === 'EXPANDING' ? 10_000 : false;
    },
  });

  const broadcast = query.data;

  const approve = useAdminAction(
    () => apiPost<AdminBroadcast>(`/api/admin/broadcasts/${broadcastId}/approve`),
    { successTitle: '공지를 승인했습니다', onDone: () => void query.refetch() },
  );

  const send = useAdminAction(
    () => apiPost<AdminBroadcastSendResult>(`/api/admin/broadcasts/${broadcastId}/send`),
    {
      successTitle: '발송을 실행했습니다',
      onDone: (data) => {
        setPendingBatch(data.hasMore ? data : null);
        void query.refetch();
      },
    },
  );

  const cancel = useAdminAction(
    (reason: string) =>
      apiPost<AdminBroadcast>(
        `/api/admin/broadcasts/${broadcastId}/cancel`,
        reason ? { reason } : {},
      ),
    { successTitle: '공지를 취소했습니다', onDone: () => void query.refetch() },
  );

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.isError || !broadcast) {
    return (
      <ErrorState
        title="공지를 불러오지 못했어요"
        description={toUserMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const canApprove = broadcast.status === 'PENDING_APPROVAL';
  const canSchedule = broadcast.status === 'DRAFT' || broadcast.status === 'SCHEDULED';
  const canSend =
    broadcast.status === 'DRAFT' ||
    broadcast.status === 'SCHEDULED' ||
    broadcast.status === 'SENDING';
  const canCancel =
    broadcast.status === 'DRAFT' ||
    broadcast.status === 'PENDING_APPROVAL' ||
    broadcast.status === 'SCHEDULED';

  const progress =
    broadcast.totalRecipients > 0
      ? Math.min(100, Math.round((broadcast.sentCount / broadcast.totalRecipients) * 100))
      : 0;

  return (
    <AdminPage
      back={{ href: '/admin/broadcasts', label: '공지 목록' }}
      title={broadcast.titleKo}
      description={labelOf(BROADCAST_SEGMENT_LABEL, broadcast.segment)}
      actions={
        <Badge variant={BROADCAST_STATUS_TONE[broadcast.status] ?? 'muted'}>
          {labelOf(BROADCAST_STATUS_LABEL, broadcast.status)}
        </Badge>
      }
    >
      {pendingBatch?.hasMore ? (
        <Notice tone="warning" title="아직 다 보내지 못했습니다">
          이번 호출에서 {formatNumber(pendingBatch.deliveredThisCall)}명에게 보냈고, 남은 대상이
          있습니다. 아래 <strong>이어서 발송</strong>을 눌러 마저 보내 주세요. 이미 받은 사람에게
          다시 가지는 않습니다.
        </Notice>
      ) : null}

      {broadcast.status === 'PENDING_APPROVAL' ? (
        <Notice tone="warning" title="다른 운영자의 승인이 필요합니다">
          작성자 본인은 승인할 수 없습니다. 승인 없이는 발송이 시작되지 않아요.
        </Notice>
      ) : null}

      {broadcast.status === 'SENT' ? (
        <Notice tone="info" title="발송이 끝났습니다">
          이미 나간 쪽지는 회수할 수 없습니다.
        </Notice>
      ) : null}

      <Panel title="발송 조치">
        <ActionRow>
          {canApprove ? (
            <ActionButton
              label="승인"
              variant="primary"
              size="md"
              pending={approve.isPending}
              onConfirm={(_reason, close) => {
                approve.mutate(undefined);
                close();
              }}
              dialog={{
                title: '이 공지를 승인할까요?',
                description:
                  '승인하면 발송할 수 있는 상태가 됩니다. 승인만으로 바로 나가지는 않아요.',
                confirmLabel: '승인',
              }}
            />
          ) : null}

          {canSchedule ? (
            <ScheduleButton broadcastId={broadcastId} current={broadcast.scheduledAt} onDone={() => void query.refetch()} />
          ) : null}

          {canSend ? (
            <ActionButton
              label={broadcast.status === 'SENDING' ? '이어서 발송' : '지금 발송'}
              variant="primary"
              size="md"
              pending={send.isPending}
              onConfirm={(_reason, close) => {
                send.mutate(undefined);
                close();
              }}
              dialog={{
                title:
                  broadcast.status === 'SENDING'
                    ? '남은 대상에게 이어서 보낼까요?'
                    : '지금 발송할까요?',
                confirmLabel: broadcast.status === 'SENDING' ? '이어서 발송' : '발송',
                destructive: broadcast.status !== 'SENDING',
                warning:
                  broadcast.status === 'SENDING'
                    ? '중단된 지점부터 이어서 보냅니다. 이미 받은 사람에게 다시 가지 않습니다.'
                    : '보낸 쪽지는 회수할 수 없습니다. 제목과 본문을 한 번 더 읽어 주세요. 대상이 많으면 한 번에 끝나지 않고 이어서 보내야 합니다.',
              }}
            />
          ) : null}

          {canCancel ? (
            <ActionButton
              label="공지 취소"
              variant="destructive"
              size="md"
              pending={cancel.isPending}
              onConfirm={(reason, close) => {
                cancel.mutate(reason);
                close();
              }}
              dialog={{
                title: '이 공지를 취소할까요?',
                confirmLabel: '공지 취소',
                destructive: true,
                warning:
                  '아직 나가지 않은 공지만 취소됩니다. 이미 발송된 쪽지는 회수할 수 없습니다.',
                reason: { label: '취소 사유', required: false },
              }}
            />
          ) : null}

          {!canApprove && !canSchedule && !canSend && !canCancel ? (
            <span className="text-sm text-muted-foreground">가능한 조치가 없습니다.</span>
          ) : null}
        </ActionRow>
      </Panel>

      <Panel title="발송 통계">
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-semibold tabular-nums">
                {formatNumber(broadcast.sentCount)} / {formatNumber(broadcast.totalRecipients)}명
              </span>
              <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="발송 진행률"
              />
            </div>
          </div>

          <KeyValueGrid>
            <KeyValue label="대상 인원">{formatNumber(broadcast.totalRecipients)}명</KeyValue>
            <KeyValue label="발송 완료">{formatNumber(broadcast.sentCount)}명</KeyValue>
            <KeyValue label="실패">
              {broadcast.failedCount > 0 ? (
                <span className="text-destructive">{formatNumber(broadcast.failedCount)}명</span>
              ) : (
                '0명'
              )}
            </KeyValue>
            <KeyValue label="대상 확정 시각">
              <TimeCell value={broadcast.audienceSnapshotAt} />
            </KeyValue>
          </KeyValueGrid>

          <p className="text-xs leading-relaxed text-muted-foreground">
            대상 인원은 발송을 시작하는 순간의 스냅샷입니다. 발송 도중 새로 가입한 사람은
            포함되지 않아요.
          </p>
        </div>
      </Panel>

      <Panel title="내용">
        <h3 className="text-base font-bold">{broadcast.titleKo}</h3>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{broadcast.bodyKo}</p>
      </Panel>

      <Panel title="설정">
        <KeyValueGrid>
          <KeyValue label="세그먼트">
            {labelOf(BROADCAST_SEGMENT_LABEL, broadcast.segment)}
          </KeyValue>
          <KeyValue label="알림 분류">
            {labelOf(NOTIFICATION_CATEGORY_LABEL, broadcast.category)}
          </KeyValue>
          <KeyValue label="채널">
            <span className="flex flex-wrap gap-1">
              {broadcast.channels.map((channel) => (
                <Badge key={channel} variant="outline" size="sm">
                  {labelOf(NOTIFICATION_CHANNEL_LABEL, channel)}
                </Badge>
              ))}
            </span>
          </KeyValue>
          <KeyValue label="예약 발송">
            {broadcast.scheduledAt ? formatFullDateTimeKo(broadcast.scheduledAt) : '없음'}
          </KeyValue>
          {broadcast.eventId ? (
            <KeyValue label="대상 이벤트">
              <Link
                href={`/admin/events/${broadcast.eventId}`}
                className="text-primary hover:underline"
              >
                이벤트 열기
              </Link>
            </KeyValue>
          ) : null}
          {broadcast.applicationStatuses.length > 0 ? (
            <KeyValue label="신청 상태 조건" full>
              <span className="flex flex-wrap gap-1">
                {broadcast.applicationStatuses.map((status) => (
                  <Badge key={status} variant="secondary" size="sm">
                    {labelOf(APPLICATION_STATUS_LABEL, status)}
                  </Badge>
                ))}
              </span>
            </KeyValue>
          ) : null}
          <KeyValue label="작성">
            <TimeCell value={broadcast.createdAt} />
          </KeyValue>
          <KeyValue label="승인">
            <TimeCell value={broadcast.approvedAt} />
          </KeyValue>
          <KeyValue label="취소">
            <TimeCell value={broadcast.canceledAt} />
          </KeyValue>
          <KeyValue label="공지 ID">
            <CopyableId value={broadcast.id} />
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <p className="text-xs text-muted-foreground">
        <Link
          href={`/admin/audit-logs?targetType=BROADCAST&targetId=${broadcast.id}`}
          className="font-semibold text-primary hover:underline"
        >
          이 공지의 감사 로그 보기
        </Link>
      </p>
    </AdminPage>
  );
}

/** 예약 시각 지정/변경. 발송이 시작된 뒤에는 서버가 막는다. */
function ScheduleButton({
  broadcastId,
  current,
  onDone,
}: {
  broadcastId: string;
  current: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState('');

  useEffect(() => {
    if (open) setLocal('');
  }, [open]);

  const schedule = useAdminAction(
    (scheduledAt: string) =>
      apiPost<AdminBroadcast>(`/api/admin/broadcasts/${broadcastId}/schedule`, { scheduledAt }),
    {
      successTitle: '발송 시각을 지정했습니다',
      onDone: () => {
        setOpen(false);
        onDone();
      },
    },
  );

  const parsed = local ? new Date(local) : null;
  const valid = parsed !== null && !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {current ? '예약 시각 변경' : '발송 예약'}
      </Button>

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title="언제 보낼까요?"
        description="예약해 두면 크론이 그 시각에 발송을 시작합니다."
        confirmLabel="예약"
        pending={schedule.isPending}
        canConfirm={valid}
        onConfirm={() => {
          if (!valid || !parsed) return;
          schedule.mutate(parsed.toISOString());
        }}
      >
        <Field
          label="발송 시각"
          htmlFor="broadcast-schedule-at"
          required
          hint={
            valid && parsed
              ? `${formatFullDateTimeKo(parsed)} 에 발송을 시작합니다. 입력값은 이 브라우저의 시간대로 해석했습니다.`
              : current
                ? `현재 예약: ${formatFullDateTimeKo(current)}`
                : '현재보다 뒤의 시각을 넣어 주세요.'
          }
        >
          <Input
            id="broadcast-schedule-at"
            type="datetime-local"
            value={local}
            onChange={(event) => setLocal(event.currentTarget.value)}
            {...(local && !valid ? { error: '현재보다 뒤여야 합니다.' } : {})}
          />
        </Field>
      </ActionDialog>
    </>
  );
}
