import { Prisma } from '@prisma/client';

/**
 * 파트너/운영자가 **자기** 라운드의 후보를 볼 때의 컬럼.
 *
 * 금액(`amountSnapshot`)과 순위(`rankNo`)가 그대로 들어 있다 — D-07 이 감추는 상대는 이용자이지
 * 이벤트 주인이 아니다. 그래도 select 를 상수로 고정하는 이유는 둘이다:
 * 새 컬럼이 생겨도 응답 모양이 저절로 넓어지지 않고, **이 상수를 import 하는 곳이 곧
 * "금액·순위를 볼 자격이 있는 경로"의 전체 목록**이 된다(IC-05 가 말한 별도 리포지토리의 취지).
 *
 * 여기 없는 것도 의도다: `SelectionCutoff` 는 관계로 분리돼 있어 이 select 로는 절대 따라오지 않는다(IC-35).
 */
export const SELECTION_ENTRY_SELECT = {
  id: true,
  applicationId: true,
  userId: true,
  displayNameSnapshot: true,
  rankNo: true,
  amountSnapshot: true,
  lastBidAtSnapshot: true,
  appliedAtSnapshot: true,
  rebidCountSnapshot: true,
  depositStatusSnapshot: true,
  depositPaidSnapshot: true,
  withinCapacity: true,
  isEligible: true,
  exclusionReason: true,
  status: true,
  source: true,
  isOverride: true,
  tieGroupKey: true,
  tieOrdinal: true,
  version: true,
} satisfies Prisma.SelectionEntrySelect;

export type SelectionEntryRow = Prisma.SelectionEntryGetPayload<{
  select: typeof SELECTION_ENTRY_SELECT;
}>;
