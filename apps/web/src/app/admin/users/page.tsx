'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Badge, SkeletonList } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import { labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import type { AccountStatus, UserRole } from '@/types/api';

import {
  AdminPage,
  AuditNotice,
  FilterSelect,
  Notice,
  Panel,
  SearchField,
  TimeCell,
  Toolbar,
} from '../_components/console';
import { CursorPager, DataTable, type Column } from '../_components/data-table';
import { UserActions } from '../_components/user-actions';
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, USER_ROLE_LABEL, toOptions } from '../_lib/labels';
import { useFilters } from '../_lib/use-cursor';
import type { AdminUserPage, AdminUserRow } from '../_lib/types';

const PAGE_SIZE = 25;

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} />}>
      <UsersSearch />
    </Suspense>
  );
}

/**
 * 회원 검색.
 *
 * 목록의 이메일은 서버가 마스킹해서 보낸다. 원본은 상세에서만 나오고 그 조회는
 * 감사된다 — 운영자 권한이 있다는 것과 수백 명의 연락처를 한 화면에 띄워도 된다는
 * 것은 다른 이야기다.
 */
function UsersSearch() {
  const searchParams = useSearchParams();

  const { filters, setFilter, cursor } = useFilters({
    q: '',
    status: (searchParams?.get('status') ?? '') as AccountStatus | '',
    role: '' as UserRole | '',
  });

  const query = useQuery({
    queryKey: qk.admin.users({ ...filters, cursor: cursor.cursor }),
    queryFn: () =>
      apiGet<AdminUserPage>('/api/admin/users', {
        query: {
          q: filters.q,
          status: filters.status,
          role: filters.role,
          cursor: cursor.cursor,
          limit: PAGE_SIZE,
        },
      }),
  });

  const columns: Array<Column<AdminUserRow>> = [
    {
      key: 'displayName',
      header: '닉네임',
      sortValue: (row) => row.displayName,
      cell: (row) => (
        <Link
          href={`/admin/users/${row.id}`}
          className="font-semibold hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.displayName}
        </Link>
      ),
    },
    {
      key: 'email',
      header: '이메일 (마스킹)',
      cell: (row) => <span className="text-muted-foreground">{row.email ?? '-'}</span>,
    },
    {
      key: 'roles',
      header: '역할',
      hideOnMobile: true,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.roles.map((role) => (
            <Badge key={role} variant={role === 'ADMIN' ? 'default' : 'outline'} size="sm">
              {labelOf(USER_ROLE_LABEL, role)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'status',
      header: '상태',
      cell: (row) => (
        <span className="inline-flex flex-col gap-0.5">
          <Badge variant={ACCOUNT_STATUS_TONE[row.status] ?? 'muted'}>
            {labelOf(ACCOUNT_STATUS_LABEL, row.status)}
          </Badge>
          {row.status === 'SUSPENDED' && row.statusReason ? (
            <span className="max-w-[16rem] truncate text-xs text-muted-foreground" title={row.statusReason}>
              {row.statusReason}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: '마지막 로그인',
      hideOnMobile: true,
      sortValue: (row) => (row.lastLoginAt ? new Date(row.lastLoginAt).getTime() : null),
      cell: (row) => <TimeCell value={row.lastLoginAt} />,
    },
    {
      key: 'createdAt',
      header: '가입',
      hideOnMobile: true,
      sortValue: (row) => new Date(row.createdAt).getTime(),
      cell: (row) => <TimeCell value={row.createdAt} relative={false} />,
    },
    {
      key: 'actions',
      header: '조치',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <UserActions userId={row.id} status={row.status} roles={row.roles} compact />
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="계정"
      description="이메일·닉네임·전화번호로 찾습니다. 목록의 이메일은 마스킹된 값이에요."
    >
      <AuditNotice />

      <Notice tone="warning" title="정지는 세션을 즉시 끊습니다">
        계정을 정지하면 발급된 로그인 토큰이 전부 무효가 되어 다른 기기에서 보고 있던 화면까지
        그 자리에서 로그아웃됩니다. 역할 변경도 마찬가지예요.
      </Notice>

      <Toolbar>
        <SearchField
          value={filters.q}
          onSubmit={(value) => setFilter('q', value)}
          label="이메일 · 닉네임 · 전화번호 검색"
          placeholder="검색어를 넣고 Enter"
        />
        <FilterSelect
          label="계정 상태"
          value={filters.status}
          allLabel="전체"
          options={toOptions(ACCOUNT_STATUS_LABEL)}
          onChange={(value) => setFilter('status', value as AccountStatus | '')}
        />
        <FilterSelect
          label="역할"
          value={filters.role}
          allLabel="전체"
          options={toOptions(USER_ROLE_LABEL)}
          onChange={(value) => setFilter('role', value as UserRole | '')}
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
          rowHref={(row) => `/admin/users/${row.id}`}
          emptyTitle="조건에 맞는 계정이 없어요"
          emptyDescription="검색어를 줄이거나 필터를 지워 보세요. 탈퇴한 계정은 검색되지 않습니다."
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
