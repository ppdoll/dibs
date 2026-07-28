import { EventStatus, Prisma } from '@prisma/client';
import {
  assertNoVisibilityLeak,
  competitionRatio,
  toPublicEventSummary,
  type PublicEventSummary,
} from '@dibs/shared';

import { amountRuleOf } from './event-policy';

/**
 * 공개 노출 술어. 검색·목록·상세가 **이것만** 쓴다. (IC-51)
 *
 * DRAFT / SUSPENDED / 소프트 삭제는 어떤 공개 경로에도 나오면 안 된다.
 * 술어가 핸들러마다 흩어지면 새 엔드포인트 하나가 정지된 이벤트를 계속 보여주고,
 * 그러면 운영자 정지가 검색 결과에서만 장식이 된다.
 *
 * suspendedAt 을 status 와 함께 보는 건 중복처럼 보이지만 event_suspended_state_chk 가
 * 두 컬럼을 동치로 묶기 전에 들어온 행이 있을 수 있고, 무엇보다 인덱스가 status 로 시작한다.
 *
 * TODO(follow-up): IC-51 은 이 상수가 packages/shared 에 하나만 있어야 한다고 말한다.
 * shared 는 이 작업 범위 밖이라 여기에 두었고, 검색 모듈은 이 상수를 import 해서 쓴다.
 */
export const PUBLIC_EVENT_WHERE = {
  deletedAt: null,
  suspendedAt: null,
  status: {
    in: [EventStatus.SCHEDULED, EventStatus.OPEN, EventStatus.CLOSED, EventStatus.FINALIZED],
  },
} satisfies Prisma.EventWhereInput;

/**
 * 공개 응답을 만들기 위해 **읽어도 되는 컬럼**.
 *
 * `include` 나 전체 select 로 이벤트를 통째로 읽어서 매퍼가 골라 담는 방식은,
 * 매퍼를 한 번 안 거치는 핸들러가 생기는 순간 끝난다(IC-05). 읽는 단계에서 잘라둔다.
 */
export const PUBLIC_EVENT_SELECT = {
  id: true,
  title: true,
  mode: true,
  status: true,
  capacity: true,
  fixedAmount: true,
  minAmount: true,
  maxAmount: true,
  applyStartAt: true,
  applyEndAt: true,
  serviceStartAt: true,
  liveApplicantCount: true,
  showCompetitionRatio: true,
  ratioMinApplicantsToShow: true,
} satisfies Prisma.EventSelect;

export type PublicEventRow = Prisma.EventGetPayload<{ select: typeof PUBLIC_EVENT_SELECT }>;

/**
 * 유저에게 나가는 이벤트 요약. (D-07)
 *
 * 금액 규칙(min/max)은 "내가 얼마를 써낼 수 있는가"라 공개하고, 남이 얼마를 썼는지·
 * 내 순위·커트라인은 어디에도 담지 않는다. 마지막에 assertNoVisibilityLeak 로 한 번 더 훑는 이유는
 * 화이트리스트가 진짜 방어이고 이건 그물이기 때문이다 — 필드가 늘어나면 여기서 먼저 터진다.
 */
export function toPublicEvent(row: PublicEventRow): PublicEventSummary {
  const rule = amountRuleOf(row) ?? { min: 0, max: 0 };

  const summary = toPublicEventSummary({
    id: row.id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    minAmount: rule.min,
    maxAmount: rule.max,
    capacity: row.capacity,
    applyStartAt: row.applyStartAt,
    applyEndAt: row.applyEndAt,
    serviceDate: row.serviceStartAt,
    applicantCount: row.liveApplicantCount,
  });

  const visible = {
    ...summary,
    competition: mayShowRatio(row) ? summary.competition : suppressedRatio(row.capacity),
  };

  assertNoVisibilityLeak(visible, 'GET /events (공개 요약)');

  return visible;
}

/**
 * 경쟁률을 보여줘도 되는가.
 *
 * D-07 이 공개하는 유일한 경쟁 정보지만 두 가지 예외가 있다:
 * 파트너가 표시를 껐거나(showCompetitionRatio), 표본이 임계치 미만일 때다.
 * 신청자가 1~2명일 때의 "정원 10명 / 신청 1명"은 경쟁 정보가 아니라 사실상 개인 정보에 가깝다 —
 * 신청자 본인이 자기가 유일한 신청자임을 알게 되고, 그건 커트라인을 아는 것과 같다.
 */
function mayShowRatio(row: Pick<PublicEventRow, 'showCompetitionRatio' | 'liveApplicantCount' | 'ratioMinApplicantsToShow'>): boolean {
  return row.showCompetitionRatio && row.liveApplicantCount >= row.ratioMinApplicantsToShow;
}

/**
 * 감출 때도 competition 키 자체는 남긴다.
 * 키를 통째로 빼면 화면이 "아직 로딩 중"과 "공개 안 함"을 구분하지 못한다.
 * applicantCount 는 0 으로 내려간다 — 실제 값을 실으면 감춘 의미가 없기 때문이고,
 * 화면은 `ratio === null` 로 "비공개"를 판정한다(0명과 비공개를 숫자로 구분하지 않는다).
 */
function suppressedRatio(capacity: number) {
  return { ...competitionRatio(capacity, 0), ratio: null, display: '-' };
}
