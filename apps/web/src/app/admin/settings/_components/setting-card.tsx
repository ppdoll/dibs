'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';

import { Badge, Button, Field, Textarea } from '@/components/ui';
import { apiGet, apiPut, toUserMessage } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

import { ActionDialog } from '../../_components/action-dialog';
import { CopyableId, Notice, TimeCell } from '../../_components/console';
import { useAdminAction } from '../../_lib/use-admin-action';
import type { AdminSettingRow } from '../../_lib/types';

/**
 * 설정 한 줄.
 *
 * 값을 바꾸는 경로를 **두 가지로만** 만든다.
 *
 * - `kind === 'boolean'` 이고 실제 값도 boolean 이면 켜짐/꺼짐 세그먼트.
 *   플래그는 오타로 잘못된 값이 들어갈 여지 자체가 없어야 한다.
 * - 그 밖에는 JSON 편집기. 저장 전에 `JSON.parse` 로 한 번 걸러서,
 *   서버까지 갔다가 400 으로 돌아오는 왕복을 없앤다.
 *
 * 어느 쪽이든 **확인 창을 반드시 거친다.** 설정 변경은 감사 로그에
 * `SETTING_CHANGED` / `FEATURE_FLAG_TOGGLED` 로 행위자와 함께 남는 조치이고,
 * 플래그 하나가 서비스 전체 흐름을 바꾼다(DEPOSIT_HOLD_ENABLED 가 그렇다).
 * 사유(reason)는 서버가 필수로 요구한다 — 감사 행의 reasonMemo 가 된다.
 */

/** `GET /api/admin/settings/:key` 응답. 목록 행과 달리 kind·isFeatureFlag 가 없다. */
interface SettingSnapshot {
  key: string;
  value: unknown;
  isDefault: boolean;
  description: string | null;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

const KIND_LABEL: Record<string, string> = {
  boolean: '참/거짓',
  number: '숫자',
  string: '문자열',
};

/** 값 한 개를 화면에 박아 넣을 문자열로. undefined 는 JSON 에 없는 값이라 따로 적는다. */
function stringify(value: unknown): string {
  if (value === undefined) return '(값 없음)';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function SettingCard({
  row,
  bare,
  confirmWarning,
}: {
  row: AdminSettingRow;
  /** 강조 카드 안에 들어갈 때는 자기 테두리를 그리지 않는다(테두리가 이중으로 보인다). */
  bare?: boolean;
  /** 파급이 큰 키에서 확인 창에 덧붙일 경고. */
  confirmWarning?: React.ReactNode;
}) {
  // 확인 창에 올려 둔 "바꿀 값". null 이면 창이 닫힌 상태다.
  const [proposed, setProposed] = useState<{ value: unknown } | null>(null);

  const save = useAdminAction(
    (vars: { value: unknown; reason: string }) =>
      // PUT 인 이유는 서버 쪽 설계다 — 키가 곧 자원이라 같은 값을 두 번 써도 결과가 같다.
      // 그래서 멱등키를 붙이는 apiMutate 를 쓰지 않는다.
      apiPut<SettingSnapshot>(`/api/admin/settings/${encodeURIComponent(row.key)}`, {
        value: vars.value,
        reason: vars.reason,
      }),
    {
      successTitle: '설정을 저장했습니다',
      successDescription: '감사 로그에 변경 전후 값이 함께 남았습니다.',
      // 실패 문구는 확인 창 안에 붙인다. 창이 열려 있는데 뒤쪽에 토스트만 뜨면 못 본다.
      silentError: true,
      onDone: () => setProposed(null),
    },
  );

  /**
   * 확인 창을 열 때만 그 키를 한 번 더 읽는다.
   *
   * 목록은 운영자가 화면을 열어 둔 채로 오래 묵는다. 그사이 다른 운영자가 같은 키를
   * 바꿨다면 지금 보고 있는 "현재 값"이 거짓이고, 그 상태로 저장하면 남의 변경을
   * 조용히 되돌리게 된다. 그래서 마지막 순간에 서버 값을 다시 확인한다.
   */
  const fresh = useQuery({
    queryKey: [...qk.admin.settings, row.key],
    queryFn: () => apiGet<SettingSnapshot>(`/api/admin/settings/${encodeURIComponent(row.key)}`),
    enabled: proposed !== null,
    staleTime: 0,
  });

  const drifted =
    proposed !== null &&
    fresh.data !== undefined &&
    JSON.stringify(fresh.data.value) !== JSON.stringify(row.value);

  const asToggle = row.kind === 'boolean' && typeof row.value === 'boolean';

  return (
    <div className={cn('space-y-3', !bare && 'rounded-lg border bg-card p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="font-mono text-sm font-bold">{row.key}</code>
            {row.isFeatureFlag ? (
              <Badge variant="secondary" size="sm">
                피처 플래그
              </Badge>
            ) : null}
            <Badge variant="outline" size="sm">
              {KIND_LABEL[row.kind] ?? row.kind}
            </Badge>
            {row.isDefault ? (
              <Badge variant="muted" size="sm">
                코드 기본값
              </Badge>
            ) : null}
          </div>
          {row.description ? (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.description}</p>
          ) : null}
        </div>

        {asToggle ? (
          <BooleanSwitch
            value={row.value === true}
            disabled={save.isPending}
            onPick={(value) => setProposed({ value })}
          />
        ) : null}
      </div>

      {asToggle ? (
        <p className="text-xs text-muted-foreground">
          현재 값 <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{stringify(row.value)}</code>
        </p>
      ) : (
        <JsonEditor row={row} disabled={save.isPending} onSubmit={(value) => setProposed({ value })} />
      )}

      <LastChangedLine row={row} />

      {proposed ? (
        <ActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setProposed(null);
          }}
          title={`${row.key} 값을 바꿉니다`}
          description="저장하면 즉시 반영됩니다. 다른 서버 인스턴스에는 최대 30초 뒤에 전파됩니다."
          confirmLabel="저장"
          destructive={row.isFeatureFlag}
          {...(confirmWarning ? { warning: confirmWarning } : {})}
          reason={{
            label: '변경 사유',
            required: true,
            placeholder: '왜 바꾸는지 적어 주세요. 감사 로그의 reasonMemo 로 그대로 남습니다.',
            hint: '나중에 "이 값이 왜 이렇게 됐는지"를 로그만 보고 재구성할 수 있어야 합니다.',
          }}
          pending={save.isPending}
          errorMessage={save.isError ? toUserMessage(save.error) : null}
          onConfirm={(reason) => save.mutate({ value: proposed.value, reason })}
        >
          <div className="space-y-2">
            {drifted ? (
              <Notice tone="warning" title="이 사이에 값이 바뀌었습니다">
                다른 운영자가 방금 이 키를 고쳤습니다. 서버의 최신 값은{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  {stringify(fresh.data?.value)}
                </code>{' '}
                입니다. 그대로 저장하면 그 변경을 덮어씁니다.
              </Notice>
            ) : null}

            <dl className="rounded-lg border bg-muted/40 p-3 text-xs">
              <div className="flex gap-2 py-0.5">
                <dt className="w-16 shrink-0 text-muted-foreground">지금</dt>
                <dd className="min-w-0 break-all font-mono">{stringify(row.value)}</dd>
              </div>
              <div className="flex gap-2 py-0.5">
                <dt className="w-16 shrink-0 text-muted-foreground">바꿀 값</dt>
                <dd className="min-w-0 break-all font-mono font-bold">{stringify(proposed.value)}</dd>
              </div>
            </dl>
          </div>
        </ActionDialog>
      ) : null}
    </div>
  );
}

/** 마지막으로 누가 언제 바꿨는지. 설정 화면에서 이 줄이 없으면 추적이 감사 로그로만 가능해진다. */
function LastChangedLine({ row }: { row: AdminSettingRow }) {
  if (row.isDefault) {
    return (
      <p className="border-t pt-2 text-xs text-muted-foreground">
        아직 저장된 적이 없습니다. 코드에 적힌 기본값을 쓰는 중이에요.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
      <span>
        최종 변경 <TimeCell value={row.updatedAt} />
      </span>
      <span className="inline-flex items-center gap-1">
        변경자 <CopyableId value={row.updatedByUserId} />
      </span>
    </div>
  );
}

/** 켜짐/꺼짐 세그먼트. 지금 값은 눌리지 않고, 반대쪽을 누르면 확인 창이 뜬다. */
function BooleanSwitch({
  value,
  disabled,
  onPick,
}: {
  value: boolean;
  disabled?: boolean;
  onPick: (next: boolean) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 overflow-hidden rounded-lg border"
      role="group"
      aria-label="값 켜기 · 끄기"
    >
      {[false, true].map((option) => {
        const active = option === value;

        return (
          <button
            key={String(option)}
            type="button"
            aria-pressed={active}
            disabled={active || disabled}
            onClick={() => onPick(option)}
            className={cn(
              'px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default',
              active
                ? option
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50',
            )}
          >
            {option ? '켜짐' : '꺼짐'}
          </button>
        );
      })}
    </div>
  );
}

/**
 * JSON 편집기.
 *
 * `Setting.valueJson` 은 jsonb 라 숫자·문자열·객체가 전부 들어간다. 그래서 입력창을
 * 타입별로 나누지 않고 JSON 원문을 그대로 받되, **저장 전에 파싱해서 막는다.**
 * 문자열 설정에 큰따옴표를 빠뜨리는 실수가 이 화면에서 가장 흔하다.
 */
function JsonEditor({
  row,
  disabled,
  onSubmit,
}: {
  row: AdminSettingRow;
  disabled?: boolean;
  onSubmit: (value: unknown) => void;
}) {
  const serverText = useMemo(() => stringify(row.value), [row.value]);
  const [draft, setDraft] = useState(serverText);

  // 저장에 성공하거나 다른 운영자의 변경이 재조회로 들어오면 편집창도 따라가야 한다.
  // 안 그러면 화면에는 옛 원문이 남고 그걸 다시 저장해 버린다.
  useEffect(() => setDraft(serverText), [serverText]);

  const parsed = useMemo((): { ok: true; value: unknown } | { ok: false; message: string } => {
    const text = draft.trim();

    if (text.length === 0) {
      return { ok: false, message: '값이 비어 있습니다. 빈 칸은 저장할 수 없어요.' };
    }

    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return {
        ok: false,
        message:
          'JSON 형식이 아닙니다. 문자열은 큰따옴표로 감싸고("support@dibs.kr"), 숫자와 참/거짓은 따옴표 없이 적어 주세요.',
      };
    }
  }, [draft]);

  const changed = draft.trim() !== serverText.trim();
  // 타입이 어긋나도 막지는 않는다. 최종 판정은 서버의 키별 스키마가 한다 —
  // 여기서 규칙을 한 벌 더 두면 레지스트리가 바뀔 때 조용히 어긋난다.
  const actualType = parsed.ok ? typeof parsed.value : null;
  const mismatch = actualType !== null && actualType !== row.kind;
  const fieldId = `setting-json-${row.key}`;

  return (
    <div className="space-y-2">
      <Field
        label="값 (JSON)"
        htmlFor={fieldId}
        hint={
          mismatch
            ? `이 키는 ${KIND_LABEL[row.kind] ?? row.kind}(${row.kind}) 로 등록돼 있는데 지금 입력은 ${actualType} 입니다. 서버가 거절할 수 있어요.`
            : '값 그대로의 JSON 을 적습니다. 예: 72 · "support@dibs.kr" · true'
        }
      >
        <Textarea
          id={fieldId}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          spellCheck={false}
          autoComplete="off"
          className="min-h-[80px] font-mono text-sm"
          disabled={disabled}
          {...(parsed.ok ? {} : { error: parsed.message })}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!changed || disabled}
          onClick={() => setDraft(serverText)}
          leadingIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          되돌리기
        </Button>
        <Button
          size="sm"
          disabled={!parsed.ok || !changed || disabled}
          onClick={() => {
            if (!parsed.ok) return;
            onSubmit(parsed.value);
          }}
        >
          저장
        </Button>
      </div>
    </div>
  );
}
