'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Badge, Chip, SkeletonList, Tabs, TabsList, TabsTrigger } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import { labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import type { PartnerApprovalStatus } from '@/types/api';

import { AdminPage, AuditNotice, Panel, SearchField, SlaBadge, TimeCell, Toolbar } from '../_components/console';
import { CursorPager, DataTable, type Column } from '../_components/data-table';
import { PartnerActions } from '../_components/partner-actions';
import { PARTNER_APPROVAL_LABEL, PARTNER_APPROVAL_TONE } from '../_lib/labels';
import { useFilters } from '../_lib/use-cursor';
import type { AdminPartnerPage, AdminPartnerRow } from '../_lib/types';

/**
 * 탭 값. 'ALL' 은 승인 상태가 아니라 "전체 명부" 모드를 뜻한다.
 *
 * 서버의 status 는 생략하면 PENDING 으로 떨어지므로, "전체"를 표현하려면 별도 신호가
 * 필요하다. 그래서 이 값일 때만 status 대신 all=true 를 보낸다.
 */
type PartnerTab = PartnerApprovalStatus | 'ALL';

/** 큐 탭. 순서가 곧 처리 흐름이다 — 대기 → 보완 → 결과. 맨 뒤에 전체 명부. */
const TABS: Array<{ value: PartnerTab; label: string }> = [
  { value: 'PENDING', label: '심사 대기' },
  { value: 'RESUBMIT_REQUIRED', label: '보완 요청' },
  { value: 'APPROVED', label: '승인 완료' },
  { value: 'REJECTED', label: '반려' },
  { value: 'SUSPENDED', label: '활동 정지' },
  { value: 'REVOKED', label: '자격 박탈' },
  { value: 'ALL', label: '전체' },
];

const PAGE_SIZE = 25;

export default function AdminPartnersPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} />}>
      <PartnersQueue />
    </Suspense>
  );
}

/**
 * 파트너 심사 큐. (D-09)
 *
 * 기본 정렬은 서버가 정한 `slaDueAt` 오름차순이다 — 생성순으로 보면 재제출로 다시
 * 들어온 건이 큐 끝으로 밀려 SLA 를 넘긴다. 그래서 표의 정렬 버튼은
 * "지금 페이지 안에서만" 동작하고, 그 사실을 표 아래에 적어 둔다.
 */
function PartnersQueue() {
  const searchParams = useSearchParams();

  const { filters, setFilter, cursor } = useFilters({
    status: 'PENDING' as PartnerTab,
    // 대시보드의 "SLA 초과" 타일에서 넘어오면 켜진 상태로 시작한다.
    overdueOnly: searchParams?.get('overdue') === '1',
    q: '',
  });

  const query = useQuery({
    queryKey: qk.admin.partners({ ...filters, cursor: cursor.cursor }),
    queryFn: () =>
      apiGet<AdminPartnerPage>('/api/admin/partners', {
        query: {
          // 'ALL' 은 서버의 PartnerApprovalStatus 가 아니다. status 를 아예 빼고
          // all=true 를 보내야 상태 필터가 풀린다.
          ...(filters.status === 'ALL' ? { all: true } : { status: filters.status }),
          // false 를 보내면 문자열 "false" 가 되어 서버에서 참으로 읽힐 여지가 있다.
          // 켜졌을 때만 보낸다.
          ...(filters.overdueOnly ? { overdueOnly: true } : {}),
          q: filters.q,
          cursor: cursor.cursor,
          limit: PAGE_SIZE,
        },
      }),
  });

  const columns: Array<Column<AdminPartnerRow>> = [
    {
      key: 'contactName',
      header: '담당자',
      sortValue: (row) => row.contactName,
      cell: (row) => (
        <Link
          href={`/admin/partners/${row.id}`}
          className="font-semibold hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.contactName}
        </Link>
      ),
    },
    {
      key: 'contactEmail',
      header: '연락 이메일',
      sortValue: (row) => row.contactEmail,
      cell: (row) => <span className="text-muted-foreground">{row.contactEmail}</span>,
    },
    {
      key: 'submittedAt',
      header: '제출',
      hideOnMobile: true,
      sortValue: (row) => (row.submittedAt ? new Date(row.submittedAt).getTime() : null),
      cell: (row) => <TimeCell value={row.submittedAt} />,
    },
    {
      key: 'slaDueAt',
      header: 'SLA 기한',
      sortValue: (row) => (row.slaDueAt ? new Date(row.slaDueAt).getTime() : null),
      cell: (row) => <SlaBadge dueAt={row.slaDueAt} />,
    },
    {
      key: 'resubmitCount',
      header: '재제출',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.resubmitCount,
      cell: (row) =>
        row.resubmitCount > 0 ? (
          <Badge variant="secondary" size="sm">
            {row.resubmitCount}회
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'status',
      header: '상태',
      cell: (row) => (
        <Badge variant={PARTNER_APPROVAL_TONE[row.approvalStatus] ?? 'muted'}>
          {labelOf(PARTNER_APPROVAL_LABEL, row.approvalStatus)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '조치',
      align: 'right',
      cell: (row) => (
        <div
          className="flex justify-end"
          // 행 클릭(상세 이동)이 버튼까지 삼키지 않게 한다.
          onClick={(event) => event.stopPropagation()}
        >
          <PartnerActions profileId={row.id} status={row.approvalStatus} compact />
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="파트너 심사"
      description="SLA 기한이 이른 순서로 쌓입니다. 승인·반려·보완 요청 모두 파트너에게 알림이 나갑니다."
    >
      <AuditNotice />

      <Tabs
        value={filters.status}
        onValueChange={(value) => setFilter('status', value as PartnerApprovalStatus)}
      >
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
          label="담당자 · 이메일 검색"
          placeholder="이름이나 이메일 일부"
        />
        <div className="pb-0.5">
          <Chip
            selected={filters.overdueOnly}
            onClick={() => setFilter('overdueOnly', !filters.overdueOnly)}
          >
            SLA 초과만
          </Chip>
        </div>
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
          rowHref={(row) => `/admin/partners/${row.id}`}
          skeletonRows={8}
          emptyTitle="이 조건에 맞는 신청서가 없어요"
          emptyDescription={
            filters.overdueOnly
              ? 'SLA 를 넘긴 건이 없습니다. 필터를 끄면 전체 큐를 볼 수 있어요.'
              : '탭을 바꾸거나 검색어를 지워 보세요.'
          }
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
