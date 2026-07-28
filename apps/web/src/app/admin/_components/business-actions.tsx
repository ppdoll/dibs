'use client';

import { apiPost } from '@/lib/api-client';
import type { BusinessVerificationStatus } from '@/types/api';

import { ActionButton } from './action-dialog';
import { ActionRow } from './console';
import { useAdminAction } from '../_lib/use-admin-action';
import type { AdminBusinessDetail } from '../_lib/types';

/**
 * 사업자 진위 확인 조치.
 *
 * `UNSUBMITTED` 는 파트너가 아직 심사를 넣지 않은 상태라 운영자가 할 일이 없다.
 * `REJECTED` 도 파트너가 고쳐서 다시 제출해야 하므로 여기서 되살리지 않는다 —
 * 되돌리는 버튼을 주면 "반려했다가 슬쩍 통과시키기"가 감사 없이 가능해진다.
 */
export function BusinessActions({
  businessId,
  status,
  compact,
  onDone,
}: {
  businessId: string;
  status: BusinessVerificationStatus;
  compact?: boolean;
  onDone?: () => void;
}) {
  const size = compact ? 'sm' : 'md';

  const verify = useAdminAction(
    (memo: string) =>
      apiPost<AdminBusinessDetail>(
        `/api/admin/businesses/${businessId}/verify`,
        memo ? { memo } : {},
      ),
    { successTitle: '사업자 확인을 완료했습니다', ...(onDone ? { onDone } : {}) },
  );

  const reject = useAdminAction(
    (reason: string) =>
      apiPost<AdminBusinessDetail>(`/api/admin/businesses/${businessId}/reject`, { reason }),
    { successTitle: '사업자 확인을 반려했습니다', ...(onDone ? { onDone } : {}) },
  );

  const revoke = useAdminAction(
    (reason: string) =>
      apiPost<AdminBusinessDetail>(`/api/admin/businesses/${businessId}/revoke`, { reason }),
    { successTitle: '사업자 확인을 취소했습니다', ...(onDone ? { onDone } : {}) },
  );

  if (status === 'PENDING') {
    return (
      <ActionRow>
        <ActionButton
          label="확인 완료"
          variant="primary"
          size={size}
          pending={verify.isPending}
          onConfirm={(memo, close) => {
            verify.mutate(memo);
            close();
          }}
          dialog={{
            title: '사업자 확인을 완료할까요?',
            description:
              '확인이 끝나야 이 사업자에 연결된 시설이 검수를 통과할 수 있습니다. 파트너에게 알림이 나갑니다.',
            confirmLabel: '확인 완료',
            reason: {
              label: '확인 메모',
              required: false,
              placeholder: '무엇을 대조했는지 적어 두면 나중에 도움이 됩니다. 파트너에게는 가지 않아요.',
            },
          }}
        />

        <ActionButton
          label="반려"
          size={size}
          pending={reject.isPending}
          onConfirm={(reason, close) => {
            reject.mutate(reason);
            close();
          }}
          dialog={{
            title: '사업자 확인을 반려할까요?',
            confirmLabel: '반려',
            destructive: true,
            warning: '파트너는 내용을 고쳐 다시 제출해야 합니다. 운영자가 되살릴 수는 없습니다.',
            reason: {
              label: '반려 사유',
              required: true,
              placeholder: '예) 제출한 등록증의 상호가 신청 정보와 다릅니다.',
              hint: '파트너에게 그대로 전달됩니다.',
            },
          }}
        />
      </ActionRow>
    );
  }

  if (status === 'VERIFIED') {
    return (
      <ActionRow>
        <ActionButton
          label="확인 취소"
          variant="destructive"
          size={size}
          pending={revoke.isPending}
          onConfirm={(reason, close) => {
            revoke.mutate(reason);
            close();
          }}
          dialog={{
            title: '확인을 취소할까요?',
            confirmLabel: '확인 취소',
            destructive: true,
            warning:
              '이 사업자에 연결된 시설의 신규 검수가 막힙니다. 이미 공개 중인 시설은 자동으로 내려가지 않으니, 필요하면 시설 검수 화면에서 따로 비공개 처리하세요.',
            reason: { label: '취소 사유', required: true },
          }}
        />
      </ActionRow>
    );
  }

  return (
    <span className="text-xs text-muted-foreground">
      {status === 'UNSUBMITTED'
        ? '파트너가 아직 심사를 제출하지 않았습니다'
        : '가능한 조치가 없습니다'}
    </span>
  );
}
