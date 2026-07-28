import { MapPin } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { PublicVenueCard } from '@/types/api';

import { Thumb } from './thumb';

/** 시설 카드. 검색의 "시설" 탭에서 쓴다. */
export function VenueRow({ venue, className }: { venue: PublicVenueCard; className?: string }) {
  return (
    <Link
      href={`/venues/${encodeURIComponent(venue.id)}`}
      className={cn(
        'flex gap-3 rounded-lg border bg-card p-3 transition-colors active:bg-accent',
        className,
      )}
    >
      <div className="w-24 shrink-0 sm:w-28">
        <Thumb src={venue.coverImageUrl} alt={venue.name} ratio="aspect-square" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="muted" size="sm">
            {venue.categoryNameKo}
          </Badge>
          {/* 진행 중인 예약이 있는 곳을 먼저 보고 싶어 하므로 숫자를 앞세운다. */}
          {venue.openEventCount > 0 ? (
            <Badge variant="default" size="sm">
              진행 중 {venue.openEventCount}건
            </Badge>
          ) : null}
        </div>

        <h3 className="mt-1.5 truncate text-[15px] font-bold">{venue.name}</h3>

        {venue.summary ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{venue.summary}</p>
        ) : null}

        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{venue.roadAddress || `${venue.sido} ${venue.sigungu}`}</span>
        </p>
      </div>
    </Link>
  );
}
