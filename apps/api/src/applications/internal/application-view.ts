import { Prisma } from '@prisma/client';
import { competitionRatio } from '@dibs/shared';

/**
 * "내 신청 내역"이 이벤트에서 읽는 것 전부.
 *
 * ★ 여기에 **없는** 것이 규칙이다(D-07). 커트라인(`SelectionCutoff`)도, 선정 라운드(`selections`)도
 * 따라오지 않는다. `include: { selections: true }` 한 줄이면 그 이벤트의 최소 낙찰가가
 * 참가자 전원에게 새고, 그 순간 밀봉입찰이 공개입찰이 된다(IC-35).
 * `liveApplicantCount` 는 경쟁률을 만들기 위한 재료이고, 그 경쟁률이 기간 중 공개되는 **유일한** 경쟁 정보다.
 */
export const MY_APPLICATION_EVENT_SELECT = {
  id: true,
  title: true,
  slug: true,
  mode: true,
  status: true,
  capacity: true,
  liveApplicantCount: true,
  fixedAmount: true,
  minAmount: true,
  maxAmount: true,
  applyStartAt: true,
  applyEndAt: true,
  serviceStartAt: true,
  depositRequired: true,
  venue: { select: { id: true, name: true } },
} satisfies Prisma.EventSelect;

export const MY_APPLICATION_SELECT = {
  id: true,
  eventId: true,
  status: true,
  eventMode: true,
  amount: true,
  depositStatus: true,
  depositDueAt: true,
  depositRequiredAmount: true,
  depositPaidAmount: true,
  depositRefundedAmount: true,
  slotClaimed: true,
  rebidCount: true,
  reapplyCount: true,
  firstAppliedAt: true,
  canceledAt: true,
  confirmedAt: true,
  version: true,
  createdAt: true,
  event: { select: MY_APPLICATION_EVENT_SELECT },
} satisfies Prisma.ApplicationSelect;

type MyApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof MY_APPLICATION_SELECT }>;

/**
 * 이용자용 신청 뷰. **화이트리스트로 새로 만든다** — 빼는 방식으로는 못 지킨다.
 *
 * 담기는 금액은 `myAmount` 하나뿐이고 그건 본인이 직접 적어낸 값이다. 순위는 담지 않는다.
 * 헷갈리기 쉬운 지점이라 다시 적어둔다: 내 금액은 내 정보지만, 내 **순위**는 남들의 금액을
 * 알아야 나오는 값이라 공개하면 커트라인이 역산된다. 그래서 자기 순위도 볼 수 없다(D-07).
 *
 * `lastBidAt` 도 빠져 있다. 그건 D-04 의 2순위 키라, 금액과 함께 알면
 * 같은 금액대에서 자기 위치를 추정할 수 있는 재료가 된다.
 */
export function toMyApplicationView(row: MyApplicationRow) {
  const event = row.event;

  return {
    id: row.id,
    status: row.status,
    /** 본인이 적어낸 금액. 순위가 아니다. */
    myAmount: row.amount,
    appliedAt: row.firstAppliedAt,
    canceledAt: row.canceledAt,
    confirmedAt: row.confirmedAt,
    rebidCount: row.rebidCount,
    reapplyCount: row.reapplyCount,
    /** INSTANT 에서 자리를 붙들고 있는가. BID 에서는 언제나 false 다. */
    slotHeld: row.slotClaimed,
    /** 낙관적 락 토큰이 아니라 화면 갱신 판단용. 상향·취소는 서버가 WHERE 절로 지킨다. */
    version: row.version,
    deposit: {
      status: row.depositStatus,
      dueAt: row.depositDueAt,
      requiredAmount: row.depositRequiredAmount,
      paidAmount: row.depositPaidAmount,
      refundedAmount: row.depositRefundedAmount,
    },
    event: {
      id: event.id,
      title: event.title,
      slug: event.slug,
      mode: event.mode,
      status: event.status,
      venue: event.venue,
      /** 내가 써낼 수 있는 범위. 남이 얼마를 썼는지가 아니다. */
      minAmount: event.mode === 'INSTANT' ? event.fixedAmount : event.minAmount,
      maxAmount: event.mode === 'INSTANT' ? event.fixedAmount : event.maxAmount,
      capacity: event.capacity,
      applyStartAt: event.applyStartAt,
      applyEndAt: event.applyEndAt,
      serviceStartAt: event.serviceStartAt,
      depositRequired: event.depositRequired,
      /** 기간 중 공개되는 유일한 경쟁 정보 (D-07) */
      competition: competitionRatio(event.capacity, event.liveApplicantCount),
    },
  };
}

export type MyApplicationView = ReturnType<typeof toMyApplicationView>;

/**
 * `findVisibilityLeaks` 의 부분일치 그물에 걸리지만 본인에게는 공개해도 되는 키.
 *
 * 응답 조립은 위의 화이트리스트 매퍼가 1차 방어이고, 이 목록은 알림 payload 처럼
 * 자동 스캔을 돌리는 자리에서 "본인 정보"임을 명시하기 위한 것이다.
 */
export const OWN_DATA_KEYS = [
  'myAmount',
  'myDepositAmount',
  'requiredAmount',
  'paidAmount',
  'refundedAmount',
  'deposit',
  'depositRequired',
  'depositStatus',
  'depositDueAt',
] as const;
