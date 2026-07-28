'use client';

import { ChevronRight, MapPin, Sparkles, Store } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
} from '@/components/ui';
// SectionHeader는 앱 셸의 일부라 layout 쪽에 있다 — ui 프리미티브가 아니다.
import { AppShell, HomeTopBar, SectionHeader } from '@/components/layout';
import { useAuth } from '@/providers/auth-provider';
import { formatTimeAgo } from '@/lib/format';
import type { DiscoverySection } from '@/types/api';

import { EventCard } from './_components/event-card';
import { RegionFilterSheet } from './_components/region-filter-sheet';
import { DEADLINE_SOON_HOURS, useDiscoveryHome } from './_lib/queries';

/**
 * 홈 = 탐색 피드. catchtable 처럼 섹션 캐러셀이 세로로 쌓인다.
 *
 * 검색과 나눈 이유는 목적이 다르기 때문이다. 홈은 "뭘 찾을지 아직 모르는 사람"의
 * 화면이라 조건이 지역 하나뿐이고, 좁히고 싶어진 순간부터는 /search 로 넘긴다.
 *
 * ★ D-07 — 카드에 붙는 경쟁 정보는 경쟁률 배지뿐이다. 순위·커트라인은 없다.
 */

/** 마지막으로 고른 지역을 기억해 둔다. 매번 다시 고르게 하면 지역 필터를 아무도 안 쓴다. */
const REGION_STORAGE_KEY = 'dibs.home.region';

interface StoredRegion {
  code: string;
  label: string;
}

export function HomeFeed() {
  const [region, setRegion] = useState<StoredRegion | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);

  // localStorage 는 마운트 후에 읽는다. 렌더 중에 읽으면 서버 HTML 과 달라져 깨진다.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(REGION_STORAGE_KEY);
      if (raw) setRegion(JSON.parse(raw) as StoredRegion);
    } catch {
      // 저장값이 깨졌으면 그냥 전체 지역으로 둔다. 홈이 안 뜨는 것보다 낫다.
    }
  }, []);

  const applyRegion = (value: { sigunguCode: string | null; label: string }) => {
    const next = value.sigunguCode ? { code: value.sigunguCode, label: value.label } : null;
    setRegion(next);
    try {
      if (next) window.localStorage.setItem(REGION_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(REGION_STORAGE_KEY);
    } catch {
      // 사파리 프라이빗 모드에서는 저장이 막힌다. 기억을 못 할 뿐 동작은 그대로다.
    }
  };

  const home = useDiscoveryHome(region?.code);
  const sections = home.data?.sections ?? [];

  return (
    <AppShell header={<HomeTopBar />}>
      {/* 지역 + 업종 칩. 홈에서 쓸 수 있는 필터는 이 둘뿐이다. */}
      <div className="sticky top-14 z-20 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRegionOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold"
          >
            <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            {region?.label ?? '전체 지역'}
          </button>

          <div className="min-w-0 flex-1">
            <CategoryChips categories={home.data?.categories ?? []} loading={home.isPending} />
          </div>
        </div>
      </div>

      <RegionFilterSheet
        open={regionOpen}
        onOpenChange={setRegionOpen}
        selectedCode={region?.code ?? null}
        onSelect={applyRegion}
      />

      {home.isPending ? (
        <HomeSkeleton />
      ) : home.isError ? (
        <ErrorState
          title="피드를 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요."
          onRetry={() => void home.refetch()}
        />
      ) : sections.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" aria-hidden="true" />}
          title={region ? `${region.label}에는 아직 열린 예약이 없어요` : '아직 열린 예약이 없어요'}
          description="지역을 넓히거나 검색으로 찾아보세요."
          action={
            <Link
              href="/search"
              className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              검색하러 가기
            </Link>
          }
        />
      ) : (
        <div className="pb-6">
          {sections.map((section) => (
            <FeedSection key={`${section.key}-${section.categoryId ?? 'x'}`} section={section} />
          ))}

          <p className="pt-4 text-center text-xs text-muted-foreground">
            {formatTimeAgo(home.data?.generatedAt)} 기준
          </p>
        </div>
      )}

      <PartnerInviteBanner />
    </AppShell>
  );
}

/**
 * 사장님용 진입점.
 *
 * 홈 맨 아래에 두는 이유: 이용자에게는 필요 없는 링크라 상단이나 탭바에 올리면
 * 매번 눈에 밟힌다. 그렇다고 내 정보 화면에만 두면 "여기서 예약을 받으려면
 * 어떻게 하나"를 처음 궁금해하는 순간에 보이지 않는다. 피드를 다 훑고 내려온
 * 자리가 그 질문이 생기는 지점이다.
 *
 * 이미 파트너인 사람에게는 신청 대신 파트너 센터로 보낸다.
 */
function PartnerInviteBanner() {
  const { isAuthenticated, isPartner, isApprovedPartner } = useAuth();

  const href = isPartner ? '/partner' : '/partner/apply';
  const label = isApprovedPartner
    ? '파트너 센터로 이동'
    : isPartner
      ? '신청 진행 상황 보기'
      : '파트너 신청하기';

  return (
    <section className="mt-2 border-t pb-6 pt-6">
      <div className="rounded-xl bg-muted/60 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background">
            <Store className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-semibold">사장님이신가요?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              가게의 자리를 선착순이나 금액 제안으로 열어 보세요. 등록은 무료예요.
            </p>

            <Link
              href={href}
              className="mt-3 inline-flex h-10 items-center rounded-lg border bg-background px-4 text-sm font-semibold hover:bg-accent"
            >
              {label}
              <ChevronRight className="ml-0.5 h-4 w-4" aria-hidden="true" />
            </Link>

            {!isAuthenticated && (
              <p className="mt-2 text-xs text-muted-foreground">
                구글 계정으로 로그인하면 바로 신청할 수 있어요.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryChips({
  categories,
  loading,
}: {
  categories: { id: string; nameKo: string }[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <ChipGroup>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-16 shrink-0 rounded-full" />
        ))}
      </ChipGroup>
    );
  }

  if (categories.length === 0) return null;

  return (
    <ChipGroup>
      {categories.map((category) => (
        <Link key={category.id} href={`/search?categoryId=${encodeURIComponent(category.id)}`}>
          {/* Chip 은 button 이라 링크 안에 넣고 포인터 이벤트만 넘긴다. */}
          <Chip tabIndex={-1} className="pointer-events-none">
            {category.nameKo}
          </Chip>
        </Link>
      ))}
    </ChipGroup>
  );
}

/** 섹션별 "더보기" 가 데려갈 검색 조건. 홈에서 본 것과 같은 목록이 나와야 한다. */
function moreHref(section: DiscoverySection): string {
  switch (section.key) {
    case 'DEADLINE_SOON':
      return `/search?sort=ending-soon&deadlineWithinHours=${DEADLINE_SOON_HOURS}`;
    case 'NEWLY_OPENED':
      return '/search?sort=newest';
    case 'POPULAR':
      return '/search?sort=popular';
    case 'CATEGORY':
      return section.categoryId
        ? `/search?categoryId=${encodeURIComponent(section.categoryId)}`
        : '/search';
    default:
      return '/search';
  }
}

function FeedSection({ section }: { section: DiscoverySection }) {
  if (section.events.length === 0) return null;

  return (
    <section className="pt-2">
      <SectionHeader
        title={section.titleKo}
        more={
          <Link href={moreHref(section)} className="inline-flex items-center gap-0.5">
            더보기
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      />

      {/* 가로 캐러셀. 화면 밖으로 흘러야 "옆으로 넘긴다"가 전달되므로 좌우 여백을 뚫는다. */}
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {section.events.map((event) => (
          <EventCard key={event.id} event={event} compact />
        ))}
      </div>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-8 py-4">
      {Array.from({ length: 3 }).map((_, sectionIndex) => (
        <div key={sectionIndex}>
          <Skeleton className="mb-3 h-6 w-28" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-hidden px-4">
            {Array.from({ length: 3 }).map((_, cardIndex) => (
              <SkeletonCard key={cardIndex} className="w-[62vw] max-w-[240px] shrink-0 sm:w-[220px]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
