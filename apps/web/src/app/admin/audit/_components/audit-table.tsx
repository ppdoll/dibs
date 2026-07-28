'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { toUserMessage } from '@/lib/api-client';
import { labelOf } from '@/lib/format';
import { cn } from '@/lib/utils';

import { CopyableId, TimeCell } from '../../_components/console';
import {
  AUDIT_ACTION_LABEL,
  AUDIT_ACTION_TONE,
  AUDIT_ACTOR_ROLE_LABEL,
  AUDIT_TARGET_TYPE_LABEL,
} from '../../_lib/labels';
import type { AdminAuditRow } from '../../_lib/types';

/**
 * 감사 로그 표.
 *
 * 공용 `DataTable` 을 쓰지 않는 이유는 하나다 — 이 표는 **행을 펼쳐야** 쓸모가 있다.
 * before/after JSON 이 감사 로그의 본체인데, 그걸 셀 안에 접어 넣으면 아무것도 읽을 수
 * 없고 별도 상세 화면으로 빼면 한 건 확인할 때마다 목록 위치를 잃는다.
 * 로딩·비어 있음·실패 세 상태의 처리 방식은 DataTable 과 똑같이 맞춘다.
 *
 * 정렬 버튼도 두지 않는다. 이 표의 순서는 `seq` 내림차순 하나로 고정이다 —
 * 체인 순서대로 읽는 것이 감사 로그를 보는 유일한 이유이고, 화면에서 순서를 바꾸면
 * 바로 앞뒤 행의 연결(prevHash → rowHash)이 눈으로 확인되지 않는다.
 */

const COLUMN_COUNT = 6;

export function AuditTable({
  rows,
  isLoading,
  isFetching,
  error,
  onRetry,
}: {
  rows: AdminAuditRow[] | undefined;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  // 여러 행을 동시에 펼칠 수 있게 한다. 두 조치를 나란히 비교하는 일이 잦다.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (error) {
    return (
      <ErrorState
        title="감사 로그를 불러오지 못했어요"
        description={toUserMessage(error)}
        {...(onRetry ? { onRetry } : {})}
      />
    );
  }

  const showSkeleton = isLoading || rows === undefined;
  const isEmpty = !showSkeleton && (rows?.length ?? 0) === 0;

  return (
    <div className="relative">
      {/* 재조회 중에도 표를 지우지 않는다. 목록이 사라졌다 나타나면 위치를 잃는다. */}
      {isFetching && !showSkeleton ? (
        <div
          className="absolute inset-x-0 -top-px h-0.5 animate-pulse bg-primary/60"
          aria-hidden="true"
        />
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">펼치기</span>
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground">
                시각
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground">
                행위자
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground">
                액션
              </th>
              <th
                scope="col"
                className="hidden whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground lg:table-cell"
              >
                대상
              </th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold text-muted-foreground">
                요약
              </th>
            </tr>
          </thead>

          <tbody>
            {showSkeleton
              ? Array.from({ length: 10 }).map((_, index) => (
                  <tr key={index} className="border-b last:border-b-0">
                    {Array.from({ length: COLUMN_COUNT }).map((__, cell) => (
                      <td key={cell} className={cn('px-3 py-2.5', cell === 4 && 'hidden lg:table-cell')}>
                        <Skeleton className="h-4 w-full max-w-[9rem]" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows?.map((row) => {
                  const open = expanded.has(row.id);

                  return (
                    <AuditRow key={row.id} row={row} open={open} onToggle={() => toggle(row.id)} />
                  );
                })}

            {isEmpty ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="p-0">
                  <EmptyState
                    compact
                    title="조건에 맞는 기록이 없어요"
                    description="기간을 넓히거나 액션·대상 필터를 지워 보세요. 기간을 비우면 최근 기록부터 나옵니다."
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditRow({
  row,
  open,
  onToggle,
}: {
  row: AdminAuditRow;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `audit-detail-${row.id}`;

  return (
    <>
      <tr className={cn('border-b align-middle', open && 'bg-accent/40')}>
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">{open ? '상세 접기' : '상세 펼치기'}</span>
          </button>
        </td>

        <td className="px-3 py-2.5">
          <TimeCell value={row.createdAt} />
        </td>

        <td className="px-3 py-2.5">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.actorLabel ?? '-'}</span>
            <span className="text-xs text-muted-foreground">
              {labelOf(AUDIT_ACTOR_ROLE_LABEL, row.actorRole)}
            </span>
          </div>
        </td>

        <td className="px-3 py-2.5">
          <Badge variant={AUDIT_ACTION_TONE[row.action] ?? 'muted'}>
            {labelOf(AUDIT_ACTION_LABEL, row.action)}
          </Badge>
        </td>

        <td className="hidden px-3 py-2.5 lg:table-cell">
          {row.targetType ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                {labelOf(AUDIT_TARGET_TYPE_LABEL, row.targetType)}
              </span>
              <CopyableId value={row.targetId} />
            </div>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>

        <td className="px-3 py-2.5">
          <span className="line-clamp-2 text-muted-foreground">{row.summary ?? '-'}</span>
        </td>
      </tr>

      {open ? (
        <tr id={panelId} className="border-b bg-muted/30">
          <td colSpan={COLUMN_COUNT} className="px-3 py-3">
            <AuditDetail row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * 펼친 상세.
 *
 * before/after 를 나란히 놓는다. 감사 로그를 읽는 사람이 알고 싶은 것은 "무엇이
 * 무엇으로 바뀌었나" 하나뿐인데, 위아래로 쌓으면 그 대조가 안 된다.
 *
 * 이 영역에는 신청 금액 같은 값이 그대로 들어 있을 수 있다. 운영자는 권한상 볼 수
 * 있지만(D-07 은 이용자에게 적용되는 규칙이다), 화면을 공유하거나 캡처할 때는
 * 그대로 밖으로 나간다. 그래서 아래에 그 사실을 한 줄로 적어 둔다.
 */
function AuditDetail({ row }: { row: AdminAuditRow }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Meta label="seq (체인 순번)">
          <code className="font-mono tabular-nums">{row.seq}</code>
        </Meta>
        <Meta label="행위자 계정">
          <CopyableId value={row.actorUserId} />
        </Meta>
        <Meta label="대상">
          {row.targetType ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              {labelOf(AUDIT_TARGET_TYPE_LABEL, row.targetType)}
              <CopyableId value={row.targetId} />
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </Meta>
        <Meta label="대상 소유 계정">
          <CopyableId value={row.targetOwnerUserId} />
        </Meta>
        <Meta label="사유 코드">
          {row.reasonCode ? <code className="font-mono">{row.reasonCode}</code> : <Dash />}
        </Meta>
        <Meta label="연관 요청 (correlationId)">
          <CopyableId value={row.correlationId} />
        </Meta>
        <Meta label="체인 샤드 (chainKey)">
          <code className="font-mono">{row.chainKey}</code>
        </Meta>
        <Meta label="이전 해시 (prevHash)">
          <Hash value={row.prevHash} />
        </Meta>
        <Meta label="이 행 해시 (rowHash)">
          <Hash value={row.rowHash} />
        </Meta>
      </dl>

      {row.reasonMemo ? (
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs font-semibold text-muted-foreground">남긴 사유</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {row.reasonMemo}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <JsonBlock title="변경 전 (beforeJson)" value={row.beforeJson} />
        <JsonBlock title="변경 후 (afterJson)" value={row.afterJson} />
      </div>

      <p className="text-xs text-muted-foreground">
        본문에는 신청 금액·연락처 같은 값이 가공 없이 들어 있을 수 있습니다. 화면을 공유하거나
        캡처할 때 그대로 나간다는 점을 염두에 두세요.
      </p>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all">{children}</dd>
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground">-</span>;
}

/** 해시는 64자라 그대로 두면 표가 밀린다. 앞뒤만 보여주고 전체는 title 로 준다. */
function Hash({ value }: { value: string | null }) {
  if (!value) return <Dash />;

  const short = value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

  return (
    <code className="font-mono" title={value}>
      {short}
    </code>
  );
}

/** JSON 한 덩어리. 값이 없으면 "없음"이라고 적는다 — 빈 상자는 로딩처럼 보인다. */
function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const empty = value === null || value === undefined;

  return (
    <div className="min-w-0 rounded-lg border bg-card">
      <p className="border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground">{title}</p>
      {empty ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">없음</p>
      ) : (
        <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed">
          {safeStringify(value)}
        </pre>
      )}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // 순환 참조 같은 것이 올 일은 없지만, 감사 화면이 통째로 죽는 것보다는 낫다.
    return String(value);
  }
}
