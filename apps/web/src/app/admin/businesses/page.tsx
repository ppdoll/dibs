'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { Badge, Tabs, TabsList, TabsTrigger } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import { labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import type { BusinessVerificationStatus } from '@/types/api';

import { AdminPage, AuditNotice, Notice, Panel, SearchField, TimeCell, Toolbar } from '../_components/console';
import { BusinessActions } from '../_components/business-actions';
import { CursorPager, DataTable, type Column } from '../_components/data-table';
import {
  BUSINESS_STATUS_LABEL,
  BUSINESS_STATUS_TONE,
  BUSINESS_TYPE_LABEL,
} from '../_lib/labels';
import { useFilters } from '../_lib/use-cursor';
import type { AdminBusinessPage, AdminBusinessRow } from '../_lib/types';

const TABS: Array<{ value: BusinessVerificationStatus; label: string }> = [
  { value: 'PENDING', label: '확인 대기' },
  { value: 'VERIFIED', label: '확인 완료' },
  { value: 'REJECTED', label: '반려' },
  { value: 'REVOKED', label: '확인 취소' },
  { value: 'UNSUBMITTED', label: '미제출' },
];

const PAGE_SIZE = 25;

/**
 * 사업자 진위 확인 큐.
 *
 * 목록에는 사업자등록번호를 싣지 않는다 — 서버가 아예 보내지 않는다.
 * 번호가 필요한 순간은 상세 하나뿐이고, 그 조회는 `PII_ACCESSED` 로 감사된다.
 */
export default function AdminBusinessesPage() {
  const { filters, setFilter, cursor } = useFilters({
    status: 'PENDING' as BusinessVerificationStatus,
    q: '',
  });

  const query = useQuery({
    queryKey: qk.admin.businesses({ ...filters, cursor: cursor.cursor }),
    queryFn: () =>
      apiGet<AdminBusinessPage>('/api/admin/businesses', {
        query: {
          status: filters.status,
          q: filters.q,
          cursor: cursor.cursor,
          limit: PAGE_SIZE,
        },
      }),
  });

  const columns: Array<Column<AdminBusinessRow>> = [
    {
      key: 'name',
      header: '상호',
      sortValue: (row) => row.name,
      cell: (row) => (
        <Link
          href={`/admin/businesses/${row.id}`}
          className="font-semibold hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'legalName',
      header: '법인·대표 상호',
      sortValue: (row) => row.legalName,
      cell: (row) => <span className="text-muted-foreground">{row.legalName}</span>,
    },
    {
      key: 'businessType',
      header: '유형',
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant="outline" size="sm">
          {labelOf(BUSINESS_TYPE_LABEL, row.businessType)}
        </Badge>
      ),
    },
    {
      key: 'submittedAt',
      header: '심사 제출',
      sortValue: (row) =>
        row.verificationSubmittedAt ? new Date(row.verificationSubmittedAt).getTime() : null,
      cell: (row) => <TimeCell value={row.verificationSubmittedAt} />,
    },
    {
      key: 'status',
      header: '상태',
      cell: (row) => (
        <Badge variant={BUSINESS_STATUS_TONE[row.verificationStatus] ?? 'muted'}>
          {labelOf(BUSINESS_STATUS_LABEL, row.verificationStatus)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '조치',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <BusinessActions businessId={row.id} status={row.verificationStatus} compact />
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="사업자 확인"
      description="제출된 순서대로 쌓입니다. 사업자가 확인되어야 그 사업자의 시설이 검수를 통과할 수 있어요."
    >
      <AuditNotice />

      <Notice tone="warning" title="상세 열람은 개인정보 접근으로 기록됩니다">
        상세 화면에는 사업자등록번호·대표자명·연락처가 함께 나옵니다. 화면을 여는 순간
        <code className="mx-1 font-mono text-xs">PII_ACCESSED</code>
        감사 행이 남으니, 목록에서 처리할 수 있는 건은 목록에서 끝내 주세요.
      </Notice>

      <Tabs
        value={filters.status}
        onValueChange={(value) => setFilter('status', value as BusinessVerificationStatus)}
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
          label="상호 · 법인명 · 사업자번호 검색"
          placeholder="상호나 사업자등록번호 일부"
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
          rowHref={(row) => `/admin/businesses/${row.id}`}
          emptyTitle="이 조건에 맞는 사업자가 없어요"
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
