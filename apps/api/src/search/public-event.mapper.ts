import { Prisma } from '@prisma/client';
import { assertNoVisibilityLeak, toPublicEventSummary } from '@dibs/shared';

import { CompetitionRatioDto, PublicEventCardDto } from './dto/public-event.dto';

/**
 * 공개 카드에 필요한 컬럼만 고른 select.
 *
 * IC-05 가 요구하는 1차 방어는 `publicPrisma`(omit 맵)지만 그 클라이언트는 prisma 모듈 소관이다.
 * 여기서는 그것과 독립적으로 성립하는 방어를 둔다 — **화이트리스트 select**.
 * 이 상수에 없는 컬럼은 애초에 DB 에서 올라오지 않으므로, 매퍼가 실수로 담을 대상 자체가 없다.
 * 그래서 settledAmount·highestAmountEver·SelectionCutoff 로 내려가는 include 는 여기 추가할 수 없다.
 */
export const EVENT_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  mode: true,
  status: true,
  capacity: true,
  // 금액 "규칙"이다. 이벤트가 정해 놓은 범위이지 누가 얼마를 써냈는지가 아니다.
  fixedAmount: true,
  minAmount: true,
  maxAmount: true,
  applyStartAt: true,
  applyEndAt: true,
  serviceStartAt: true,
  serviceDateKst: true,
  soldOutAt: true,
  tags: true,
  sigunguCode: true,
  // IC-53: 경쟁률은 이 비정규화 카운터에서만 온다. 목록에서 COUNT(*) 를 돌리지 않는다.
  liveApplicantCount: true,
  showCompetitionRatio: true,
  ratioMinApplicantsToShow: true,
  venue: { select: { id: true, name: true, sido: true, sigungu: true } },
  category: { select: { id: true, nameKo: true, iconKey: true } },
  images: {
    where: { deletedAt: null },
    // 대표 이미지가 없으면 첫 장을 쓴다. 카드가 통째로 비는 것보다 낫다.
    orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
    take: 1,
    select: { blobUrl: true, blurDataUrl: true },
  },
} as const satisfies Prisma.EventSelect;

export type EventCardRow = Prisma.EventGetPayload<{ select: typeof EVENT_CARD_SELECT }>;

/**
 * 이벤트 행을 공개 카드로 옮긴다.
 *
 * 경쟁률은 `toPublicEventSummary` 가 계산하지만, 파트너가 공개를 껐거나
 * 표시 최소 인원에 미달하면 여기서 null 로 지운다. 0으로 내리지 않는 이유는
 * "숨김"과 "아직 아무도 안 냈음"이 화면에서 같아 보이면 안 되기 때문이다.
 */
export function toPublicEventCard(row: EventCardRow): PublicEventCardDto {
  // INSTANT 는 고정 금액 한 점, BID 는 구간이다. 둘을 같은 두 필드로 표현한다.
  const minAmount = row.fixedAmount ?? row.minAmount ?? 0;
  const maxAmount = row.fixedAmount ?? row.maxAmount ?? minAmount;

  const summary = toPublicEventSummary({
    id: row.id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    minAmount,
    maxAmount,
    capacity: row.capacity,
    applyStartAt: row.applyStartAt,
    applyEndAt: row.applyEndAt,
    serviceDate: row.serviceStartAt,
    applicantCount: row.liveApplicantCount,
  });

  const ratioVisible =
    row.showCompetitionRatio && row.liveApplicantCount >= row.ratioMinApplicantsToShow;

  const image = row.images[0] ?? null;

  return {
    ...summary,
    competition: ratioVisible ? (summary.competition as CompetitionRatioDto) : null,
    slug: row.slug,
    serviceDateKst: row.serviceDateKst,
    // D-03: BID 는 정원 초과를 허용하므로 soldOutAt 이 찍히지 않는다.
    soldOut: row.soldOutAt !== null,
    venueId: row.venue.id,
    venueName: row.venue.name,
    sido: row.venue.sido,
    sigungu: row.venue.sigungu,
    sigunguCode: row.sigunguCode,
    categoryId: row.category?.id ?? null,
    categoryNameKo: row.category?.nameKo ?? null,
    categoryIconKey: row.category?.iconKey ?? null,
    thumbnailUrl: image?.blobUrl ?? null,
    thumbnailBlurDataUrl: image?.blurDataUrl ?? null,
    tags: row.tags,
  };
}

/**
 * D-07 그물. 진짜 방어는 위의 select 화이트리스트이고 이건 그 위에 덧대는 것이다.
 *
 * 프로덕션 hot path 에서 매 응답마다 객체 전체를 재귀 순회할 이유는 없다 —
 * 개발·테스트·CI 에서 **먼저** 깨지는 게 목적이라 그때만 돈다.
 * 여기서 예외가 나면 select 나 매퍼에 금액/순위/커트라인 계열 키가 새로 들어왔다는 뜻이다.
 */
export function assertPublicPayload(value: unknown, context: string): void {
  if (process.env.NODE_ENV === 'production') return;
  assertNoVisibilityLeak(value, context);
}
