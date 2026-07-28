'use client';

import { isFixedAmount } from '@dibs/shared';
import {
  CalendarDays,
  CircleAlert,
  Clock,
  Info,
  MapPin,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, StickyBottomBar, TopBar } from '@/components/layout';
import {
  Badge,
  Card,
  CardContent,
  CompetitionBar,
  CompetitionRatioLine,
  Countdown,
  ErrorState,
  Separator,
  Skeleton,
  buttonVariants,
  Button,
} from '@/components/ui';
import {
  EVENT_MODE_HINT,
  EVENT_MODE_LABEL,
  EVENT_STATUS_LABEL,
  formatCapacity,
  formatFullDateTimeKo,
  formatWon,
  labelOf,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { MyApplication, PublicEventSummary } from '@/types/api';

import { Thumb } from '../../_components/thumb';
import { useEventCardBridge, useMyApplications, usePublicEvent } from '../../_lib/queries';
import { ApplySheet } from './apply-sheet';

/**
 * 이벤트 상세 — 이 서비스에서 가장 중요한 화면.
 *
 * ★ D-07 — 신청 기간에 이 화면이 보여줄 수 있는 경쟁 정보는
 *   **"정원 N명 · 신청 M명 (x:1)"** 하나다.
 *   남의 금액, 누구의 순위(내 순위 포함), 커트라인, 순위표는 없다.
 *   서버가 그 값을 보내지 않으므로 그릴 수도 없지만, **있는 것처럼 암시해서도 안 된다.**
 *   "지금 신청하면 유리해요" 같은 문구도 커트라인을 아는 척하는 것이라 쓰지 않는다.
 */
export function EventDetail({ eventKey }: { eventKey: string }) {
  const [applyOpen, setApplyOpen] = useState(false);
  const { isAuthenticated } = useAuth();

  const eventQuery = usePublicEvent(eventKey);
  const event = eventQuery.data;

  // 사진·시설·업종은 상세 응답에 없어서 검색 카드에서 빌려 온다. 없으면 없는 대로 그린다.
  const bridge = useEventCardBridge(event?.id ?? eventKey, event?.title);
  const card = bridge.data ?? null;

  // 이미 신청했는지. 목록 첫 장만 본다 — 못 찾아도 서버가 중복을 막으므로 안전하다.
  const myApplications = useMyApplications(undefined, isAuthenticated);
  const myApplication: MyApplication | null =
    myApplications.data?.pages
      .flatMap((page) => page.items)
      .find(
        (item) =>
          item.event.id === event?.id &&
          item.status !== 'CANCELED' &&
          item.status !== 'EXPIRED',
      ) ?? null;

  if (eventQuery.isPending) return <EventDetailSkeleton />;

  if (eventQuery.isError || !event) {
    return (
      <AppShell header={<TopBar showBack title="예약 상세" />}>
        <ErrorState
          title="예약 정보를 불러오지 못했어요"
          description="주소가 바뀌었거나 예약이 내려갔을 수 있어요."
          onRetry={() => void eventQuery.refetch()}
        />
      </AppShell>
    );
  }

  const rule = { min: event.minAmount, max: event.maxAmount };
  const fixed = isFixedAmount(rule);
  const open = event.status === 'OPEN';

  return (
    <AppShell
      bleed
      header={<TopBar showBack title="예약 상세" />}
      bottom={
        <StickyBottomBar
          info={
            open ? (
              <p className="flex items-center gap-1.5 text-sm">
                <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                <Countdown target={event.applyEndAt} prefix />
              </p>
            ) : null
          }
        >
          <CtaArea
            event={event}
            myApplication={myApplication}
            onApply={() => setApplyOpen(true)}
          />
        </StickyBottomBar>
      }
    >
      {/* 히어로. 사진이 하나뿐인 이유는 상세 응답에 갤러리가 없기 때문이다(후속 과제). */}
      <div className="relative">
        <Thumb
          src={card?.thumbnailUrl}
          alt={event.title}
          ratio="aspect-[4/3] sm:aspect-[16/9]"
          rounded="rounded-none"
        />
        <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
          <Badge variant={event.mode === 'INSTANT' ? 'success' : 'default'}>
            {labelOf(EVENT_MODE_LABEL, event.mode)}
          </Badge>
          {event.status !== 'OPEN' ? (
            <Badge variant="overlay">{labelOf(EVENT_STATUS_LABEL, event.status)}</Badge>
          ) : null}
        </div>
      </div>

      <div className="px-4">
        <section className="py-4">
          {card ? (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <Link
                href={`/venues/${encodeURIComponent(card.venueId)}`}
                className="truncate underline underline-offset-2"
              >
                {card.venueName}
              </Link>
              <span className="shrink-0">
                · {card.sigungu || card.sido}
              </span>
            </p>
          ) : bridge.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : null}

          <h1 className="mt-1.5 text-xl font-extrabold leading-snug">{event.title}</h1>

          {card && card.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.tags.slice(0, 6).map((tag) => (
                <Badge key={tag} variant="muted" size="sm">
                  #{tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </section>

        <Separator />

        {/* ★ 경쟁률 — 신청 기간에 공개되는 유일한 경쟁 정보 (D-07) */}
        <section className="py-4">
          <div className="rounded-lg border bg-card p-4">
            <CompetitionRatioLine competition={event.competition} className="text-base" />
            <CompetitionBar competition={event.competition} className="mt-3" />
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                신청 기간에는 경쟁률만 공개돼요. 다른 분들이 낸 금액과 순위는 서로 볼 수 없어요.
              </span>
            </p>
          </div>
        </section>

        <section className="pb-4">
          <h2 className="mb-2 text-base font-bold">예약 정보</h2>
          <Card>
            <CardContent className="divide-y p-0">
              <InfoRow
                icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
                label={fixed ? '신청 금액' : '제안 가능 금액'}
                value={
                  fixed ? (
                    formatWon(rule.min)
                  ) : (
                    <span className="tabular-nums">
                      {formatWon(rule.min)} ~ {formatWon(rule.max)}
                    </span>
                  )
                }
              />
              <InfoRow
                icon={<Users className="h-4 w-4" aria-hidden="true" />}
                label="정원"
                value={formatCapacity(event.capacity)}
              />
              <InfoRow
                icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
                label="이용일"
                value={event.serviceDate ? formatFullDateTimeKo(event.serviceDate) : '별도 안내'}
              />
              <InfoRow
                icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                label="신청 기간"
                value={
                  <span className="block text-right">
                    {formatFullDateTimeKo(event.applyStartAt)}
                    <br />~ {formatFullDateTimeKo(event.applyEndAt)}
                  </span>
                }
              />
            </CardContent>
          </Card>
        </section>

        <section className="pb-4">
          <h2 className="mb-2 text-base font-bold">
            이 예약은 {labelOf(EVENT_MODE_LABEL, event.mode)}이에요
          </h2>
          <div className="space-y-2.5 rounded-lg bg-muted/40 p-4 text-sm leading-relaxed">
            <p>{labelOf(EVENT_MODE_HINT, event.mode)}</p>

            {event.mode === 'INSTANT' ? (
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>금액이 하나로 정해져 있어요.</li>
                <li>신청하는 순간 자리가 잡히고 바로 확정돼요.</li>
                <li>정원이 차면 신청이 마감돼요.</li>
              </ul>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>정해진 범위 안에서 원하는 금액을 제안해요.</li>
                <li>마감 후 주최 측이 당첨자를 발표해요.</li>
                <li>발표 전까지 금액을 올릴 수 있어요. 내리는 건 안 돼요.</li>
                <li>같은 금액이면 그 금액을 먼저 제안한 분이 앞서요.</li>
              </ul>
            )}
          </div>
        </section>

        <section className="pb-4">
          <h2 className="mb-2 text-base font-bold">예약금 안내</h2>
          <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed">
            <p className="font-semibold">
              신청 후 10분 안에 예약금을 결제해야 확정됩니다.
            </p>
            <p className="text-muted-foreground">
              예약금이 있는 예약이라면 신청 직후 결제 안내가 떠요. 기한 안에 결제하지 않으면
              신청이 자동으로 취소돼요. 당첨되지 않은 분의 예약금은 환불돼요.
            </p>
            <p className="text-muted-foreground">
              예약금은 진지하게 신청했다는 확인일 뿐이고, 결과는 <b>신청 금액</b>으로 정해져요.
            </p>
          </div>
        </section>

        <section className="pb-6">
          <h2 className="mb-2 text-base font-bold">알아두세요</h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              신청 취소 후 다시 신청하려면 10분을 기다려야 하고, 순서는 새로 시작해요.
            </li>
            <li className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              마감 직전에 신청이 몰리면 마감이 잠깐 미뤄질 수 있어요.
            </li>
            <li className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              주최 측 사정으로 예약이 취소되면 알림으로 안내드리고 예약금은 전액 환불돼요.
            </li>
          </ul>
        </section>
      </div>

      <ApplySheet open={applyOpen} onOpenChange={setApplyOpen} event={event} />
    </AppShell>
  );
}

function InfoRow({
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

/**
 * 하단 CTA. 상태마다 "지금 할 수 있는 일" 이 다르다.
 * 누를 수 없는 버튼이라도 왜 못 누르는지는 글자로 남긴다.
 */
function CtaArea({
  event,
  myApplication,
  onApply,
}: {
  event: PublicEventSummary;
  myApplication: MyApplication | null;
  onApply: () => void;
}) {
  if (myApplication) {
    return (
      <Link
        href={`/my/applications/${encodeURIComponent(myApplication.id)}`}
        className={cn(buttonVariants({ size: 'xl', full: true }))}
      >
        내 신청 확인하기
      </Link>
    );
  }

  if (event.status === 'SCHEDULED') {
    return (
      <Button full size="xl" disabled>
        {formatFullDateTimeKo(event.applyStartAt)} 오픈
      </Button>
    );
  }

  if (event.status === 'CLOSED') {
    return (
      <Button full size="xl" disabled>
        {event.mode === 'BID' ? '마감 · 당첨자 발표 대기 중' : '신청 마감'}
      </Button>
    );
  }

  if (event.status === 'FINALIZED') {
    return (
      <Button full size="xl" disabled>
        당첨자 발표가 끝났어요
      </Button>
    );
  }

  if (event.status !== 'OPEN') {
    return (
      <Button full size="xl" disabled>
        지금은 신청할 수 없어요
      </Button>
    );
  }

  return (
    <Button full size="xl" onClick={onApply}>
      {event.mode === 'INSTANT' ? '신청하고 바로 확정하기' : '금액 제안하기'}
    </Button>
  );
}

function EventDetailSkeleton() {
  return (
    <AppShell bleed header={<TopBar showBack title="예약 상세" />}>
      <Skeleton className="aspect-[4/3] w-full rounded-none sm:aspect-[16/9]" />
      <div className="space-y-4 px-4 py-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </AppShell>
  );
}
