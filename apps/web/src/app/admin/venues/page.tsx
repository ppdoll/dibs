'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Badge, SkeletonList, Tabs, TabsList, TabsTrigger } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import { labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import type { VenueStatus } from '@/types/api';

import { AdminPage, AuditNotice, Maybe, Panel, SearchField, TimeCell, Toolbar } from '../_components/console';
import { CategoryFilterNotice } from '../_components/category-filter-notice';
import { CursorPager, DataTable, type Column } from '../_components/data-table';
import { VenueActions } from '../_components/venue-actions';
import { VENUE_STATUS_LABEL, VENUE_STATUS_TONE } from '../_lib/labels';
import { useFilters } from '../_lib/use-cursor';
import type { AdminVenuePage, AdminVenueRow } from '../_lib/types';

const TABS: Array<{ value: VenueStatus; label: string }> = [
  { value: 'PENDING_REVIEW', label: '검수 대기' },
  { value: 'ACTIVE', label: '노출 중' },
  { value: 'HIDDEN', label: '노출 중단' },
  { value: 'SUSPENDED', label: '정지' },
  { value: 'DRAFT', label: '작성 중' },
  { value: 'ARCHIVED', label: '보관됨' },
];

const PAGE_SIZE = 25;

/**
 * 시설 검수 큐.
 *
 * 기본 정렬은 제출 순서다(서버가 `submittedForReviewAt` 오름차순으로 준다).
 * 먼저 낸 파트너가 먼저 열린다는 약속이라, 화면에서 순서를 바꾸지 않는다.
 */
export default function AdminVenuesPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 경계가 필요하다.
  // 없으면 빌드가 페이지 전체를 동적 렌더링으로 떨어뜨린다.
  return (
    <Suspense fallback={<SkeletonList count={6} />}>
      <VenueQueue />
    </Suspense>
  );
}

function VenueQueue() {
  const searchParams = useSearchParams();
  const categoryId = searchParams?.get('categoryId') ?? '';

  const { filters, setFilter, cursor } = useFilters({
    // 업종으로 넘어왔을 때는 상태를 비워 둔다. 서버도 같은 조건에서 상태 기본값을
    // 걸지 않으므로, 여기서 검수 대기를 강제하면 "시설 3곳"과 목록이 어긋난다.
    status: (categoryId ? '' : 'PENDING_REVIEW') as VenueStatus | '',
    q: '',
    categoryId,
  });

  const query = useQuery({
    queryKey: qk.admin.venues({ ...filters, cursor: cursor.cursor }),
    queryFn: () =>
      apiGet<AdminVenuePage>('/api/admin/venues', {
        query: {
          status: filters.status,
          q: filters.q,
          categoryId: filters.categoryId,
          cursor: cursor.cursor,
          limit: PAGE_SIZE,
        },
      }),
  });

  const columns: Array<Column<AdminVenueRow>> = [
    {
      key: 'name',
      header: '시설명',
      sortValue: (row) => row.name,
      cell: (row) => (
        <Link
          href={`/admin/venues/${row.id}`}
          className="font-semibold hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'region',
      header: '지역',
      hideOnMobile: true,
      sortValue: (row) => `${row.sido ?? ''} ${row.sigungu ?? ''}`,
      cell: (row) =>
        row.sido || row.sigungu ? (
          <span className="text-muted-foreground">
            {[row.sido, row.sigungu].filter(Boolean).join(' ')}
          </span>
        ) : (
          <Maybe value={null} />
        ),
    },
    {
      key: 'imageCount',
      header: '사진',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.imageCount,
      cell: (row) => <span className="tabular-nums">{row.imageCount}</span>,
    },
    {
      key: 'openEventCount',
      header: '진행 이벤트',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.openEventCount,
      cell: (row) => <span className="tabular-nums">{row.openEventCount}</span>,
    },
    {
      key: 'submittedForReviewAt',
      header: '검수 요청',
      sortValue: (row) =>
        row.submittedForReviewAt ? new Date(row.submittedForReviewAt).getTime() : null,
      cell: (row) => <TimeCell value={row.submittedForReviewAt} />,
    },
    {
      key: 'status',
      header: '상태',
      cell: (row) => (
        <Badge variant={VENUE_STATUS_TONE[row.status] ?? 'muted'}>
          {labelOf(VENUE_STATUS_LABEL, row.status)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '조치',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <VenueActions venueId={row.id} status={row.status} compact />
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="시설 검수"
      description="검수 요청이 들어온 순서로 쌓입니다. 승인하면 곧바로 이용자 검색에 노출돼요."
    >
      <AuditNotice />

      {filters.categoryId ? (
        <CategoryFilterNotice
          categoryId={filters.categoryId}
          onClear={() => {
            setFilter('categoryId', '');
            // 업종 필터를 풀면 상태 기본값(검수 대기)으로 돌아간다.
            // 빈 상태로 두면 탭이 아무것도 선택되지 않은 채 전체가 나와 혼란스럽다.
            setFilter('status', 'PENDING_REVIEW');
          }}
        />
      ) : null}

      <Tabs value={filters.status} onValueChange={(value) => setFilter('status', value as VenueStatus)}>
        <TabsList scrollable>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Toolbar>
        <SearchField
          value={filters.q}
          onSubmit={(value) => setFilter('q', value)}
          label="시설명 검색"
          placeholder="시설 이름 일부"
        />
      </Toolbar>

      <Panel bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={query.data?.items}
          getRowKey={(row) => row.id}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          rowHref={(row) => `/admin/venues/${row.id}`}
          emptyTitle="이 조건에 맞는 시설이 없어요"
          emptyDescription="탭을 바꾸거나 검색어를 지워 보세요."
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
