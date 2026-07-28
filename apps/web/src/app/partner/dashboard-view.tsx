'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, Clock, FileWarning, Megaphone } from 'lucide-react';
import Link from 'next/link';

import { PartnerShell } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import {
  PARTNER_APPROVAL_LABEL,
  formatCapacity,
  formatDateTimeKo,
  formatNumber,
  labelOf,
} from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { getPartnerProfile, listPartnerEvents } from './_lib/api';
import { EventStatusBadge, InfoNote, PartnerPageHeader, StatCard } from './_components/partner-page';
import { toPartnerMessage } from './_lib/errors';
import type { PartnerEvent } from '@/types/api';

/** 마감 임박 기준. 24시간 안쪽이면 오늘 안에 손 쓸 일이 남았다는 뜻이다. */
const CLOSING_SOON_MS = 24 * 60 * 60 * 1000;

export function DashboardView() {
  return (
    <PartnerShell allowUnapproved>
      <DashboardBody />
    </PartnerShell>
  );
}

function DashboardBody() {
  const profile = useQuery({
    queryKey: qk.partner.profile,
    queryFn: getPartnerProfile,
    staleTime: 60_000,
  });

  const canOperate = profile.data?.canOperate ?? false;

  // 진행 중 / 마감(발표 대기) 두 갈래만 읽는다. 대시보드는 "지금 손 쓸 일" 만 보여주는
  // 화면이라 DRAFT·종료된 이벤트까지 세면 숫자가 많아질수록 쓸모가 없어진다.
  const openEvents = useQuery({
    queryKey: qk.partner.events.list({ status: 'OPEN', limit: 50 }),
    queryFn: () => listPartnerEvents({ status: 'OPEN', limit: 50 }),
    enabled: canOperate,
    // 마감 임박 카운트다운이 걸려 있어 주기적으로 다시 읽는다(SSE 가 없다).
    refetchInterval: 60_000,
  });

  const closedEvents = useQuery({
    queryKey: qk.partner.events.list({ status: 'CLOSED', limit: 50 }),
    queryFn: () => listPartnerEvents({ status: 'CLOSED', limit: 50 }),
    enabled: canOperate,
  });

  if (profile.isLoading) {
    return (
      <>
        <Skeleton className="mb-6 h-8 w-48" />
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <SkeletonList count={3} />
      </>
    );
  }

  if (profile.isError) {
    return (
      <ErrorState
        title="파트너 정보를 불러오지 못했어요"
        description={toPartnerMessage(profile.error)}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  const me = profile.data;
  if (!me) return null;

  const open = openEvents.data?.items ?? [];
  const closed = closedEvents.data?.items ?? [];
  const now = Date.now();
  const closingSoon = open
    .filter((event) => {
      const end = new Date(event.applyEndAt).getTime();
      return end - now > 0 && end - now <= CLOSING_SOON_MS;
    })
    .sort((a, b) => new Date(a.applyEndAt).getTime() - new Date(b.applyEndAt).getTime());

  return (
    <>
      <PartnerPageHeader
        title={`${me.contactName}님, 반가워요`}
        description="오늘 손 쓸 일만 모았어요. 자세한 내용은 왼쪽 메뉴에서 볼 수 있어요."
        actions={
          canOperate ? (
            <Link href="/partner/events/new" className={buttonVariants({ variant: 'primary' })}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              이벤트 만들기
            </Link>
          ) : null
        }
      />

      <ApprovalCard profile={me} />

      {canOperate ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="진행 중인 예약"
              value={openEvents.isLoading ? '—' : formatNumber(open.length)}
              hint="신청을 받고 있는 이벤트"
              href="/partner/events?status=OPEN"
              tone="success"
            />
            <StatCard
              label="마감 임박"
              value={openEvents.isLoading ? '—' : formatNumber(closingSoon.length)}
              hint="24시간 안에 마감돼요"
              tone={closingSoon.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="발표 대기"
              value={closedEvents.isLoading ? '—' : formatNumber(closed.length)}
              hint="마감됐고 당첨자 발표가 남았어요"
              href="/partner/selections"
              tone={closed.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="노출 중인 시설"
              value={formatNumber(me.venues.active)}
              hint={`전체 ${me.venues.total}곳`}
              href="/partner/venues"
            />
          </div>

          <ClosingSoonSection events={closingSoon} loading={openEvents.isLoading} />
          <AwaitingSelectionSection events={closed} loading={closedEvents.isLoading} />
          <OpenEventsSection events={open} loading={openEvents.isLoading} />
        </>
      ) : null}
    </>
  );
}

/**
 * 승인 상태 카드.
 *
 * 반려 사유를 그대로 보여주는 게 핵심이다. 운영자가 적어 보낸 문구를 감추면
 * 파트너는 무엇을 고쳐야 할지 알 수 없고, 결국 같은 내용으로 재제출한다.
 */
function ApprovalCard({
  profile,
}: {
  profile: {
    approvalStatus: string;
    rejectionReason: string | null;
    suspensionReason: string | null;
    slaDueAt: string | null;
    submittedAt: string | null;
    canOperate: boolean;
    businesses: { verified: number; pending: number; actionRequired: number; total: number };
  };
}) {
  const status = profile.approvalStatus;

  if (status === 'APPROVED' && profile.canOperate) {
    // 승인은 됐는데 확인된 사업자가 없으면 시설을 심사에 올릴 수 없다. 그게 다음 할 일이다.
    if (profile.businesses.verified === 0) {
      return (
        <Card className="mb-6 border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-500" aria-hidden="true" />
              사업자 확인이 남았어요
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              사업자등록증 확인이 끝나야 시설을 검수에 올릴 수 있어요.
              {profile.businesses.pending > 0
                ? ' 지금 심사 중인 사업자가 있어요.'
                : ' 사업자를 등록하고 사업자등록증을 올려 주세요.'}
            </p>
            <Link href="/partner/businesses" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              사업자 정보로 가기
            </Link>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
        <span>파트너 승인이 완료되어 이벤트를 열 수 있어요.</span>
      </div>
    );
  }

  const reason = profile.rejectionReason ?? profile.suspensionReason;

  return (
    <Card className="mb-6 border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          현재 상태
          <Badge variant="warning">{labelOf(PARTNER_APPROVAL_LABEL, status)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === 'PENDING' ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            운영자가 신청서를 확인하고 있어요.
            {profile.slaDueAt ? ` ${formatDateTimeKo(profile.slaDueAt)}까지 결과를 알려드릴 예정이에요.` : ''}
            {' '}승인이 끝나면 알림으로 알려드릴게요.
          </p>
        ) : null}

        {status === 'DRAFT' ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            아직 신청서를 제출하지 않았어요. 제출해야 심사가 시작돼요.
          </p>
        ) : null}

        {reason ? (
          <InfoNote title={status === 'SUSPENDED' ? '정지 사유' : '운영자가 남긴 내용'}>
            {reason}
          </InfoNote>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {status === 'DRAFT' || status === 'REJECTED' || status === 'RESUBMIT_REQUIRED' ? (
            <Link href="/partner/apply" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              신청서 작성하기
            </Link>
          ) : null}
          <Link href="/partner/profile" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            자세히 보기
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ icon, title, more }: { icon: React.ReactNode; title: string; more?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
        {icon}
        {title}
      </h2>
      {more}
    </div>
  );
}

function ClosingSoonSection({ events, loading }: { events: PartnerEvent[]; loading: boolean }) {
  return (
    <section>
      <SectionTitle
        icon={<Clock className="h-5 w-5 text-amber-500" aria-hidden="true" />}
        title="마감 임박"
      />
      {loading ? (
        <SkeletonList count={2} />
      ) : events.length === 0 ? (
        <EmptyState compact title="24시간 안에 마감되는 이벤트가 없어요" />
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id}>
              <EventRow event={event} highlight />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AwaitingSelectionSection({ events, loading }: { events: PartnerEvent[]; loading: boolean }) {
  return (
    <section>
      <SectionTitle
        icon={<Megaphone className="h-5 w-5 text-primary" aria-hidden="true" />}
        title="당첨자 발표 대기"
        more={
          <Link href="/partner/selections" className="text-sm text-muted-foreground hover:text-foreground">
            전체 보기
          </Link>
        }
      />
      {loading ? (
        <SkeletonList count={2} />
      ) : events.length === 0 ? (
        <EmptyState compact title="발표를 기다리는 이벤트가 없어요" />
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id}>
              <EventRow event={event} action={{ href: `/partner/events/${event.id}/selection`, label: '명단 확정하기' }} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OpenEventsSection({ events, loading }: { events: PartnerEvent[]; loading: boolean }) {
  return (
    <section className="pb-6">
      <SectionTitle
        icon={<CalendarPlus className="h-5 w-5 text-emerald-500" aria-hidden="true" />}
        title="진행 중인 예약"
        more={
          <Link href="/partner/events" className="text-sm text-muted-foreground hover:text-foreground">
            전체 보기
          </Link>
        }
      />
      {loading ? (
        <SkeletonList count={2} />
      ) : events.length === 0 ? (
        <EmptyState
          compact
          title="지금 신청을 받는 이벤트가 없어요"
          description="이벤트를 만들고 공개하면 이용자가 신청할 수 있어요."
          action={
            <Link href="/partner/events/new" className={buttonVariants({ variant: 'primary' })}>
              이벤트 만들기
            </Link>
          }
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
  );
}

function EventRow({
  event,
  highlight,
  action,
}: {
  event: PartnerEvent;
  highlight?: boolean;
  action?: { href: string; label: string };
}) {
  return (
    <div
      className={
        highlight
          ? 'rounded-lg border border-amber-500/40 bg-card p-4'
          : 'rounded-lg border bg-card p-4'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/partner/events/${event.id}`} className="font-semibold hover:underline">
              {event.title}
            </Link>
            <EventStatusBadge status={event.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCapacity(event.capacity)} · 신청 {formatNumber(event.liveApplicantCount)}명 ·
            마감 {formatDateTimeKo(event.applyEndAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {event.status === 'OPEN' ? (
            <Countdown target={event.applyEndAt} prefix className="text-sm" />
          ) : null}
          {action ? (
            <Link href={action.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {action.label}
            </Link>
          ) : (
            <Link
              href={`/partner/events/${event.id}/applicants`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              신청 현황
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
