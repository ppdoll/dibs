'use client';

import { useEffect, useState } from 'react';

import { Button, Field, Select } from '@/components/ui';
import { apiPost } from '@/lib/api-client';
import { formatFullDateTimeKo } from '@/lib/format';
import type { AccountStatus, UserRole } from '@/types/api';

import { ActionButton, ActionDialog } from './action-dialog';
import { ActionRow, Notice } from './console';
import { USER_ROLE_LABEL } from '../_lib/labels';
import { useAdminAction } from '../_lib/use-admin-action';
import type { AdminUserDetail } from '../_lib/types';

/** 정지 기간 프리셋. 절대 시각은 브라우저 시계를 타므로 "지금부터 N" 으로 계산한다. */
const DURATION_OPTIONS = [
  { value: 'INDEFINITE', label: '무기한 (운영자가 직접 해제)' },
  { value: '1D', label: '1일' },
  { value: '3D', label: '3일' },
  { value: '7D', label: '7일' },
  { value: '30D', label: '30일' },
] as const;

type DurationKey = (typeof DURATION_OPTIONS)[number]['value'];

const DURATION_MS: Record<DurationKey, number | null> = {
  INDEFINITE: null,
  '1D': 24 * 60 * 60_000,
  '3D': 3 * 24 * 60 * 60_000,
  '7D': 7 * 24 * 60 * 60_000,
  '30D': 30 * 24 * 60 * 60_000,
};

export function UserActions({
  userId,
  status,
  roles,
  compact,
  onDone,
}: {
  userId: string;
  status: AccountStatus;
  roles: UserRole[];
  compact?: boolean;
  onDone?: () => void;
}) {
  const size = compact ? 'sm' : 'md';

  const reinstate = useAdminAction(
    (reason: string) => apiPost<AdminUserDetail>(`/api/admin/users/${userId}/reinstate`, { reason }),
    {
      successTitle: '정지를 해제했습니다',
      successDescription: '대상자는 다시 로그인할 수 있습니다.',
      ...(onDone ? { onDone } : {}),
    },
  );

  return (
    <ActionRow>
      {status === 'SUSPENDED' ? (
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
            title: '계정 정지를 해제할까요?',
            description: '해제하면 상태가 정상으로 돌아가고 다시 로그인할 수 있습니다.',
            confirmLabel: '정지 해제',
            reason: {
              label: '해제 사유',
              required: true,
              placeholder: '왜 풀어 주는지 적어 주세요. 감사 로그에 남습니다.',
            },
          }}
        />
      ) : (
        <SuspendUserButton userId={userId} size={size} disabled={status === 'WITHDRAWN'} {...(onDone ? { onDone } : {})} />
      )}

      <ChangeRolesButton userId={userId} size={size} current={roles} {...(onDone ? { onDone } : {})} />
    </ActionRow>
  );
}

/**
 * 계정 정지.
 *
 * 경고 문구가 이 창의 핵심이다 — 정지는 `tokenVersion` 을 올려 **이미 발급된 모든 JWT 를
 * 즉시 무효화**한다. 대상자는 다른 기기에서 보고 있던 화면까지 그 자리에서 로그아웃된다.
 * "나중에 반영되겠지" 로 생각하고 누르면 안 되는 조치다.
 */
function SuspendUserButton({
  userId,
  size,
  disabled,
  onDone,
}: {
  userId: string;
  size: 'sm' | 'md';
  disabled?: boolean;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<DurationKey>('INDEFINITE');

  useEffect(() => {
    if (open) setDuration('INDEFINITE');
  }, [open]);

  const suspend = useAdminAction(
    (input: { reason: string; suspendedUntil?: string }) =>
      apiPost<AdminUserDetail>(`/api/admin/users/${userId}/suspend`, input),
    {
      successTitle: '계정을 정지했습니다',
      successDescription: '대상자의 로그인 세션이 모두 끊겼습니다.',
      onDone: () => {
        setOpen(false);
        onDone?.();
      },
    },
  );

  const ms = DURATION_MS[duration];
  const until = ms === null ? null : new Date(Date.now() + ms);

  return (
    <>
      <Button
        variant="destructive"
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={size === 'sm' ? 'h-8 px-2.5 text-xs' : undefined}
      >
        계정 정지
      </Button>

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title="이 계정을 정지할까요?"
        confirmLabel="계정 정지"
        destructive
        pending={suspend.isPending}
        warning={
          <>
            정지하면 <strong>이미 로그인되어 있는 모든 기기의 세션이 즉시 끊깁니다.</strong> 발급된
            토큰 자체가 무효가 되므로 다른 탭에서 작업 중이던 내용도 그 자리에서 사라집니다.
            정지 사유는 알림으로 전달됩니다.
          </>
        }
        reason={{
          label: '정지 사유',
          required: true,
          placeholder: '예) 반복적인 허위 신청으로 다른 이용자의 기회를 막았습니다.',
          hint: '이 문구가 대상자에게 그대로 전달됩니다.',
        }}
        onConfirm={(reason) =>
          suspend.mutate({
            reason,
            ...(until ? { suspendedUntil: until.toISOString() } : {}),
          })
        }
      >
        <Field
          label="정지 기간"
          htmlFor="suspend-duration"
          hint={
            until
              ? `${formatFullDateTimeKo(until)} 에 자동으로 풀립니다.`
              : '자동 해제가 없습니다. 운영자가 직접 풀어야 합니다.'
          }
        >
          <Select
            id="suspend-duration"
            value={duration}
            options={DURATION_OPTIONS.map((option) => ({ ...option }))}
            onChange={(event) => setDuration(event.currentTarget.value as DurationKey)}
          />
        </Field>
      </ActionDialog>
    </>
  );
}

/**
 * 역할 교체.
 *
 * 부분 갱신이 아니라 **전체 집합 교체**다. 그래서 화면도 "추가/제거" 가 아니라
 * 체크박스 목록으로 만든다 — 서버가 받는 모양과 화면의 모양이 다르면
 * 운영자가 무엇을 보내는지 알 수 없다. `USER` 는 항상 포함이라 잠가 둔다.
 */
function ChangeRolesButton({
  userId,
  size,
  current,
  onDone,
}: {
  userId: string;
  size: 'sm' | 'md';
  current: UserRole[];
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<UserRole[]>(current);

  useEffect(() => {
    if (open) setSelected(current.includes('USER') ? current : ['USER', ...current]);
  }, [open, current]);

  const changeRoles = useAdminAction(
    (input: { roles: UserRole[]; reason: string }) =>
      apiPost<AdminUserDetail>(`/api/admin/users/${userId}/roles`, input),
    {
      successTitle: '역할을 변경했습니다',
      successDescription: '대상자는 다시 로그인해야 합니다.',
      onDone: () => {
        setOpen(false);
        onDone?.();
      },
    },
  );

  const toggle = (role: UserRole) => {
    if (role === 'USER') return;
    setSelected((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const changed =
    selected.length !== current.length || selected.some((role) => !current.includes(role));

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        className={size === 'sm' ? 'h-8 px-2.5 text-xs' : undefined}
      >
        역할 변경
      </Button>

      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title="역할을 바꿀까요?"
        description="선택한 역할 전체로 교체합니다. 체크를 푼 역할은 사라집니다."
        confirmLabel="역할 교체"
        destructive
        pending={changeRoles.isPending}
        canConfirm={changed}
        warning={
          <>
            역할을 바꾸면 <strong>대상자의 모든 세션이 무효화되어 다시 로그인해야 합니다.</strong>{' '}
            운영자(ADMIN) 역할은 셀프 가입 경로가 없으므로, 여기서 주는 것이 곧 콘솔 접근 권한을
            주는 일입니다.
          </>
        }
        reason={{ label: '변경 사유', required: true }}
        onConfirm={(reason) => changeRoles.mutate({ roles: selected, reason })}
      >
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">역할</legend>
          {(['USER', 'PARTNER', 'ADMIN'] as const).map((role) => (
            <label
              key={role}
              className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(role)}
                disabled={role === 'USER'}
                onChange={() => toggle(role)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              <span className="font-medium">{USER_ROLE_LABEL[role] ?? role}</span>
              {role === 'USER' ? (
                <span className="text-xs text-muted-foreground">(항상 포함)</span>
              ) : null}
            </label>
          ))}
        </fieldset>

        {selected.includes('PARTNER') && !current.includes('PARTNER') ? (
          <Notice tone="info">
            역할만 주는 것으로는 파트너 활동이 열리지 않습니다. 실제 활동은 파트너 심사에서
            <strong> 승인</strong>해야 가능해집니다.
          </Notice>
        ) : null}
      </ActionDialog>
    </>
  );
}

/** 정지 상태 요약 문구. 목록과 상세가 같은 말을 쓰게 한다. */
export function suspensionSummary(input: {
  status: AccountStatus;
  statusReason: string | null;
  suspendedUntil: string | null;
}): string | null {
  if (input.status !== 'SUSPENDED') return null;

  const until = input.suspendedUntil
    ? `${formatFullDateTimeKo(input.suspendedUntil)} 자동 해제`
    : '자동 해제 없음';

  return input.statusReason ? `${input.statusReason} · ${until}` : until;
}
