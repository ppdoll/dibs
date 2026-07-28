'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { PartnerShell } from '@/components/layout';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/tabs';
import { Countdown } from '@/components/ui/countdown';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  EVENT_MODE_LABEL,
  formatAmountRule,
  formatCapacity,
  formatDateTimeKo,
  formatNumber,
} from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { listPartnerEvents } from '../_lib/api';
import { EventStatusBadge, PartnerPageHeader } from '../_components/partner-page';
import { toPartnerMessage } from '../_lib/errors';
import type { EventStatus, PartnerEvent } from '@/types/api';

const STATUS_FILTERS: { value: EventStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'OPEN', label: '신청 중' },
  { value: 'SCHEDULED', label: '오픈 예정' },
  { value: 'CLOSED', label: '마감' },
  { value: 'FINALIZED', label: '발표 완료' },
  { value: 'DRAFT', label: '작성 중' },
  { value: 'CANCELED', label: '취소됨' },
];

/** 파트너 화면이므로 금액 규칙을 그대로 보여준다. 남의 신청 금액이 아니라 이벤트 설정값이다. */
function amountLabel(event: PartnerEvent): string {
  if (event.mode === 'INSTANT') {
    return event.fixedAmount === null ? '-' : formatAmountRule(event.fixedAmount, event.fixedAmount);
  }
  if (event.minAmount === null || event.maxAmount === null) return '-';
  return formatAmountRule(event.minAmount, event.maxAmount);
}

export function EventListView() {
  return (
    <PartnerShell>
      <EventListBody />
    </PartnerShell>
  );
}

function EventListBody() {
  const searchParams = useSearchParams();
  const venueId = searchParams.get('venueId') ?? undefined;
  const initialStatus = (searchParams.get('status') as EventStatus | null) ?? 'ALL';

  const [status, setStatus] = useState<EventStatus | 'ALL'>(initialStatus);

  const params = {
    limit: 50,
    ...(status === 'ALL' ? {} : { status }),
    ...(venueId ? { venueId } : {}),
  };

  const events = useQuery({
    queryKey: qk.partner.events.list(params),
    queryFn: () => listPartnerEvents(params),
    staleTime: 20_000,
  });

  const items = events.data?.items ?? [];

  return (
    <>
      <PartnerPageHeader
        title="이벤트"
        description="예약을 받을 자리를 만들고, 마감 뒤에 당첨자를 확정해요."
        actions={
          <Link href="/partner/events/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            이벤트 만들기
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

      {events.isLoading ? (
        <SkeletonList count={4} />
      ) : events.isError ? (
        <ErrorState
          title="이벤트를 불러오지 못했어요"
          description={toPartnerMessage(events.error)}
          onRetry={() => void events.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarRange className="h-6 w-6" aria-hidden="true" />}
          title={status === 'ALL' ? '아직 만든 이벤트가 없어요' : '이 상태의 이벤트가 없어요'}
          description={
            status === 'ALL'
              ? '노출 중인 시설이 있으면 바로 이벤트를 만들 수 있어요.'
              : '다른 상태를 눌러 보세요.'
          }
          action={
            status === 'ALL' ? (
              <Link href="/partner/events/new" className={buttonVariants({ variant: 'primary' })}>
                이벤트 만들기
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((event) => (
            <li key={event.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/partner/events/${event.id}`}
                          className="font-semibold hover:underline"
                        >
                          {event.title}
                        </Link>
                        <EventStatusBadge status={event.status} />
                        <span className="text-xs text-muted-foreground">
                          {EVENT_MODE_LABEL[event.mode]}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {amountLabel(event)} · {formatCapacity(event.capacity)}
                      </p>

                      <p className="mt-0.5 text-sm text-muted-foreground">
                        신청 기간 {formatDateTimeKo(event.applyStartAt)} ~{' '}
                        {formatDateTimeKo(event.applyEndAt)}
                        {event.originalApplyEndAt && event.softCloseExtensionCount > 0
                          ? ` (자동 연장 ${event.softCloseExtensionCount}회)`
                          : ''}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="flex items-center justify-end gap-1 text-sm font-semibold tabular-nums">
                        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {formatNumber(event.liveApplicantCount)}명
                      </p>
                      {event.status === 'OPEN' ? (
                        <Countdown target={event.applyEndAt} prefix className="text-sm" />
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                    <Link
                      href={`/partner/events/${event.id}/applicants`}
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    >
                      신청 현황
                    </Link>
                    <Link
                      href={`/partner/events/${event.id}/selection`}
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    >
                      당첨자 발표
                    </Link>
                    <Link
                      href={`/partner/events/${event.id}/messages`}
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    >
                      쪽지 보내기
                    </Link>
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
