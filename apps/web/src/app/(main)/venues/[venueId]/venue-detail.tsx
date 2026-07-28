'use client';

import { CalendarX, MapPin, Phone, Store, Users } from 'lucide-react';

import { AppShell, TopBar } from '@/components/layout';
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Separator,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import type { PublicEventCard } from '@/types/api';

import { EventRow } from '../../_components/event-card';
import { Thumb } from '../../_components/thumb';
import { useSearchEvents, useVenueCard } from '../../_lib/queries';

/**
 * 시설 상세.
 *
 * 공개 시설 단건 엔드포인트가 없어서 검색 결과에서 카드를 찾아 쓴다. 진행 중인
 * 예약도 마찬가지로 "시설명으로 검색한 뒤 venueId 가 같은 것만" 골라낸다 —
 * 검색 질의에 venueId 필터가 없기 때문이다. 둘 다 임시 다리이고,
 * 전용 엔드포인트가 생기면 이 파일에서만 바꾸면 된다.
 */
export function VenueDetail({ venueId }: { venueId: string }) {
  const venueQuery = useVenueCard(venueId);
  const venue = venueQuery.data ?? null;

  const eventsQuery = useSearchEvents(
    { keyword: venue ? venue.name.slice(0, 40) : undefined, sort: 'ending-soon' },
    venue !== null,
  );

  const events: PublicEventCard[] = (eventsQuery.data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((event) => event.venueId === venueId);

  if (venueQuery.isPending) return <VenueDetailSkeleton />;

  if (venueQuery.isError || !venue) {
    return (
      <AppShell header={<TopBar showBack title="시설" />}>
        <ErrorState
          title="시설 정보를 불러오지 못했어요"
          description="주소가 바뀌었거나 시설이 내려갔을 수 있어요."
          onRetry={() => void venueQuery.refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell bleed header={<TopBar showBack title={venue.name} />}>
      <Thumb
        src={venue.coverImageUrl}
        alt={venue.name}
        ratio="aspect-[4/3] sm:aspect-[16/9]"
        rounded="rounded-none"
      />

      <div className="px-4">
        <section className="py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="muted" size="sm">
              {venue.categoryNameKo}
            </Badge>
            {venue.openEventCount > 0 ? (
              <Badge variant="default" size="sm">
                진행 중 {venue.openEventCount}건
              </Badge>
            ) : null}
          </div>

          <h1 className="mt-2 text-xl font-extrabold leading-snug">{venue.name}</h1>

          {venue.summary ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{venue.summary}</p>
          ) : null}
        </section>

        <Separator />

        <section className="py-4">
          <h2 className="mb-2 text-base font-bold">시설 정보</h2>
          <Card>
            <CardContent className="divide-y p-0">
              <Row
                icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                label="주소"
                value={venue.roadAddress || `${venue.sido} ${venue.sigungu}`}
              />
              <Row
                icon={<Store className="h-4 w-4" aria-hidden="true" />}
                label="지역"
                value={`${venue.sido} ${venue.sigungu}`}
              />
              {venue.seatCount !== null ? (
                <Row
                  icon={<Users className="h-4 w-4" aria-hidden="true" />}
                  label="좌석"
                  value={`${venue.seatCount.toLocaleString('ko-KR')}석`}
                />
              ) : null}
            </CardContent>
          </Card>

          {/* 전화번호는 공개 시설 카드에 실려 오지 않는다. 자리만 남겨두지 않고 아예 그리지 않는다. */}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            방문 전 안내가 필요하면 예약 상세의 안내 문구를 확인해 주세요.
          </p>
        </section>

        <Separator />

        <section className="py-4 pb-8">
          <h2 className="mb-3 text-base font-bold">
            진행 중인 예약{events.length > 0 ? ` ${events.length}건` : ''}
          </h2>

          {eventsQuery.isPending ? (
            <SkeletonList count={3} />
          ) : eventsQuery.isError ? (
            <ErrorState
              title="예약 목록을 불러오지 못했어요"
              onRetry={() => void eventsQuery.refetch()}
            />
          ) : events.length === 0 ? (
            <EmptyState
              compact
              icon={<CalendarX className="h-6 w-6" aria-hidden="true" />}
              title="지금은 열려 있는 예약이 없어요"
              description="새 예약이 열리면 홈에서 가장 먼저 보여드릴게요."
            />
          ) : (
            <ul className="space-y-3">
              {events.map((event) => (
                <li key={event.id}>
                  <EventRow event={event} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function VenueDetailSkeleton() {
  return (
    <AppShell bleed header={<TopBar showBack title="시설" />}>
      <Skeleton className="aspect-[4/3] w-full rounded-none sm:aspect-[16/9]" />
      <div className="space-y-4 px-4 py-4">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <SkeletonList count={2} />
      </div>
    </AppShell>
  );
}
