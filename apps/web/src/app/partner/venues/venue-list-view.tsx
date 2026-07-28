'use client';

import { useQuery } from '@tanstack/react-query';
import { ImageIcon, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { PartnerShell } from '@/components/layout';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/tabs';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { listVenues } from '../_lib/api';
import { PartnerPageHeader, VenueStatusBadge } from '../_components/partner-page';
import { toPartnerMessage } from '../_lib/errors';
import type { VenueStatus } from '@/types/api';

/** 필터 칩. "전체" 는 status 를 아예 안 보내는 것과 같다. */
const STATUS_FILTERS: { value: VenueStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'ACTIVE', label: '노출 중' },
  { value: 'PENDING_REVIEW', label: '검수 중' },
  { value: 'DRAFT', label: '작성 중' },
  { value: 'HIDDEN', label: '노출 중단' },
  { value: 'ARCHIVED', label: '보관됨' },
];

export function VenueListView() {
  return (
    <PartnerShell>
      <VenueListBody />
    </PartnerShell>
  );
}

function VenueListBody() {
  const [status, setStatus] = useState<VenueStatus | 'ALL'>('ALL');

  const params = { limit: 50, ...(status === 'ALL' ? {} : { status }) };

  const venues = useQuery({
    queryKey: qk.partner.venues.list(params),
    queryFn: () => listVenues(params),
    staleTime: 30_000,
  });

  const items = venues.data?.items ?? [];

  return (
    <>
      <PartnerPageHeader
        title="내 시설"
        description="시설을 만들고 사진을 올린 뒤 검수를 요청하면, 승인된 시설에서 예약 이벤트를 열 수 있어요."
        actions={
          <Link href="/partner/venues/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            시설 만들기
          </Link>
        }
      />

      <ChipGroup className="mb-4">
        {STATUS_FILTERS.map((filter) => (
          <Chip
            key={filter.value}
            selected={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </Chip>
        ))}
      </ChipGroup>

      {venues.isLoading ? (
        <SkeletonList count={3} />
      ) : venues.isError ? (
        <ErrorState
          title="시설 목록을 불러오지 못했어요"
          description={toPartnerMessage(venues.error)}
          onRetry={() => void venues.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Store className="h-6 w-6" aria-hidden="true" />}
          title={status === 'ALL' ? '등록된 시설이 없어요' : '이 상태의 시설이 없어요'}
          description={
            status === 'ALL'
              ? '사업자 확인이 끝났다면 시설을 만들 수 있어요.'
              : '다른 상태를 눌러 보세요.'
          }
          action={
            status === 'ALL' ? (
              <Link href="/partner/venues/new" className={buttonVariants({ variant: 'primary' })}>
                시설 만들기
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((venue) => (
            <li key={venue.id}>
              <Card interactive className="h-full">
                <CardContent className="flex gap-3 p-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                    {venue.coverImageUrl ? (
                      // 외부 이미지 도메인 설정에 기대지 않으려고 next/image 대신 img 를 쓴다.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={venue.coverImageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-6 w-6" aria-hidden="true" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/partner/venues/${venue.id}`}
                        className="truncate font-semibold hover:underline"
                      >
                        {venue.name}
                      </Link>
                      <VenueStatusBadge status={venue.status} />
                    </div>

                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {venue.sido} {venue.sigungu}
                      {venue.summary ? ` · ${venue.summary}` : ''}
                    </p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      사진 {formatNumber(venue.imageCount)}장 · 진행 중 이벤트{' '}
                      {formatNumber(venue.openEventCount)}건
                    </p>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Link
                        href={`/partner/venues/${venue.id}/images`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        사진 관리
                      </Link>
                      <Link
                        href={`/partner/events?venueId=${venue.id}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        이벤트 보기
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
