import { EventStatus, Prisma, VenueStatus } from '@prisma/client';

/**
 * 공개 노출 술어 — IC-51.
 *
 * 이 파일이 "무엇이 검색에 보이는가"를 정하는 **유일한 곳**이다.
 * 술어가 핸들러마다 흩어져 있으면, 새 엔드포인트 하나가 정지된 이벤트를 계속 보여준다.
 * 운영자 정지(EventStatus.SUSPENDED)가 장식이 되는 경로는 신청 가드만이 아니라 검색 결과에도 있다.
 *
 * 그래서 조건을 상수로 두는 것만으로는 부족하다고 보고, 타입으로도 막았다:
 * `publicEventWhere()` 는 호출부가 `status` / `deletedAt` / `suspendedAt` / `venue` 를
 * **넘길 수 없게** 하고(Omit), 가드 필드를 항상 마지막에 덮어쓴다.
 * 즉 이 함수를 통과한 where 는 어떤 인자를 받아도 비공개 이벤트를 뚫을 수 없다.
 */

/**
 * 공개되는 이벤트 상태.
 * DRAFT(작성 중), CANCELED(취소됨), SUSPENDED(운영자 정지)는 여기 없다 — 셋 다 공개 금지다.
 */
export const PUBLIC_EVENT_STATUSES = [
  EventStatus.SCHEDULED,
  EventStatus.OPEN,
  EventStatus.CLOSED,
  EventStatus.FINALIZED,
] as const satisfies readonly EventStatus[];

export type PublicEventStatus = (typeof PUBLIC_EVENT_STATUSES)[number];

/**
 * 공개 시설 술어(Prisma 형태). 이벤트가 붙어 있는 시설이 죽어 있으면 이벤트도 안 보여야 한다.
 *
 * 운영자가 시설을 정지시켰는데 그 시설의 이벤트가 검색에 그대로 남아 있으면,
 * 이벤트를 하나하나 정지시키기 전까지 정지가 절반만 적용된 상태가 된다.
 * 상위 개체가 닫히면 하위도 닫히는 게 IC-51 의 "상태 하나로 모든 가드를 닫는다"와 같은 취지다.
 */
export const PUBLIC_VENUE_WHERE = {
  deletedAt: null,
  suspendedAt: null,
  hiddenAt: null,
  status: VenueStatus.ACTIVE,
} as const satisfies Prisma.VenueWhereInput;

/**
 * 같은 술어의 SQL 형태.
 *
 * 왜 두 벌인가: 시설 검색은 pg_trgm 유사도 정렬 때문에 $queryRaw 로 돌 수밖에 없고,
 * 이벤트 검색은 Prisma 관계 필터로 돈다. Prisma where 를 SQL 문자열로 컴파일할 방법이 없어서
 * 형태가 둘이 됐다. **두 형태는 반드시 같은 조건이어야 하므로 붙여 두었다** —
 * 하나를 고치면 바로 아래(위) 것도 같이 고쳐야 한다. 떨어뜨려 놓는 순간 IC-51 이 깨진다.
 *
 * 별칭은 `v` 로 고정한다. 별칭을 인자로 받으면 Prisma.raw 로 보간해야 하는데,
 * 그 순간 이 함수가 SQL 주입 경로가 된다.
 */
export function publicVenueWhereSql(): Prisma.Sql {
  return Prisma.sql`v."deletedAt" IS NULL
    AND v."suspendedAt" IS NULL
    AND v."hiddenAt" IS NULL
    AND v."status" = ${PUBLIC_VENUE_WHERE.status}::"VenueStatus"`;
}

/**
 * `publicEventWhere()` 에 넘길 수 있는 추가 조건.
 * 가드 필드 넷은 타입에서 제거했다 — 넘길 수 없으니 실수로 덮어쓸 수도 없다.
 */
export type PublicEventNarrow = Omit<
  Prisma.EventWhereInput,
  'deletedAt' | 'suspendedAt' | 'status' | 'venue'
> & {
  /**
   * 공개 상태 중 일부만 보고 싶을 때. 공개 목록과 **교집합**을 취하므로
   * 여기에 DRAFT 를 적어도 결과는 늘어나지 않는다.
   */
  statusIn?: readonly EventStatus[];
};

/**
 * 모든 공개 이벤트 조회가 반드시 통과해야 하는 where.
 * 검색·탐색·상세 어디서든 이 함수를 거치지 않은 Event 쿼리를 만들면 안 된다.
 */
export function publicEventWhere(narrow: PublicEventNarrow = {}): Prisma.EventWhereInput {
  const { statusIn, ...rest } = narrow;

  // 교집합. 빈 배열이 되면 아무것도 매치되지 않는다 — 열리는 쪽이 아니라 닫히는 쪽으로 실패한다.
  const statuses = statusIn
    ? PUBLIC_EVENT_STATUSES.filter((status) => statusIn.includes(status))
    : PUBLIC_EVENT_STATUSES;

  return {
    ...rest,
    // 가드는 마지막이다. 위의 spread 가 무엇을 담고 있든 아래 넷이 이긴다.
    deletedAt: null,
    suspendedAt: null,
    status: { in: [...statuses] },
    venue: { is: PUBLIC_VENUE_WHERE },
  };
}
