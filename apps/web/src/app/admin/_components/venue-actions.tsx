'use client';

import { apiPost } from '@/lib/api-client';
import type { VenueStatus } from '@/types/api';

import { ActionButton } from './action-dialog';
import { ActionRow } from './console';
import { useAdminAction } from '../_lib/use-admin-action';
import type { AdminVenueDetail } from '../_lib/types';

/**
 * 시설 검수·모더레이션 조치.
 *
 * 파트너 쪽에도 hide/unhide 가 있지만 그건 자기 매장을 잠시 내리는 것이고,
 * 여기의 조치는 **파트너가 스스로 풀 수 없는 강제 조치**다. 문구에서 그 차이를
 * 분명히 해야 운영자가 "잠깐 내리기"와 "제재"를 혼동하지 않는다.
 */
export function VenueActions({
  venueId,
  status,
  compact,
  onDone,
}: {
  venueId: string;
  status: VenueStatus;
  compact?: boolean;
  onDone?: () => void;
}) {
  const size = compact ? 'sm' : 'md';
  const done = onDone ? { onDone } : {};

  const approve = useAdminAction(
    () => apiPost<AdminVenueDetail>(`/api/admin/venues/${venueId}/approve`),
    {
      successTitle: '시설을 공개했습니다',
      successDescription: '이제 이용자 화면의 검색·탐색에 노출됩니다.',
      ...done,
    },
  );

  const reject = useAdminAction(
    (reason: string) => apiPost<AdminVenueDetail>(`/api/admin/venues/${venueId}/reject`, { reason }),
    { successTitle: '검수를 반려했습니다', ...done },
  );

  const hide = useAdminAction(
    (reason: string) => apiPost<AdminVenueDetail>(`/api/admin/venues/${venueId}/hide`, { reason }),
    { successTitle: '시설을 비공개로 내렸습니다', ...done },
  );

  const restore = useAdminAction(
    (reason: string) =>
      apiPost<AdminVenueDetail>(`/api/admin/venues/${venueId}/restore`, reason ? { reason } : {}),
    { successTitle: '시설을 다시 공개했습니다', ...done },
  );

  const suspend = useAdminAction(
    (reason: string) => apiPost<AdminVenueDetail>(`/api/admin/venues/${venueId}/suspend`, { reason }),
    { successTitle: '시설을 정지했습니다', ...done },
  );

  const unsuspend = useAdminAction(
    (reason: string) =>
      apiPost<AdminVenueDetail>(`/api/admin/venues/${venueId}/unsuspend`, reason ? { reason } : {}),
    { successTitle: '정지를 해제했습니다', ...done },
  );

  if (status === 'DRAFT' || status === 'ARCHIVED') {
    return (
      <span className="text-xs text-muted-foreground">
        {status === 'DRAFT' ? '파트너가 아직 검수를 요청하지 않았습니다' : '보관된 시설입니다'}
      </span>
    );
  }

  return (
    <ActionRow>
      {status === 'PENDING_REVIEW' ? (
        <>
          <ActionButton
            label="검수 승인"
            variant="primary"
            size={size}
            pending={approve.isPending}
            onConfirm={(_reason, close) => {
              approve.mutate(undefined);
              close();
            }}
            dialog={{
              title: '이 시설을 공개할까요?',
              description:
                '승인하면 곧바로 이용자 검색에 노출됩니다. 연결된 사업자가 확인 완료 상태여야 통과합니다.',
              confirmLabel: '공개 승인',
              warning: '사진과 주소가 실제 매장과 맞는지 한 번 더 확인해 주세요.',
            }}
          />

          <ActionButton
            label="검수 반려"
            size={size}
            pending={reject.isPending}
            onConfirm={(reason, close) => {
              reject.mutate(reason);
              close();
            }}
            dialog={{
              title: '검수를 반려할까요?',
              description: '작성 중 상태로 되돌립니다. 파트너가 고쳐서 다시 요청할 수 있어요.',
              confirmLabel: '반려',
              reason: {
                label: '반려 사유',
                required: true,
                placeholder: '예) 대표 이미지에 다른 매장의 사진이 섞여 있습니다.',
                hint: '파트너에게 그대로 전달됩니다.',
              },
            }}
          />
        </>
      ) : null}

      {status === 'ACTIVE' ? (
        <ActionButton
          label="강제 비공개"
          size={size}
          pending={hide.isPending}
          onConfirm={(reason, close) => {
            hide.mutate(reason);
            close();
          }}
          dialog={{
            title: '이 시설을 비공개로 내릴까요?',
            confirmLabel: '강제 비공개',
            destructive: true,
            warning:
              '파트너가 스스로 되돌릴 수 없는 조치입니다. 검색·탐색에서 즉시 빠지지만, 이미 열려 있는 이벤트가 자동으로 닫히지는 않습니다.',
            reason: { label: '비공개 사유', required: true, hint: '파트너에게 통보됩니다.' },
          }}
        />
      ) : null}

      {status === 'HIDDEN' ? (
        <ActionButton
          label="비공개 해제"
          variant="primary"
          size={size}
          pending={restore.isPending}
          onConfirm={(reason, close) => {
            restore.mutate(reason);
            close();
          }}
          dialog={{
            title: '다시 공개할까요?',
            description: '해제하면 검색·탐색에 즉시 다시 나타납니다.',
            confirmLabel: '비공개 해제',
            reason: { label: '해제 사유', required: false },
          }}
        />
      ) : null}

      {status === 'SUSPENDED' ? (
        <ActionButton
          label="정지 해제"
          variant="primary"
          size={size}
          pending={unsuspend.isPending}
          onConfirm={(reason, close) => {
            unsuspend.mutate(reason);
            close();
          }}
          dialog={{
            title: '시설 정지를 해제할까요?',
            description:
              '공개된 적이 있는 시설은 노출 중으로, 한 번도 공개된 적 없는 시설은 작성 중으로 돌아갑니다.',
            confirmLabel: '정지 해제',
            reason: { label: '해제 사유', required: false },
          }}
        />
      ) : (
        <ActionButton
          label="시설 정지"
          variant="destructive"
          size={size}
          pending={suspend.isPending}
          onConfirm={(reason, close) => {
            suspend.mutate(reason);
            close();
          }}
          dialog={{
            title: '이 시설을 정지할까요?',
            confirmLabel: '시설 정지',
            destructive: true,
            warning:
              '가장 강한 제재입니다. 시설이 공개에서 빠지고, 이 시설로 새 이벤트를 만들 수 없게 됩니다. 진행 중인 이벤트가 있다면 이벤트 운영 화면에서 따로 처리해야 합니다.',
            reason: { label: '정지 사유', required: true, hint: '파트너에게 통보됩니다.' },
          }}
        />
      )}
    </ActionRow>
  );
}

/** 이미지 격리 / 해제. 시설 상세의 사진 목록에서 쓴다. */
export function VenueImageActions({
  venueId,
  imageId,
  quarantined,
  onDone,
}: {
  venueId: string;
  imageId: string;
  quarantined: boolean;
  onDone?: () => void;
}) {
  const done = onDone ? { onDone } : {};

  const quarantine = useAdminAction(
    (reason: string) =>
      apiPost<unknown>(`/api/admin/venues/${venueId}/images/${imageId}/quarantine`, { reason }),
    {
      successTitle: '이미지를 격리했습니다',
      successDescription: '대표 이미지였다면 대표 지정도 함께 풀렸습니다.',
      ...done,
    },
  );

  const release = useAdminAction(
    () => apiPost<unknown>(`/api/admin/venues/${venueId}/images/${imageId}/release`),
    {
      successTitle: '격리를 해제했습니다',
      successDescription: '대표 이미지 지정은 복원되지 않으니 필요하면 파트너가 다시 지정해야 합니다.',
      ...done,
    },
  );

  if (quarantined) {
    return (
      <ActionButton
        label="격리 해제"
        size="sm"
        pending={release.isPending}
        onConfirm={(_reason, close) => {
          release.mutate(undefined);
          close();
        }}
        dialog={{
          title: '이 이미지의 격리를 풀까요?',
          description: '다시 이용자에게 노출됩니다. 대표 이미지 지정은 복원되지 않습니다.',
          confirmLabel: '격리 해제',
        }}
      />
    );
  }

  return (
    <ActionButton
      label="격리"
      variant="destructive"
      size="sm"
      pending={quarantine.isPending}
      onConfirm={(reason, close) => {
        quarantine.mutate(reason);
        close();
      }}
      dialog={{
        title: '이 이미지를 격리할까요?',
        description: '즉시 노출에서 빠집니다. 파일을 지우지는 않아요.',
        confirmLabel: '격리',
        destructive: true,
        reason: {
          label: '격리 사유',
          required: true,
          placeholder: '예) 타인의 사진을 무단으로 사용했습니다.',
        },
      }}
    />
  );
}
