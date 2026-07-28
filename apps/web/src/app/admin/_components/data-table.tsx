'use client';

import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { toUserMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * 콘솔의 표.
 *
 * 세 가지를 한 곳에서 해결하려고 만든다 — 로딩(스켈레톤 행), 비어 있음, 실패.
 * 화면마다 따로 쓰면 어떤 표는 스피너가 돌고 어떤 표는 그냥 비는데,
 * 운영자는 그 차이를 "데이터가 없다"로 잘못 읽는다.
 *
 * **정렬은 현재 페이지 안에서만 동작한다.** 백엔드 목록 엔드포인트는 정렬 파라미터를
 * 받지 않고(심사 큐는 slaDueAt, 검수 큐는 제출 순으로 고정이다), 커서 페이지네이션과
 * 임의 정렬은 애초에 같이 갈 수 없다. 그래서 헤더에 그 사실을 적어 둔다 —
 * 전체가 정렬된 것처럼 보이면 운영자가 "제일 오래된 건"을 놓친다.
 */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** 정렬 가능하게 하려면 비교에 쓸 값을 준다. 없으면 정렬 불가. */
  sortValue?: (row: T) => string | number | null;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headClassName?: string;
  /** 좁은 화면에서 숨긴다. 보조 정보에만 쓴다. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[] | undefined;
  getRowKey: (row: T) => string;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** 행 전체를 눌러 이동. 키보드 Enter 도 같이 동작한다. */
  rowHref?: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  /** 로딩 스켈레톤 행 수. 실제 페이지 크기와 비슷하게. */
  skeletonRows?: number;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  isLoading,
  isFetching,
  error,
  onRetry,
  rowHref,
  emptyTitle = '해당하는 항목이 없어요',
  emptyDescription,
  emptyAction,
  skeletonRows = 8,
}: DataTableProps<T>) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows;

    const column = columns.find((item) => item.key === sort.key);
    const read = column?.sortValue;
    if (!read) return rows;

    const factor = sort.direction === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      const left = read(a);
      const right = read(b);

      // 빈 값은 방향과 무관하게 항상 뒤로 보낸다. 심사 큐에서 "아직 제출 안 됨"이
      // 맨 위로 올라오면 정렬을 켠 의미가 없다.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;

      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left).localeCompare(String(right), 'ko') * factor;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  if (error) {
    return (
      <ErrorState
        title="목록을 불러오지 못했어요"
        description={toUserMessage(error)}
        {...(onRetry ? { onRetry } : {})}
      />
    );
  }

  const showSkeleton = isLoading || rows === undefined;
  const isEmpty = !showSkeleton && (sorted?.length ?? 0) === 0;

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
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const sortable = Boolean(column.sortValue);

                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cn(
                      'whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.hideOnMobile && 'hidden lg:table-cell',
                      column.headClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded hover:text-foreground',
                          active && 'text-foreground',
                        )}
                        title="현재 페이지 안에서만 정렬합니다"
                      >
                        {column.header}
                        {active ? (
                          sort?.direction === 'asc' ? (
                            <ArrowUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {showSkeleton
              ? Array.from({ length: skeletonRows }).map((_, index) => (
                  <tr key={index} className="border-b last:border-b-0">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn('px-3 py-2.5', column.hideOnMobile && 'hidden lg:table-cell')}
                      >
                        <Skeleton className="h-4 w-full max-w-[10rem]" />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted?.map((row) => {
                  const href = rowHref?.(row);

                  return (
                    <tr
                      key={getRowKey(row)}
                      {...(href
                        ? {
                            tabIndex: 0,
                            onClick: () => router.push(href),
                            onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                              // 행 안의 버튼에서 누른 Enter 까지 가로채면 조치가 두 번 일어난다.
                              if (event.target !== event.currentTarget) return;
                              if (event.key === 'Enter') router.push(href);
                            },
                          }
                        : {})}
                      className={cn(
                        'border-b align-middle last:border-b-0',
                        href &&
                          'cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      )}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            'px-3 py-2.5',
                            column.align === 'right' && 'text-right',
                            column.align === 'center' && 'text-center',
                            column.hideOnMobile && 'hidden lg:table-cell',
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}

            {isEmpty ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <EmptyState
                    compact
                    title={emptyTitle}
                    {...(emptyDescription ? { description: emptyDescription } : {})}
                    {...(emptyAction ? { action: emptyAction } : {})}
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {sort ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          지금 보고 있는 페이지 안에서만 정렬했습니다. 전체 순서는 서버가 정한 큐 순서(심사는
          SLA 기한, 검수는 제출 순)를 따릅니다.
        </p>
      ) : null}
    </div>
  );
}

/**
 * 커서 페이지 이동.
 *
 * 총 개수를 보여주지 않는다 — 커서 페이지네이션에는 총 개수가 없고, 큰 테이블에서
 * COUNT 를 따로 돌리는 비용이 이 화면이 얻는 값어치보다 크다.
 */
export function CursorPager({
  page,
  canPrev,
  hasMore,
  onPrev,
  onNext,
  isFetching,
  countOnPage,
}: {
  page: number;
  canPrev: boolean;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
  isFetching?: boolean;
  countOnPage?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {page}쪽
        {typeof countOnPage === 'number' ? ` · 이 페이지 ${countOnPage}건` : ''}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPrev || isFetching}
          onClick={onPrev}
          leadingIcon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
        >
          이전
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasMore || isFetching}
          onClick={onNext}
          trailingIcon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
        >
          다음
        </Button>
      </div>
    </div>
  );
}
