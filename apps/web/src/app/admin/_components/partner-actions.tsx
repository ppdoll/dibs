'use client';

import { useState } from 'react';

import { Field, Select } from '@/components/ui';
import { apiPost } from '@/lib/api-client';
import type { PartnerApprovalStatus } from '@/types/api';

import { ActionButton, ActionDialog } from './action-dialog';
import { ActionRow } from './console';
import { PARTNER_REJECTION_LABEL, toOptions } from '../_lib/labels';
import { useAdminAction } from '../_lib/use-admin-action';
import type { AdminPartnerDetail, PartnerRejectionCode } from '../_lib/types';

/**
 * 파트너 심사 조치 묶음. 큐 목록의 행과 상세 화면이 같은 컴포넌트를 쓴다.
 *
 * 상태별로 가능한 조치만 그린다. 서버가 전이표를 쥐고 있으므로(전이마다 엔드포인트가
 * 따로다) 화면이 잘못된 버튼을 보여줘도 서버가 막긴 하지만, **누를 수 있는데 실패하는
 * 버튼**은 운영자에게 "시스템이 고장났나?" 로 읽힌다. 그래서 여기서도 한 번 거른다.
 */
export function PartnerActions({
  profileId,
  status,
  compact,
  onDone,
}: {
  profileId: string;
  status: PartnerApprovalStatus;
  /** 표 안에서 쓸 때. 버튼이 작아진다. */
  compact?: boolean;
  onDone?: () => void;
}) {
  const size = compact ? 'sm' : 'md';

  const approve = useAdminAction(
    (memo: string) =>
      apiPost<AdminPartnerDetail>(
        `/api/admin/partners/${profileId}/approve`,
        memo ? { memo } : {},
      ),
    { successTitle: '파트너를 승인했습니다', successDescription: '승인 알림이 발송됩니다.', ...(onDone ? { onDone } : {}) },
  );

  const requestResubmit = useAdminAction(
    (reason: string) =>
      apiPost<AdminPartnerDetail>(`/api/admin/partners/${profileId}/request-resubmit`, { reason }),
    {
      successTitle: '보완을 요청했습니다',
      successDescription: '신청서는 살아 있고, 파트너가 다시 제출할 수 있습니다.',
      ...(onDone ? { onDone } : {}),
    },
  );

  const suspend = useAdminAction(
    (reason: string) =>
      apiPost<AdminPartnerDetail>(`/api/admin/partners/${profileId}/suspend`, { reason }),
    { successTitle: '파트너 활동을 정지했습니다', ...(onDone ? { onDone } : {}) },
  );

  const reinstate = useAdminAction(
    (reason: string) =>
      apiPost<AdminPartnerDetail>(
        `/api/admin/partners/${profileId}/reinstate`,
        reason ? { reason } : {},
      ),
    { successTitle: '정지를 해제했습니다', ...(onDone ? { onDone } : {}) },
  );

  const revoke = useAdminAction(
    (reason: string) =>
      apiPost<AdminPartnerDetail>(`/api/admin/partners/${profileId}/revoke`, { reason }),
    { successTitle: '파트너 자격을 박탈했습니다', ...(onDone ? { onDone } : {}) },
  );

  const canReview = status === 'PENDING' || status === 'RESUBMIT_REQUIRED';
  const isApproved = status === 'APPROVED';
  const isSuspended = status === 'SUSPENDED';

  if (!canReview && !isApproved && !isSuspended) {
    return (
      <span className="text-xs text-muted-foreground">
        {status === 'REVOKED' ? '박탈된 신청서입니다 (재신청만 가능)' : '가능한 조치가 없습니다'}
      </span>
    );
  }

  return (
    <ActionRow>
      {canReview ? (
        <>
          <ActionButton
            label="승인"
            variant="primary"
            size={size}
            pending={approve.isPending}
            onConfirm={(memo, close) => {
              approve.mutate(memo);
              close();
            }}
            dialog={{
              title: '이 파트너를 승인할까요?',
              description:
                '승인하면 파트너가 바로 시설·이벤트를 만들 수 있게 됩니다. 승인 알림이 함께 발송됩니다.',
              confirmLabel: '승인',
              reason: {
                label: '승인 메모',
                required: false,
                placeholder: '감사 로그에만 남습니다. 파트너에게는 가지 않아요.',
              },
            }}
          />

          <PartnerRejectButton profileId={profileId} size={size} {...(onDone ? { onDone } : {})} />

          <ActionButton
            label="보완 요청"
            size={size}
            pending={requestResubmit.isPending}
            onConfirm={(reason, close) => {
              requestResubmit.mutate(reason);
              close();
            }}
            dialog={{
              title: '보완을 요청할까요?',
              description:
                '신청서를 살려둔 채 파트너에게 공을 넘깁니다. 파트너가 고쳐서 다시 제출할 수 있어요.',
              confirmLabel: '보완 요청',
              reason: {
                label: '무엇을 보완해야 하나요?',
                required: true,
                placeholder: '예) 사업자등록증 사진이 흐려서 번호를 확인할 수 없습니다. 다시 올려 주세요.',
                hint: '이 문구가 파트너에게 그대로 보입니다.',
              },
            }}
          />
        </>
      ) : null}

      {isApproved ? (
        <ActionButton
          label="활동 정지"
          size={size}
          pending={suspend.isPending}
          onConfirm={(reason, close) => {
            suspend.mutate(reason);
            close();
          }}
          dialog={{
            title: '파트너 활동을 정지할까요?',
            confirmLabel: '활동 정지',
            destructive: true,
            warning:
              '계정 정지와는 다릅니다. 로그인은 되지만 시설·이벤트 생성 등 파트너 기능이 막힙니다. 이미 열려 있는 이벤트는 자동으로 닫히지 않으니, 필요하면 이벤트 운영 화면에서 따로 처리하세요.',
            reason: {
              label: '정지 사유',
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
          pending={reinstate.isPending}
          onConfirm={(reason, close) => {
            reinstate.mutate(reason);
            close();
          }}
          dialog={{
            title: '정지를 해제할까요?',
            description: '해제하면 파트너 기능이 즉시 다시 열립니다.',
            confirmLabel: '정지 해제',
            reason: { label: '해제 사유', required: false },
          }}
        />
      ) : null}

      {isApproved || isSuspended ? (
        <ActionButton
          label="자격 박탈"
          variant="destructive"
          size={size}
          pending={revoke.isPending}
          onConfirm={(reason, close) => {
            revoke.mutate(reason);
            close();
          }}
          dialog={{
            title: '파트너 자격을 박탈할까요?',
            confirmLabel: '자격 박탈',
            destructive: true,
            warning:
              '되돌리는 경로가 없습니다. 다시 파트너로 활동하려면 처음부터 신청서를 새로 내야 합니다.',
            reason: {
              label: '박탈 사유',
              required: true,
              placeholder: '파트너에게 전달되고 감사 로그에 남습니다.',
            },
          }}
        />
      ) : null}
    </ActionRow>
  );
}

/**
 * 반려. 코드와 문구를 함께 받는다.
 *
 * 코드를 따로 받는 이유: 파트너 화면이 문구가 아니라 **코드로 분기**한다
 * ("사업자등록번호가 유효하지 않음"이면 번호 입력칸으로 바로 보낸다).
 * 문구만 받으면 그 분기를 만들 수 없고, 문구를 고칠 때마다 파트너 화면이 깨진다.
 */
function PartnerRejectButton({
  profileId,
  size,
  onDone,
}: {
  profileId: string;
  size: 'sm' | 'md';
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<PartnerRejectionCode | ''>('');

  const reject = useAdminAction(
    (input: { rejectionCode: PartnerRejectionCode; reason: string }) =>
      apiPost<AdminPartnerDetail>(`/api/admin/partners/${profileId}/reject`, input),
    {
      successTitle: '신청을 반려했습니다',
      successDescription: '반려 코드와 사유가 파트너에게 그대로 전달됩니다.',
      onDone: () => {
        setOpen(false);
        setCode('');
        onDone?.();
      },
    },
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          size === 'sm'
            ? 'inline-flex h-8 items-center rounded-lg border border-input px-2.5 text-xs font-semibold transition-colors hover:bg-accent'
            : 'inline-flex h-11 items-center rounded-lg border border-input px-4 text-sm font-semibold transition-colors hover:bg-accent'
        }
      >
        반려
      </button>

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title="신청을 반려할까요?"
        description="반려하면 신청서가 닫힙니다. 파트너는 내용을 고쳐 새로 신청해야 해요."
        confirmLabel="반려"
        destructive
        pending={reject.isPending}
        canConfirm={code !== ''}
        reason={{
          label: '반려 사유',
          required: true,
          placeholder: '파트너에게 그대로 보입니다. 무엇이 문제였는지 구체적으로 적어 주세요.',
        }}
        onConfirm={(reason) => {
          if (!code) return;
          reject.mutate({ rejectionCode: code, reason });
        }}
      >
        <Field
          label="반려 코드"
          htmlFor="partner-reject-code"
          required
          hint="파트너 화면이 문구가 아니라 이 코드로 다음 안내를 정합니다."
        >
          <Select
            id="partner-reject-code"
            value={code}
            placeholder="코드를 선택하세요"
            options={toOptions(PARTNER_REJECTION_LABEL)}
            onChange={(event) => setCode(event.currentTarget.value as PartnerRejectionCode)}
          />
        </Field>
      </ActionDialog>
    </>
  );
}
