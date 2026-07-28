import { Prisma } from '@prisma/client';

/**
 * 소프트 클로즈(D-08 / IC-17)의 **정본 SQL**.
 *
 * 왜 서비스가 아니라 SQL 조각으로 내보내는가:
 * 연장을 실제로 유발하는 곳은 신청·입찰 모듈의 상향 경로다. 그런데 그쪽에서 이 모듈의 서비스를
 * 주입하면 두 애그리게이트가 코드로 묶인다(이 프로젝트의 결합은 전부 DB 를 통해서만 생긴다).
 * 그렇다고 SQL 을 양쪽에 복붙하면 IC-17 이 요구하는 술어 하나가 한쪽에서만 빠지는 날이 반드시 온다 —
 * 술어가 하나 빠지는 순간 그 규칙은 통째로 무효다. 그래서 events 모듈이 `PUBLIC_EVENT_WHERE` 를
 * 상수로 내보내는 것과 같은 방식으로, **문장 자체를 상수처럼** 내보낸다.
 *
 * 사용법(상향 트랜잭션 안에서):
 * ```ts
 * const [extended] = await tx.$queryRaw<SoftCloseExtensionRow[]>(
 *   softCloseExtendSql(eventId, userId),
 * );
 * // 0행은 오류가 아니다 — "연장 조건에 해당하지 않음"이며 입찰 자체는 성공해야 한다.
 * // 1행이면 그 입찰의 BidHistory 에 triggeredSoftClose=true 와
 * // deadlineBefore/deadlineAfter 를 함께 남긴다(1인당 상한을 이 컬럼으로 센다).
 * ```
 */
export interface SoftCloseExtensionRow {
  eventId: string;
  deadlineBefore: Date;
  deadlineAfter: Date;
  extensionCount: number;
}

/**
 * 마감 연장 1회. 단일 조건부 UPDATE 이고, 판정은 전부 WHERE 절 안에 있다. (IC-17)
 *
 * 전체 상한(`softCloseMaxExtensions`)과 **1인당 상한**(`softCloseMaxExtensionsPerUser`)을 둘 다 건다.
 * 1인당 상한이 없으면, 예약금이 FIXED 일 때 상향해도 부족분이 0이라 "부족분이 있으면 연장하지 않는다"는
 * 보호가 통째로 무력해지고 한 사람이 amountStep 만큼씩 올리며 마감을 혼자 6번 민다(D-08 의 의도가 아니다).
 *
 * NULL 가드를 명시적으로 거는 이유: Postgres 의 `LEAST` 는 **NULL 인자를 무시한다**.
 * `softCloseExtendMinutes` 가 NULL 이면 `LEAST(NULL, hardEndAt)` 이 그대로 `hardEndAt` 이 되어
 * 마감이 조용히 최종 한계까지 점프한다. 에러가 아니라 정상 동작처럼 보이는 게 더 나쁘다.
 *
 * `version` 을 올리는 것도 규칙이다(IC-63): 연장이 락 토큰을 올리지 않으면, 연장 직후 도착한 PATCH 가
 * 낡은 If-Match 로도 통과해서 방금 밀어둔 `applyEndAt` 을 덮어쓴다.
 * `rankingLockAt` 을 같은 문장에서 다시 계산하는 이유는 D-04 다 — 마감이 밀렸는데 순위 확정 시각이
 * 그대로면 예약금 윈도우가 남은 채로 순위가 확정된다(IC-26 이 막는 상황).
 */
export function softCloseExtendSql(eventId: string, userId: string): Prisma.Sql {
  return Prisma.sql`
    WITH before AS (
      -- CTE 는 같은 스냅샷을 보므로 여기서 읽는 값은 UPDATE 이전 값이다.
      -- RETURNING 은 새 값만 주기 때문에 "연장 전 마감"을 이렇게 잡아 둔다(BidHistory 가 요구한다).
      SELECT e.id, e."applyEndAt" AS deadline_before
      FROM "Event" e
      WHERE e.id = ${eventId}
    ),
    extended AS (
      UPDATE "Event" e SET
        "applyEndAt" = LEAST(
          e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
          e."softCloseHardEndAt"
        ),
        "originalApplyEndAt" = COALESCE(e."originalApplyEndAt", e."applyEndAt"),
        "rankingLockAt" = LEAST(
          e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
          e."softCloseHardEndAt"
        ) + make_interval(
          mins => CASE WHEN e."depositRequired" THEN e."depositWindowMinutes" ELSE 0 END + 1
        ),
        "softCloseExtensionCount" = e."softCloseExtensionCount" + 1,
        "version" = e."version" + 1,
        "updatedAt" = now()
      WHERE e.id = ${eventId}
        AND e."softCloseEnabled" = true
        AND e.status = 'OPEN'
        AND e."suspendedAt" IS NULL
        AND e."deletedAt" IS NULL
        -- LEAST 가 NULL 을 무시하는 성질 때문에 세 컬럼 모두 명시적으로 막는다.
        AND e."softCloseExtendMinutes" IS NOT NULL
        AND e."softCloseWindowMinutes" IS NOT NULL
        AND e."softCloseHardEndAt" IS NOT NULL
        AND e."softCloseExtensionCount" < e."softCloseMaxExtensions"
        AND now() >= e."applyEndAt" - make_interval(mins => e."softCloseWindowMinutes")
        AND now() <  e."applyEndAt"
        -- 실제로 뒤로 밀릴 때만 연장으로 친다. 하드 엔드에 이미 닿았으면 횟수만 소모하고 끝난다.
        AND LEAST(
              e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
              e."softCloseHardEndAt"
            ) > e."applyEndAt"
        AND (
          SELECT count(*) FROM "BidHistory" b
          WHERE b."eventId" = e.id AND b."userId" = ${userId} AND b."triggeredSoftClose"
        ) < e."softCloseMaxExtensionsPerUser"
      RETURNING e.id, e."applyEndAt" AS deadline_after,
                e."softCloseExtensionCount" AS extension_count
    )
    SELECT x.id               AS "eventId",
           b.deadline_before  AS "deadlineBefore",
           x.deadline_after   AS "deadlineAfter",
           x.extension_count::int AS "extensionCount"
    FROM extended x
    JOIN before b ON b.id = x.id
  `;
}

/**
 * 연장된 이벤트의 `rankingLockAt` 을 다시 맞춘다. (D-04 / IC-26)
 *
 * 위 문장이 두 컬럼을 함께 옮기므로 평시에는 대상이 0행이다. 그래도 크론에 두는 이유:
 * 운영자 수동 조정이나 과거 데이터 이관으로 `applyEndAt` 만 뒤로 간 이벤트가 생기면
 * **아직 살아 있는 예약금 홀드를 남긴 채로 순위가 확정된다**. 순위 확정은 되돌리기 가장 비싼 연산이라
 * 대사(對査) 비용이 사고 비용보다 언제나 싸다.
 *
 * 여기서는 `version` 을 올리지 않는다. version 은 파트너 PATCH 의 If-Match 토큰이고(IC-63),
 * 크론이 그걸 올리면 파트너가 편집 화면을 열어둔 채로는 저장을 영영 못 한다. 이 문장은 가드가 아니라
 * 복구라서 토큰을 건드릴 이유가 없다.
 */
export function reconcileRankingLockSql(limit: number): Prisma.Sql {
  return Prisma.sql`
    UPDATE "Event" e SET
      "rankingLockAt" = e."applyEndAt" + make_interval(
        mins => CASE WHEN e."depositRequired" THEN e."depositWindowMinutes" ELSE 0 END + 1
      ),
      "updatedAt" = now()
    WHERE e.id IN (
      SELECT id FROM "Event" x
      WHERE x.status IN ('OPEN','CLOSED')
        AND x."deletedAt" IS NULL
        AND (
          x."rankingLockAt" IS NULL
          OR x."rankingLockAt" < x."applyEndAt" + make_interval(
               mins => CASE WHEN x."depositRequired" THEN x."depositWindowMinutes" ELSE 0 END + 1
             )
        )
      ORDER BY x."applyEndAt"
      LIMIT ${limit}
    )
  `;
}
