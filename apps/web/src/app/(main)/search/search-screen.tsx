'use client';

import { CalendarX, Search, SlidersHorizontal, Store, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { AppShell, TopBar } from '@/components/layout';
import {
  Badge,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  SkeletonList,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import type { EventModeValue, EventSort } from '@/types/api';

import { EventRow } from '../_components/event-card';
import { InfiniteSentinel } from '../_components/infinite-sentinel';
import { VenueRow } from '../_components/venue-card';
import { DEADLINE_SOON_HOURS, useSearchEvents, useSearchVenues } from '../_lib/queries';
import {
  countActiveFilters,
  EMPTY_FILTERS,
  SearchFilterSheet,
  type SearchFilters,
} from './search-filter-sheet';

/**
 * 검색.
 *
 * 조건은 전부 **URL 에 산다**. 상태를 컴포넌트에만 두면 뒤로가기로 조건이 사라지고,
 * 홈의 "더보기" 나 카테고리 칩이 만들어 준 링크도 무의미해진다. 화면은 URL 을 읽어
 * 그리기만 하고, 바꿀 때는 replace 로 되쓴다.
 *
 * ★ D-07 — 금액 필터는 "내가 낼 수 있는 금액"(이벤트 규칙)에 대한 조건이다.
 *   남이 써낸 금액으로 거르는 기능은 서버에도 없고 여기에도 없다.
 */

const SORTS: { value: EventSort; label: string }[] = [
  { value: 'ending-soon', label: '마감임박' },
  { value: 'newest', label: '최신' },
  { value: 'popular', label: '인기' },
  { value: 'competition-ratio', label: '경쟁률' },
];

function isEventSort(value: string | null): value is EventSort {
  return SORTS.some((sort) => sort.value === value);
}

function toInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function SearchScreen() {
  const router = useRouter();
  const params = useSearchParams();

  const keyword = params.get('q') ?? '';
  const tab = params.get('tab') === 'venues' ? 'venues' : 'events';
  const sortParam = params.get('sort');
  const sort: EventSort = isEventSort(sortParam) ? sortParam : 'ending-soon';

  const modeParam = params.get('mode');
  const mode: EventModeValue | null =
    modeParam === 'INSTANT' || modeParam === 'BID' ? modeParam : null;

  const filters: SearchFilters = useMemo(
    () => ({
      sigunguCode: params.get('sigunguCode'),
      regionLabel: params.get('region'),
      categoryId: params.get('categoryId'),
      mode,
      amountFrom: toInt(params.get('amountFrom')),
      amountTo: toInt(params.get('amountTo')),
      deadlineSoon: params.get('deadlineWithinHours') !== null,
    }),
    [params, mode],
  );

  const [draftKeyword, setDraftKeyword] = useState(keyword);
  const [filterOpen, setFilterOpen] = useState(false);

  /** 조건 하나를 바꿔 URL 을 다시 쓴다. 값이 비면 파라미터 자체를 없앤다 — 주소가 짧아야 공유된다. */
  const writeParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `/search?${query}` : '/search', { scroll: false });
    },
    [params, router],
  );

  const applyFilters = (nextFilters: SearchFilters) => {
    writeParams({
      sigunguCode: nextFilters.sigunguCode,
      region: nextFilters.regionLabel,
      categoryId: nextFilters.categoryId,
      mode: nextFilters.mode,
      amountFrom: nextFilters.amountFrom === null ? null : String(nextFilters.amountFrom),
      amountTo: nextFilters.amountTo === null ? null : String(nextFilters.amountTo),
      deadlineWithinHours: nextFilters.deadlineSoon ? String(DEADLINE_SOON_HOURS) : null,
    });
  };

  const activeCount = countActiveFilters(filters);

  const eventParams = {
    ...(keyword ? { keyword } : {}),
    ...(filters.sigunguCode ? { sigunguCode: filters.sigunguCode } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.mode ? { mode: filters.mode } : {}),
    ...(filters.amountFrom !== null ? { amountFrom: filters.amountFrom } : {}),
    ...(filters.amountTo !== null ? { amountTo: filters.amountTo } : {}),
    ...(filters.deadlineSoon ? { deadlineWithinHours: DEADLINE_SOON_HOURS } : {}),
    sort,
  };

  const venueParams = {
    ...(keyword ? { keyword } : {}),
    ...(filters.sigunguCode ? { sigunguCode: filters.sigunguCode } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    sort: keyword ? 'relevance' : 'popular',
  };

  const events = useSearchEvents(eventParams, tab === 'events');
  const venues = useSearchVenues(venueParams, tab === 'venues');

  const eventItems = events.data?.pages.flatMap((page) => page.items) ?? [];
  const venueItems = venues.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <AppShell
      header={
        <TopBar showBack backHref="/">
          <div className="mx-auto max-w-3xl px-4 pb-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                writeParams({ q: draftKeyword.trim().slice(0, 40) });
              }}
              className="flex items-center gap-2"
            >
              <div className="flex h-11 flex-1 items-center gap-2 rounded-full border bg-muted/40 px-4">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={draftKeyword}
                  onChange={(event) => setDraftKeyword(event.target.value)}
                  placeholder="지역, 매장, 메뉴로 검색"
                  aria-label="검색어"
                  maxLength={40}
                  className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
                />
                {draftKeyword ? (
                  <button
                    type="button"
                    aria-label="검색어 지우기"
                    onClick={() => {
                      setDraftKeyword('');
                      writeParams({ q: null });
                    }}
                    className="shrink-0 text-muted-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                aria-label="필터"
                className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
              >
                <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
                {activeCount > 0 ? (
                  <span className="absolute -right-1 -top-1">
                    <Badge variant="default" size="sm" className="rounded-full">
                      {activeCount}
                    </Badge>
                  </span>
                ) : null}
              </button>
            </form>
          </div>
        </TopBar>
      }
    >
      <SearchFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        value={filters}
        onApply={applyFilters}
      />

      <Tabs value={tab} onValueChange={(next) => writeParams({ tab: next === 'venues' ? 'venues' : null })}>
        <TabsList className="-mx-4 px-4">
          <TabsTrigger value="events">예약</TabsTrigger>
          <TabsTrigger value="venues">시설</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          {/* 적용된 조건 요약. 무엇 때문에 결과가 적은지 바로 보이고, 한 번에 뗄 수 있다. */}
          <ActiveFilterChips filters={filters} onClear={() => applyFilters(EMPTY_FILTERS)} />

          <ChipGroup className="py-2">
            {SORTS.map((option) => (
              <Chip
                key={option.value}
                selected={sort === option.value}
                onClick={() => writeParams({ sort: option.value })}
              >
                {option.label}
              </Chip>
            ))}
          </ChipGroup>

          {events.isPending ? (
            <SkeletonList count={5} />
          ) : events.isError ? (
            <ErrorState onRetry={() => void events.refetch()} />
          ) : eventItems.length === 0 ? (
            <EmptyState
              icon={<CalendarX className="h-6 w-6" aria-hidden="true" />}
              title="조건에 맞는 예약이 없어요"
              description={
                activeCount > 0
                  ? '필터를 조금 넓혀 보시면 더 많은 예약이 보여요.'
                  : '다른 검색어로 찾아보세요.'
              }
            />
          ) : (
            <>
              <ul className="space-y-3 pt-1">
                {eventItems.map((event) => (
                  <li key={event.id}>
                    <EventRow event={event} />
                  </li>
                ))}
              </ul>
              <InfiniteSentinel
                hasNextPage={events.hasNextPage}
                isFetchingNextPage={events.isFetchingNextPage}
                onLoadMore={() => void events.fetchNextPage()}
                endMessage="검색 결과를 모두 봤어요"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="venues">
          <ActiveFilterChips filters={filters} onClear={() => applyFilters(EMPTY_FILTERS)} />

          {venues.isPending ? (
            <SkeletonList count={5} className="pt-3" />
          ) : venues.isError ? (
            <ErrorState onRetry={() => void venues.refetch()} />
          ) : venueItems.length === 0 ? (
            <EmptyState
              icon={<Store className="h-6 w-6" aria-hidden="true" />}
              title="조건에 맞는 시설이 없어요"
              description="검색어나 지역을 바꿔 보세요."
            />
          ) : (
            <>
              <ul className="space-y-3 pt-3">
                {venueItems.map((venue) => (
                  <li key={venue.id}>
                    <VenueRow venue={venue} />
                  </li>
                ))}
              </ul>
              <InfiniteSentinel
                hasNextPage={venues.hasNextPage}
                isFetchingNextPage={venues.isFetchingNextPage}
                onLoadMore={() => void venues.fetchNextPage()}
                endMessage="시설을 모두 봤어요"
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

/** 지금 걸려 있는 조건을 칩으로 보여준다. 필터 시트를 열지 않아도 보이는 게 중요하다. */
function ActiveFilterChips({
  filters,
  onClear,
}: {
  filters: SearchFilters;
  onClear: () => void;
}) {
  const labels: string[] = [];
  if (filters.regionLabel) labels.push(filters.regionLabel);
  if (filters.mode) labels.push(filters.mode === 'INSTANT' ? '선착순 즉시확정' : '금액 제안');
  if (filters.deadlineSoon) labels.push('48시간 내 마감');
  if (filters.amountFrom !== null || filters.amountTo !== null) labels.push('금액대');
  if (filters.categoryId) labels.push('업종');

  if (labels.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-3">
      {labels.map((label) => (
        <Badge key={label} variant="secondary">
          {label}
        </Badge>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="text-xs font-semibold text-muted-foreground underline underline-offset-2"
      >
        전체 해제
      </button>
    </div>
  );
}
