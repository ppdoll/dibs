'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';

import { Badge, buttonVariants } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import { formatNumber, labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

import { AdminPage, AuditNotice, FilterSelect, Notice, Panel, TimeCell, Toolbar } from '../_components/console';
import { CursorPager, DataTable, type Column } from '../_components/data-table';
import {
  BROADCAST_SEGMENT_LABEL,
  BROADCAST_STATUS_LABEL,
  BROADCAST_STATUS_TONE,
  NOTIFICATION_CHANNEL_LABEL,
  toOptions,
} from '../_lib/labels';
import { useFilters } from '../_lib/use-cursor';
import type { AdminBroadcast, AdminBroadcastPage, AdminBroadcastStatus } from '../_lib/types';

const PAGE_SIZE = 20;

/**
 * 공지 목록. (D-10)
 *
 * 발송은 한 번에 끝나지 않는다 — 대상이 많으면 배치로 나뉘고 `SENDING` 으로 남는다.
 * 그래서 이 목록에서 가장 중요한 열은 제목이 아니라 **진행 상황**이다.
 * 발송 중인 공지가 남아 있으면 목록 위에 눈에 띄게 알린다.
 */
export default function AdminBroadcastsPage() {
  const { filters, setFilter, cursor } = useFilters({ status: '' as AdminBroadcastStatus | '' });

  const query = useQuery({
    queryKey: qk.admin.broadcasts({ ...filters, cursor: cursor.cursor }),
    queryFn: () =>
      apiGet<AdminBroadcastPage>('/api/admin/broadcasts', {
        query: { status: filters.status, cursor: cursor.cursor, limit: PAGE_SIZE },
      }),
    // 발송 중인 건이 있으면 진행 숫자가 계속 바뀐다.
    refetchInterval: 30_000,
  });

  const inFlight = (query.data?.items ?? []).filter(
    (item) => item.status === 'SENDING' || item.status === 'EXPANDING',
  );

  const columns: Array<Column<AdminBroadcast>> = [
    {
      key: 'titleKo',
      header: '제목',
      sortValue: (row) => row.titleKo,
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={`/admin/broadcasts/${row.id}`}
            className="font-semibold hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.titleKo}
          </Link>
          <p className="line-clamp-1 text-xs text-muted-foreground">{row.bodyKo}</p>
        </div>
      ),
    },
    {
      key: 'segment',
      header: '대상',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {labelOf(BROADCAST_SEGMENT_LABEL, row.segment)}
        </span>
      ),
    },
    {
      key: 'channels',
      header: '채널',
      hideOnMobile: true,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.channels.map((channel) => (
            <Badge key={channel} variant="outline" size="sm">
              {labelOf(NOTIFICATION_CHANNEL_LABEL, channel)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'status',
      header: '상태',
      cell: (row) => (
        <Badge variant={BROADCAST_STATUS_TONE[row.status] ?? 'muted'}>
          {labelOf(BROADCAST_STATUS_LABEL, row.status)}
        </Badge>
      ),
    },
    {
      key: 'progress',
      header: '발송',
      align: 'right',
      sortValue: (row) => row.sentCount,
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatNumber(row.sentCount)}
          <span className="text-muted-foreground"> / {formatNumber(row.totalRecipients)}</span>
          {row.failedCount > 0 ? (
            <span className="ml-1.5 text-xs text-destructive">실패 {row.failedCount}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: '작성',
      hideOnMobile: true,
      sortValue: (row) => new Date(row.createdAt).getTime(),
      cell: (row) => <TimeCell value={row.createdAt} />,
    },
  ];

  return (
    <AdminPage
      title="공지 발송"
      description="세그먼트를 골라 앱 내 알림과 이메일로 보냅니다. 발송된 쪽지는 회수할 수 없어요."
      actions={
        <Link href="/admin/broadcasts/new" className={cn(buttonVariants({ size: 'sm' }))}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          공지 작성
        </Link>
      }
    >
      <AuditNotice />

      {inFlight.length > 0 ? (
        <Notice tone="warning" title={`발송이 진행 중인 공지 ${inFlight.length}건`}>
          대상이 많으면 한 번의 호출로 다 보내지 못하고 이어서 보내야 합니다. 각 공지 상세에서
          &ldquo;이어서 발송&rdquo;을 눌러 마무리하세요.
        </Notice>
      ) : null}

      <Toolbar>
        <FilterSelect
          label="상태"
          value={filters.status}
          allLabel="전체"
          options={toOptions(BROADCAST_STATUS_LABEL)}
          onChange={(value) => setFilter('status', value as AdminBroadcastStatus | '')}
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
          rowHref={(row) => `/admin/broadcasts/${row.id}`}
          emptyTitle="아직 공지가 없어요"
          emptyDescription="세그먼트를 골라 첫 공지를 작성해 보세요."
          emptyAction={
            <Link href="/admin/broadcasts/new" className={cn(buttonVariants({ size: 'sm' }))}>
              <Megaphone className="h-4 w-4" aria-hidden="true" />
              공지 작성
            </Link>
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
