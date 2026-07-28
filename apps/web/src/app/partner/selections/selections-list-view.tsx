'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ListChecks, Megaphone } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout';
import { useAuth } from '@/providers/auth-provider';
import { qk } from '@/lib/query-keys';
import {
  EVENT_MODE_LABEL,
  formatCountdown,
  formatDateTimeKo,
  formatNumber,
  labelOf,
} from '@/lib/format';
import type { PartnerEvent } from '@/types/api';

import { listPartnerEvents } from '../_lib/api';

/**
 * 발표 대기 / 발표 완료 이벤트 목록.
 *
 * 라운드 정보(커트라인·선정 인원)를 여기서 같이 보여주지 않는 이유:
 * 라운드는 이벤트마다 따로 조회해야 해서(GET /partner/selections/by-event/:id)
 * 목록 길이만큼 요청이 늘어난다. 게다가 그 응답에는 커트라인 금액이 들어 있어
 * 목록 화면에 뿌리면 D-07 이 감추려는 숫자가 필요 없는 곳까지 흘러간다.
 * 여기서는 "무엇을 눌러야 하는가"만 보여주고, 숫자는 확정 화면에서 본다.
 */
export function SelectionsListView() {
  const { isApprovedPartner } = useAuth();

  const closed = useQuery({
    queryKey: qk.partner.events.list({ status: 'CLOSED', limit: 50 }),
    queryFn: () => listPartnerEvents({ status: 'CLOSED', limit: 50 }),
    enabled: isApprovedPartner,
  });

  const finalized = useQuery({
    queryKey: qk.partner.events.list({ status: 'FINALIZED', limit: 50 }),
    queryFn: () => listPartnerEvents({ status: 'FINALIZED', limit: 50 }),
    enabled: isApprovedPartner,
  });

  const waiting = closed.data?.items ?? [];
  const done = finalized.data?.items ?? [];

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="당첨자 발표"
        description="마감된 이벤트의 명단을 확정하고 발표해요."
      />

      <section className="mt-6">
        <SectionTitle
          icon={<Megaphone className="h-5 w-5 text-primary" aria-hidden="true" />}
          title="발표 대기"
          count={waiting.length}
        />

        {closed.isLoading ? (
          <SkeletonList count={2} />
        ) : closed.isError ? (
          <ErrorState
            title="목록을 불러오지 못했어요"
            onRetry={() => void closed.refetch()}
          />
        ) : waiting.length === 0 ? (
          <EmptyState
            compact
            title="발표를 기다리는 이벤트가 없어요"
            description="이벤트가 마감되면 여기에 나타나요."
          />
        ) : (
          <ul className="space-y-3">
            {waiting.map((event) => (
              <EventRow key={event.id} event={event} actionLabel="명단 확정하기" primary />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle
          icon={<ListChecks className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          title="발표 완료"
          count={done.length}
        />

        {finalized.isLoading ? (
          <SkeletonList count={2} />
        ) : done.length === 0 ? (
          <EmptyState compact title="아직 발표한 이벤트가 없어요" />
        ) : (
          <ul className="space-y-3">
            {done.map((event) => (
              <EventRow key={event.id} event={event} actionLabel="명단 보기" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
      {icon}
      {title}
      <span className="text-sm font-normal text-muted-foreground">{formatNumber(count)}</span>
    </h2>
  );
}

function EventRow({
  event,
  actionLabel,
  primary = false,
}: {
  event: PartnerEvent;
  actionLabel: string;
  primary?: boolean;
}) {
  // 순위 확정 시각 = 마감 + 예약금 윈도우. 이 시각이 지나야 라운드를 열 수 있다(D-04).
  const lockAt = event.rankingLockAt ? new Date(event.rankingLockAt) : null;
  const lockPassed = lockAt === null || lockAt.getTime() <= Date.now();

  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{labelOf(EVENT_MODE_LABEL, event.mode)}</Badge>
              {!lockPassed && (
                <Badge variant="warning">
                  순위 확정 {formatCountdown(lockAt)} 남음
                </Badge>
              )}
            </div>

            <p className="truncate font-medium">{event.title}</p>

            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>정원 {formatNumber(event.capacity)}명</span>
              <span aria-hidden="true">·</span>
              <span>신청 {formatNumber(event.liveApplicantCount)}명</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                마감 {formatDateTimeKo(event.applyEndAt)}
              </span>
            </p>

            {!lockPassed && (
              <p className="mt-1 text-xs text-muted-foreground">
                예약금 입금 시간이 끝나야 순위가 확정돼요. 마감 직전 신청자도 입금할 시간이
                있어야 하니까요.
              </p>
            )}
          </div>

          <Link
            href={`/partner/events/${event.id}/selection`}
            className={buttonVariants({
              variant: primary && lockPassed ? 'primary' : 'outline',
              size: 'sm',
            })}
          >
            {actionLabel}
          </Link>
        </CardContent>
      </Card>
    </li>
  );
}
