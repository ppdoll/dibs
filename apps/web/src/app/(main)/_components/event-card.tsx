import { MapPin } from 'lucide-react';
import Link from 'next/link';

import { Badge, CompetitionRatioBadge, Countdown } from '@/components/ui';
import {
  EVENT_MODE_LABEL,
  EVENT_STATUS_LABEL,
  formatAmountRule,
  formatCapacity,
  formatMonthDayKo,
  labelOf,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PublicEventCard } from '@/types/api';

import { Thumb } from './thumb';

/**
 * 이벤트 카드. catchtable 의 목록 단위를 그대로 옮긴 것.
 *
 * ★ D-07 — 카드에 실리는 경쟁 정보는 `CompetitionRatioBadge` 하나뿐이다.
 *   금액은 "내가 써낼 수 있는 범위"(이벤트 규칙)이지 남이 쓴 금액이 아니다.
 *   순위·커트라인·순위표는 여기에도, 어디에도 없다.
 */

export function eventHref(event: Pick<PublicEventCard, 'id' | 'slug'>): string {
  // slug 가 있으면 사람이 읽을 수 있는 주소를 쓴다. 서버가 id/slug 둘 다 받는다.
  return `/events/${encodeURIComponent(event.slug ?? event.id)}`;
}

/** 모드 배지. 용어는 format.ts 의 사전에서만 가져온다 — 화면마다 말이 갈리지 않게. */
export function EventModeBadge({ mode }: { mode: PublicEventCard['mode'] }) {
  return (
    <Badge variant={mode === 'INSTANT' ? 'success' : 'default'} size="sm">
      {labelOf(EVENT_MODE_LABEL, mode)}
    </Badge>
  );
}

/** 신청 중이 아닐 때만 상태를 알려준다. "신청 중"은 기본값이라 배지로 낭비하지 않는다. */
export function EventStatusBadge({ status }: { status: PublicEventCard['status'] }) {
  if (status === 'OPEN') return null;

  const variant =
    status === 'SCHEDULED' ? 'warning' : status === 'FINALIZED' ? 'secondary' : 'muted';

  return (
    <Badge variant={variant} size="sm">
      {labelOf(EVENT_STATUS_LABEL, status)}
    </Badge>
  );
}

/**
 * 세로형 카드. 홈 캐러셀과 격자 목록에 쓴다.
 *
 * `compact` 는 가로 캐러셀용으로 폭을 고정한다 — 카드가 살짝 잘려 보여야
 * "옆으로 넘길 수 있다"가 전달된다.
 */
export function EventCard({
  event,
  className,
  compact = false,
}: {
  event: PublicEventCard;
  className?: string;
  compact?: boolean;
}) {
  const soldOut = event.soldOut;

  return (
    <Link
      href={eventHref(event)}
      className={cn(
        'group block',
        compact && 'w-[62vw] max-w-[240px] shrink-0 sm:w-[220px]',
        className,
      )}
    >
      <div className="relative">
        <Thumb src={event.thumbnailUrl} alt={event.title} />

        {/* 사진 위 배지. 정원이 찬 INSTANT 는 한눈에 알아야 헛걸음이 없다. */}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <EventModeBadge mode={event.mode} />
          <EventStatusBadge status={event.status} />
        </div>

        {soldOut ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55">
            <span className="rounded-md bg-white/95 px-3 py-1 text-sm font-bold text-neutral-900">
              정원 마감
            </span>
          </div>
        ) : null}
      </div>

      <div className="pt-2.5">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {event.sigungu || event.sido} · {event.venueName}
          </span>
        </p>

        <h3 className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug group-hover:underline">
          {event.title}
        </h3>

        <p className="mt-1 text-sm font-semibold">
          {formatAmountRule(event.minAmount, event.maxAmount)}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{formatCapacity(event.capacity)}</span>
          {event.serviceDate ? (
            <>
              <span aria-hidden="true">·</span>
              <span>이용 {formatMonthDayKo(event.serviceDate)}</span>
            </>
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <CompetitionRatioBadge competition={event.competition} />
          {event.status === 'OPEN' ? (
            <Countdown target={event.applyEndAt} className="text-xs text-muted-foreground" />
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/**
 * 가로형 행. 검색 결과처럼 세로로 길게 훑는 목록에 쓴다.
 * 격자보다 한 줄에 담기는 정보가 많아 비교하기 좋다.
 */
export function EventRow({ event, className }: { event: PublicEventCard; className?: string }) {
  return (
    <Link
      href={eventHref(event)}
      className={cn(
        'flex gap-3 rounded-lg border bg-card p-3 transition-colors active:bg-accent',
        className,
      )}
    >
      <div className="relative w-24 shrink-0 sm:w-28">
        <Thumb src={event.thumbnailUrl} alt={event.title} ratio="aspect-square" />
        {event.soldOut ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55">
            <span className="text-xs font-bold text-white">정원 마감</span>
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <EventModeBadge mode={event.mode} />
          <EventStatusBadge status={event.status} />
        </div>

        <h3 className="mt-1.5 line-clamp-2 text-[15px] font-bold leading-snug">{event.title}</h3>

        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {event.sigungu || event.sido} · {event.venueName}
        </p>

        <p className="mt-1 text-sm font-semibold">
          {formatAmountRule(event.minAmount, event.maxAmount)}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <CompetitionRatioBadge competition={event.competition} />
          {event.status === 'OPEN' ? (
            <Countdown target={event.applyEndAt} prefix className="text-xs text-muted-foreground" />
          ) : null}
        </div>
      </div>
    </Link>
  );
}
