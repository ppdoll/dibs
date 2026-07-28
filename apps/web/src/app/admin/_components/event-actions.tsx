'use client';

import { useEffect, useState } from 'react';

import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { apiPost } from '@/lib/api-client';
import { formatFullDateTimeKo } from '@/lib/format';
import type { EventStatus } from '@/types/api';

import { ActionButton, ActionDialog } from './action-dialog';
import { ActionRow, Notice } from './console';
import { EVENT_CANCEL_REASON_LABEL, toOptions } from '../_lib/labels';
import { useAdminAction } from '../_lib/use-admin-action';
import type { AdminEventDetail, EventCancelReason } from '../_lib/types';

/**
 * 이벤트 운영 조치.
 *
 * 네 가지 모두 사람에게 영향이 간다. 그래서 문구가 "무엇이 일어나는가"를 끝까지 적는다 —
 * 특히 **강제 취소는 신청자 전원에게 알림이 나가고 되돌릴 수 없다.**
 *
 * 강제 마감·연장·취소는 낙관적 락 토큰(`version`)을 함께 보낸다(IC-63). 운영자가 보던
 * 화면과 실제 상태가 어긋난 채로 나가면 복구할 방법이 없기 때문이다. 토큰이 낡았으면
 * 서버가 409 로 되돌리고, 화면은 그 문구를 그대로 보여준 뒤 다시 읽게 한다.
 *
 * 정지/해제만 If-Match 가 없다. 정지는 **사고를 멈추는 조치**라, 낡은 토큰 때문에
 * 튕기는 동안에도 신청은 계속 들어오기 때문이다.
 */
export function EventActions({
  eventId,
  status,
  version,
  applyEndAt,
  liveApplicantCount,
  compact,
  onDone,
}: {
  eventId: string;
  status: EventStatus;
  version: number;
  applyEndAt: string;
  /** 알림이 나갈 대략의 인원. 문구에 그대로 넣는다. */
  liveApplicantCount: number;
  compact?: boolean;
  onDone?: () => void;
}) {
  const size = compact ? 'sm' : 'md';
  const done = onDone ? { onDone } : {};

  const suspend = useAdminAction(
    (reason: string) => apiPost<AdminEventDetail>(`/api/admin/events/${eventId}/suspend`, { reason }),
    {
      successTitle: '이벤트를 정지했습니다',
      successDescription: '공개 목록에서 즉시 빠집니다.',
      ...done,
    },
  );

  const unsuspend = useAdminAction(
    () => apiPost<AdminEventDetail>(`/api/admin/events/${eventId}/unsuspend`),
    { successTitle: '정지를 해제했습니다', successDescription: '정지 직전 상태로 돌아갑니다.', ...done },
  );

  const forceClose = useAdminAction(
    (reason: string) =>
      apiPost<AdminEventDetail>(`/api/admin/events/${eventId}/force-close`, {
        ifMatchVersion: version,
        reason,
      }),
    { successTitle: '이벤트를 강제 마감했습니다', ...done },
  );

  const canClose = status === 'OPEN';
  const canExtend = status === 'OPEN' || status === 'SCHEDULED';
  const canCancel = status !== 'CANCELED' && status !== 'FINALIZED';
  const isSuspended = status === 'SUSPENDED';

  return (
    <ActionRow>
      {canExtend ? (
        <ExtendDeadlineButton
          eventId={eventId}
          version={version}
          applyEndAt={applyEndAt}
          size={size}
          {...(onDone ? { onDone } : {})}
        />
      ) : null}

      {canClose ? (
        <ActionButton
          label="강제 마감"
          size={size}
          pending={forceClose.isPending}
          onConfirm={(reason, close) => {
            forceClose.mutate(reason);
            close();
          }}
          dialog={{
            title: '지금 강제로 마감할까요?',
            confirmLabel: '강제 마감',
            destructive: true,
            warning: (
              <>
                새 신청이 즉시 막힙니다. <strong>이미 예약금 시계가 돌고 있는 사람의 남은
                시간은 그대로 흐릅니다</strong> — 마감 1분 전에 신청한 사람도 자기 몫의 시간을
                다 쓸 수 있어야 하기 때문입니다. 파트너에게 마감 사실이 통보됩니다.
              </>
            ),
            reason: {
              label: '마감 사유',
              required: true,
              placeholder: '파트너에게 전달되는 문구입니다.',
            },
          }}
        />
      ) : null}

      {isSuspended ? (
        <ActionButton
          label="정지 해제"
          variant="primary"
          size={size}
          pending={unsuspend.isPending}
          onConfirm={(_reason, close) => {
            unsuspend.mutate(undefined);
            close();
          }}
          dialog={{
            title: '정지를 해제할까요?',
            description: '정지하기 직전 상태로 되돌아갑니다. 그 사이 마감 시각이 지났다면 마감 상태가 됩니다.',
            confirmLabel: '정지 해제',
          }}
        />
      ) : status !== 'CANCELED' ? (
        <ActionButton
          label="이벤트 정지"
          size={size}
          pending={suspend.isPending}
          onConfirm={(reason, close) => {
            suspend.mutate(reason);
            close();
          }}
          dialog={{
            title: '이 이벤트를 정지할까요?',
            confirmLabel: '이벤트 정지',
            destructive: true,
            warning:
              '공개 목록·검색에서 즉시 빠지고 새 신청이 막힙니다. 취소와 달리 되돌릴 수 있어요 — 해제하면 직전 상태로 돌아갑니다. 사고를 일단 멈춰야 할 때 쓰는 조치입니다.',
            reason: {
              label: '정지 사유',
              required: true,
              hint: '파트너 화면에 그대로 노출됩니다.',
            },
          }}
        />
      ) : null}

      {canCancel ? (
        <CancelEventButton
          eventId={eventId}
          version={version}
          liveApplicantCount={liveApplicantCount}
          size={size}
          {...(onDone ? { onDone } : {})}
        />
      ) : null}
    </ActionRow>
  );
}

/**
 * 마감 연장.
 *
 * 절대 시각이 아니라 **분**을 받는다. 운영자 브라우저의 시계와 서버 시계가 어긋나면
 * "10분 연장"이 과거로 가는 연장이 될 수 있고, 그러면 이미 열려 있는 예약금 홀드가
 * 순위 확정 시각보다 늦게 만료된다. 상한 24시간은 0 하나를 더 붙이는 실수를 막는다.
 */
function ExtendDeadlineButton({
  eventId,
  version,
  applyEndAt,
  size,
  onDone,
}: {
  eventId: string;
  version: number;
  applyEndAt: string;
  size: 'sm' | 'md';
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState('30');

  useEffect(() => {
    if (open) setMinutes('30');
  }, [open]);

  const extend = useAdminAction(
    (input: { extendMinutes: number; reason: string }) =>
      apiPost<AdminEventDetail>(`/api/admin/events/${eventId}/extend-deadline`, {
        ifMatchVersion: version,
        ...input,
      }),
    {
      successTitle: '마감을 연장했습니다',
      successDescription: '신청자에게는 "연장되었다"는 사실만 전달됩니다.',
      onDone: () => {
        setOpen(false);
        onDone?.();
      },
    },
  );

  const parsed = Number(minutes);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1_440;
  const preview =
    valid && applyEndAt
      ? formatFullDateTimeKo(new Date(new Date(applyEndAt).getTime() + parsed * 60_000))
      : null;

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        className={size === 'sm' ? 'h-8 px-2.5 text-xs' : undefined}
      >
        마감 연장
      </Button>

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title="마감을 연장할까요?"
        description="현재 마감 시각에 입력한 분을 더합니다. 순위 확정 시각도 함께 밀립니다."
        confirmLabel="연장"
        pending={extend.isPending}
        canConfirm={valid}
        warning="연장은 되돌릴 수 없습니다. 줄이는 경로는 없어요."
        reason={{
          label: '연장 사유',
          required: true,
          hint: '감사 로그에 남습니다. 신청자 알림 본문에는 들어가지 않아요.',
        }}
        onConfirm={(reason) => {
          if (!valid) return;
          extend.mutate({ extendMinutes: parsed, reason });
        }}
      >
        <Field
          label="연장할 시간 (분)"
          htmlFor="extend-minutes"
          required
          hint={
            preview
              ? `연장 후 마감: ${preview}`
              : '1분에서 1440분(24시간) 사이의 정수를 넣어 주세요.'
          }
        >
          <Input
            id="extend-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            value={minutes}
            onChange={(event) => setMinutes(event.currentTarget.value)}
            trailing="분"
            {...(minutes !== '' && !valid ? { error: '1 ~ 1440 사이의 정수여야 합니다.' } : {})}
          />
        </Field>

        <div className="flex flex-wrap gap-1.5">
          {[10, 30, 60, 120, 1440].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setMinutes(String(preset))}
              className="rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              {preset >= 60 ? `${preset / 60}시간` : `${preset}분`}
            </button>
          ))}
        </div>

        <Notice tone="info">
          신청자에게는 <strong>연장 사실만</strong> 알립니다. 금액·순위·커트라인은 어떤 문구에도
          들어가지 않습니다.
        </Notice>
      </ActionDialog>
    </>
  );
}

/**
 * 강제 취소.
 *
 * 콘솔에서 가장 무거운 버튼이다. 확인 창이 세 가지를 분명히 말해야 한다 —
 * 되돌릴 수 없다는 것, **신청자 전원에게 알림이 나간다는 것**, 그리고 몇 명인지.
 * 숫자를 적는 이유는 "3명"과 "1,200명"에 대한 판단이 다르기 때문이다.
 *
 * If-Match 는 헤더로 보낸다 — 이 엔드포인트만 본문이 아니라 헤더를 읽는다.
 */
function CancelEventButton({
  eventId,
  version,
  liveApplicantCount,
  size,
  onDone,
}: {
  eventId: string;
  version: number;
  liveApplicantCount: number;
  size: 'sm' | 'md';
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<EventCancelReason | ''>('');
  const [memo, setMemo] = useState('');
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (!open) return;
    setReasonCode('');
    setMemo('');
    setConfirmText('');
  }, [open]);

  const cancel = useAdminAction(
    (input: { reason: EventCancelReason; memo?: string }) =>
      apiPost<AdminEventDetail>(`/api/admin/events/${eventId}/cancel`, input, {
        headers: { 'If-Match': String(version) },
      }),
    {
      successTitle: '이벤트를 취소했습니다',
      successDescription: '신청자 전원에게 취소 알림이 발송됩니다.',
      onDone: () => {
        setOpen(false);
        onDone?.();
      },
    },
  );

  // 되돌릴 수 없는 조치라 "취소" 두 글자를 직접 치게 한다.
  // 확인 창을 습관적으로 넘기는 것을 막는 최소한의 마찰이다.
  const CONFIRM_WORD = '취소';
  const ready = reasonCode !== '' && confirmText.trim() === CONFIRM_WORD;

  return (
    <>
      <Button
        variant="destructive"
        size={size}
        onClick={() => setOpen(true)}
        className={size === 'sm' ? 'h-8 px-2.5 text-xs' : undefined}
      >
        강제 취소
      </Button>

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title="이 이벤트를 강제로 취소할까요?"
        confirmLabel="이벤트 취소"
        destructive
        pending={cancel.isPending}
        canConfirm={ready}
        warning={
          <>
            <strong>되돌릴 수 없습니다.</strong> 그리고 지금 살아 있는 신청{' '}
            <strong>{liveApplicantCount.toLocaleString('ko-KR')}건 전원에게 취소 알림이
            발송됩니다.</strong>{' '}
            신청은 모두 &ldquo;이벤트 취소&rdquo; 상태가 되고, 납부된 예약금은 환불 대상이 됩니다.
            같은 내용으로 다시 열려면 파트너가 이벤트를 새로 만들어야 합니다.
          </>
        }
        onConfirm={() => {
          if (!ready || !reasonCode) return;
          cancel.mutate({
            reason: reasonCode,
            ...(memo.trim() ? { memo: memo.trim() } : {}),
          });
        }}
      >
        <Field
          label="취소 사유 코드"
          htmlFor="cancel-reason-code"
          required
          hint="파트너·신청자 화면과 통계가 이 코드로 분류됩니다."
        >
          <Select
            id="cancel-reason-code"
            value={reasonCode}
            placeholder="사유를 선택하세요"
            options={toOptions(EVENT_CANCEL_REASON_LABEL)}
            onChange={(event) => setReasonCode(event.currentTarget.value as EventCancelReason)}
          />
        </Field>

        <Field
          label="메모"
          htmlFor="cancel-memo"
          hint="감사 로그에 남습니다. 신청자 알림 본문에는 들어가지 않아요."
        >
          <Textarea
            id="cancel-memo"
            value={memo}
            onChange={(event) => setMemo(event.currentTarget.value)}
            maxLength={500}
            showCount
            className="min-h-[80px]"
            placeholder="무슨 일이 있었는지 적어 두면 나중에 민원 대응에 쓰입니다."
          />
        </Field>

        <Field
          label={`확인을 위해 "${CONFIRM_WORD}" 를 입력하세요`}
          htmlFor="cancel-confirm"
          required
        >
          <Input
            id="cancel-confirm"
            value={confirmText}
            onChange={(event) => setConfirmText(event.currentTarget.value)}
            placeholder={CONFIRM_WORD}
            autoComplete="off"
          />
        </Field>
      </ActionDialog>
    </>
  );
}
