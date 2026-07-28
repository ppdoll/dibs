'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Badge, SkeletonList } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import { formatNumber, labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import type { EventStatus } from '@/types/api';

import {
  AdminPage,
  AuditNotice,
  DetailLink,
  FilterSelect,
  Panel,
  SearchField,
  TimeCell,
  Toolbar,
} from '../_components/console';
import { CategoryFilterNotice } from '../_components/category-filter-notice';
import { CursorPager, DataTable, type Column } from '../_components/data-table';
import {
  EVENT_MODE_LABEL,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_TONE,
  toOptions,
} from '../_lib/labels';
import { useFilters } from '../_lib/use-cursor';
import type { AdminEventPage, AdminEventRow } from '../_lib/types';

const PAGE_SIZE = 25;

export default function AdminEventsPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} />}>
      <EventOpsList />
    </Suspense>
  );
}

/**
 * 이벤트 운영 목록.
 *
 * 조치 버튼을 행에 두지 않는다. 강제 취소는 신청자 전원에게 알림이 나가고 되돌릴 수
 * 없는데, 표에서 한 줄 잘못 짚어 누르는 일이 실제로 일어난다. 조치는 상세에서만 한다 —
 * 무엇을 취소하는지 제목·정원·신청 수를 눈으로 확인한 뒤에.
 */
function EventOpsList() {
  const searchParams = useSearchParams();

  const { filters, setFilter, cursor } = useFilters({
    status: (searchParams?.get('status') ?? '') as EventStatus | '',
    q: '',
    partnerId: searchParams?.get('partnerId') ?? '',
    categoryId: searchParams?.get('categoryId') ?? '',
  });

  const query = useQuery({
    queryKey: qk.admin.events({ ...filters, cursor: cursor.cursor }),
    queryFn: () =>
      apiGet<AdminEventPage>('/api/admin/events/ops', {
        query: {
          status: filters.status,
          q: filters.q,
          partnerId: filters.partnerId,
          categoryId: filters.categoryId,
          cursor: cursor.cursor,
          limit: PAGE_SIZE,
        },
      }),
  });

  const columns: Array<Column<AdminEventRow>> = [
    {
      key: 'title',
      header: '이벤트',
      sortValue: (row) => row.title,
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={`/admin/events/${row.id}`}
            className="font-semibold hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.title}
          </Link>
          <p className="text-xs text-muted-foreground">{labelOf(EVENT_MODE_LABEL, row.mode)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '상태',
      cell: (row) => (
        <span className="inline-flex flex-col gap-0.5">
          <Badge variant={EVENT_STATUS_TONE[row.status] ?? 'muted'}>
            {labelOf(EVENT_STATUS_LABEL, row.status)}
          </Badge>
          {row.status === 'SUSPENDED' && row.statusBeforeSuspend ? (
            <span className="text-xs text-muted-foreground">
              정지 전: {labelOf(EVENT_STATUS_LABEL, row.statusBeforeSuspend)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'capacity',
      header: '정원 · 신청',
      align: 'right',
      sortValue: (row) => row.liveApplicantCount,
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatNumber(row.capacity)}
          <span className="mx-1 text-muted-foreground">·</span>
          <strong>{formatNumber(row.liveApplicantCount)}</strong>
        </span>
      ),
    },
    {
      key: 'applyEndAt',
      header: '마감',
      sortValue: (row) => new Date(row.applyEndAt).getTime(),
      cell: (row) => (
        <span className="inline-flex flex-col">
          <TimeCell value={row.applyEndAt} />
          {row.originalApplyEndAt && row.originalApplyEndAt !== row.applyEndAt ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">연장됨</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'version',
      header: '버전',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.version,
      cell: (row) => <span className="tabular-nums text-muted-foreground">v{row.version}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <DetailLink href={`/admin/events/${row.id}`} label="운영" />
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="이벤트 운영"
      description="강제 마감·연장·정지·취소는 상세 화면에서 처리합니다. 목록은 상태를 훑는 용도예요."
    >
      <AuditNotice />

      {filters.categoryId ? (
        <CategoryFilterNotice
          categoryId={filters.categoryId}
          onClear={() => setFilter('categoryId', '')}
        />
      ) : null}

      <Toolbar>
        <SearchField
          value={filters.q}
          onSubmit={(value) => setFilter('q', value)}
          label="이벤트 제목 검색"
          placeholder="제목 일부"
        />
        <FilterSelect
          label="상태"
          value={filters.status}
          allLabel="전체"
          options={toOptions(EVENT_STATUS_LABEL)}
          onChange={(value) => setFilter('status', value as EventStatus | '')}
        />
      </Toolbar>

      {filters.partnerId ? (
        <p className="text-xs text-muted-foreground">
          파트너 <code className="font-mono">{filters.partnerId}</code> 의 이벤트만 보고 있어요.{' '}
          <button
            type="button"
            onClick={() => setFilter('partnerId', '')}
            className="font-semibold text-primary hover:underline"
          >
            필터 해제
          </button>
        </p>
      ) : null}

      <Panel bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={query.data?.items}
          getRowKey={(row) => row.id}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          rowHref={(row) => `/admin/events/${row.id}`}
          emptyTitle="조건에 맞는 이벤트가 없어요"
          emptyDescription="상태 필터를 바꾸거나 검색어를 지워 보세요."
        />
      </Panel>

      <CursorPager
        page={cursor.page}
        canPrev={cursor.canPrev}
        hasMore={query.data?.hasMore ?? false}
        onPrev={cursor.prev}
        onNext={() => cursor.next(query.data?.nextCursor ?? null)}
        isFetching={query.isFetching}
        countOnPage={query.data?.items.length ?? 0}
      />
    </AdminPage>
  );
}
