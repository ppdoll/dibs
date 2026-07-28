import { Injectable, Logger } from '@nestjs/common';
import { EventMode, EventStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from './internal/event-audit.service';

/**
 * 한 번에 다시 세는 이벤트 수.
 *
 * Vercel 함수 실행 시간 안에서 끝나야 하고, 못 집은 이벤트는 다음 분에 집힌다 —
 * `ORDER BY statsRefreshedAt NULLS FIRST` 라 가장 오래 묵은 것부터 나가므로
 * 배치를 작게 잡아도 특정 이벤트가 영원히 굶지 않는다.
 */
const STATS_BATCH_SIZE = 200;

/** 이 시간이 지난 이벤트만 다시 센다. 경쟁률은 근사치여도 되는 값이다(IC-53). */
const STATS_STALE_SECONDS = 60;

/** 대사(對査)는 훨씬 비싸고 급하지 않다. 한 바퀴에 조금씩만 본다. */
const RECONCILE_BATCH_SIZE = 50;
const RECONCILE_STALE_SECONDS = 900;

/** 다시 셀 가치가 있는 상태. FINALIZED/CANCELED 는 더 이상 숫자가 움직이지 않는다. */
const COUNTABLE_STATUSES: readonly EventStatus[] = [
  EventStatus.SCHEDULED,
  EventStatus.OPEN,
  EventStatus.CLOSED,
];

/** 크론 컨트롤러의 응답 타입에 실려 나가므로 export 되어야 한다(TS4053). */
export interface ClaimedDriftRow {
  id: string;
  drift: number;
}

/**
 * 이벤트 집계 캐시. **크론에서만** 갱신한다. (IC-53)
 *
 * D-03 이 정원 강제를 포기해서 얻은 성질이 "신청 경로에 공유 카운터가 없다"는 것이다.
 * 경쟁률 표시용 숫자를 신청 트랜잭션에서 올리는 순간 모든 신청자가 같은 Event 행을
 * UPDATE 하려고 줄을 선다 — 정원 초과 허용으로 없앤 병목을 표시용 숫자 하나 때문에
 * 정확히 그대로 복구하는 것이다. D-07 이 공개하는 건 근사치여도 되는 경쟁률뿐이라
 * 실시간 정확도가 필요 없다.
 *
 * 여기서 `version` 을 올리지 않는 것이 중요하다. version 은 파트너 PATCH 의 If-Match
 * 토큰이다(IC-63). 크론이 1분마다 올리면 파트너가 편집 화면을 열어둔 채로는 저장을
 * 영영 못 한다 — 매번 412 다. 집계 캐시는 가드 대상이 아니므로 토큰을 건드리지 않는다.
 */
@Injectable()
export class EventStatsService {
  private readonly logger = new Logger(EventStatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 경쟁률 집계 다시 세기.
   *
   * 애플리케이션으로 신청 목록을 꺼내지 않고 한 문장 안에서 GROUP BY 로 끝낸다 —
   * 꺼내면 함수 메모리와 실행 시간이 신청 수에 비례해 늘어난다.
   * `FOR UPDATE SKIP LOCKED` 는 크론이 겹쳐 떠도(Vercel Cron 은 at-least-once) 같은
   * 이벤트를 두 인스턴스가 붙잡고 기다리지 않게 한다. 건너뛴 건 다음 바퀴에 집힌다.
   *
   * liveApplicantCount 는 **아직 경쟁에 남아 있는 사람**의 수다. 예약금을 아직 안 낸
   * PENDING_DEPOSIT 도 포함한다 — D-07 이 공개하는 "신청 47명"은 신청한 사람 수이지
   * 자격을 갖춘 사람 수가 아니고, 후자를 공개하면 커트라인 계산에 쓸 수 있는 정보가 된다.
   */
  async refreshStats() {
    const refreshed = await this.prisma.$executeRaw`
      WITH stale AS (
        SELECT e.id, e.capacity
        FROM "Event" e
        WHERE e.status = ANY (${[...COUNTABLE_STATUSES]}::"EventStatus"[])
          AND e."deletedAt" IS NULL
          AND (
            e."statsRefreshedAt" IS NULL
            OR e."statsRefreshedAt" < now() - make_interval(secs => ${STATS_STALE_SECONDS}::int)
          )
        ORDER BY e."statsRefreshedAt" ASC NULLS FIRST
        LIMIT ${STATS_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      ), counted AS (
        SELECT
          s.id,
          s.capacity,
          -- 괄호로 감싸고 캐스팅한다. count() 는 bigint 를 돌려주고 컬럼은 Int 라,
          -- 캐스팅을 빼면 Prisma 가 BigInt 를 물고 와서 JSON 직렬화에서 터진다.
          (count(a.id) FILTER (
            WHERE a.status IN ('PENDING_DEPOSIT','VALID','CONFIRMED')
          ))::int                                                 AS live,
          (count(a.id))::int                                      AS total,
          (count(a.id) FILTER (WHERE a.status = 'EXPIRED'))::int   AS expired,
          -- EVENT_CANCELED 를 빼는 이유: 그건 이용자가 취소한 게 아니라 이벤트가 죽은 것이다.
          -- 섞으면 "취소율이 높은 이벤트"를 찾는 운영 지표가 파트너의 취소 한 번으로 오염된다.
          (count(a.id) FILTER (WHERE a.status = 'CANCELED'))::int  AS canceled
        FROM stale s
        LEFT JOIN "Application" a ON a."eventId" = s.id
        GROUP BY s.id, s.capacity
      )
      UPDATE "Event" e SET
        "liveApplicantCount"    = c.live,
        "totalApplicationCount" = c.total,
        "expiredCount"          = c.expired,
        "canceledCount"         = c.canceled,
        -- "4.7:1" 을 정수로 담는 컬럼이라 10 을 곱한다. capacity >= 1 은 event_capacity_chk 가
        -- 지키지만 GREATEST 로 한 번 더 받는다 — 여기서 0 나누기가 나면 크론 전체가 죽는다.
        "competitionRatioX10"   = round(c.live * 10.0 / GREATEST(c.capacity, 1))::int,
        "statsRefreshedAt"      = now()
        -- version 도 updatedAt 도 건드리지 않는다. 표시용 캐시는 낙관적 락의 대상이 아니다(IC-63).
      FROM counted c
      WHERE e.id = c.id
    `;

    this.logger.log(`이벤트 집계 갱신: ${refreshed}건`);

    return { refreshed };
  }

  /**
   * INSTANT 정원 카운터 대사(對査). (IC-16)
   *
   * IC-15 의 점유·반환이 대칭이어도 스위퍼가 중간에 죽거나 운영자가 손으로 상태를 고치면
   * `claimedCount` 는 어긋난다. 실제보다 크면 남은 자리가 조용히 사라지고, 작으면 정원을
   * 넘겨 판다. 둘 다 이용자가 먼저 발견해서 CS 로 들어온다 — 그래서 **탐지 자체**가 목적이다.
   *
   * 이벤트마다 트랜잭션을 따로 여는 이유: 자문 락은 트랜잭션 수명과 묶여 있으므로
   * (pgbouncer transaction 모드라 xact 락뿐이다) 한 트랜잭션에서 50개를 처리하면
   * 락 50개를 끝까지 들고 있게 된다. 그 사이 해당 이벤트들의 신청이 전부 막힌다.
   *
   * BID 는 대상이 아니다 — 카운터 자체가 없다(D-02).
   */
  async reconcileClaimedCounts() {
    const targets = await this.prisma.event.findMany({
      where: {
        mode: EventMode.INSTANT,
        deletedAt: null,
        status: { in: [...COUNTABLE_STATUSES] },
        OR: [
          { claimedCountRefreshedAt: null },
          {
            claimedCountRefreshedAt: {
              lt: new Date(Date.now() - RECONCILE_STALE_SECONDS * 1000),
            },
          },
        ],
      },
      orderBy: { claimedCountRefreshedAt: { sort: 'asc', nulls: 'first' } },
      take: RECONCILE_BATCH_SIZE,
      select: { id: true },
    });

    const drifted: ClaimedDriftRow[] = [];

    for (const target of targets) {
      const row = await this.prisma.$transaction((tx) => this.reconcileOne(tx, target.id));

      if (row && row.drift !== 0) drifted.push(row);
    }

    // drift 는 로그가 아니라 경보다 — 0이 아니라는 건 원인이 코드에 남아 있다는 뜻이고,
    // 다음 바퀴에 저절로 사라지면 오히려 증거가 없어진다.
    if (drifted.length > 0) {
      this.logger.error(
        `★ INSTANT 정원 카운터 불일치 ${drifted.length}건: ${JSON.stringify(drifted)}`,
      );
    }

    return { checked: targets.length, drifted: drifted.length, details: drifted };
  }

  /**
   * 이벤트 하나를 실측과 맞춘다.
   *
   * `before` CTE 가 `FOR UPDATE` 로 Event 행을 잡고 `actual` 이 실측을 센다.
   * 자문 락은 트랜잭션의 첫 문장이고(IC-02), 락 이름은 감사 체인과 **다른 공간**을 쓴다 —
   * 같은 키를 쓰면 대사 크론이 그 이벤트의 감사 쓰기 전부와 경합한다.
   */
  private async reconcileOne(tx: Tx, eventId: string): Promise<ClaimedDriftRow | null> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`claimed-reconcile:${eventId}`}))
    `;

    const rows = await tx.$queryRaw<ClaimedDriftRow[]>`
      WITH before AS (
        SELECT "claimedCount" AS c FROM "Event" WHERE id = ${eventId} FOR UPDATE
      ), actual AS (
        SELECT count(*)::int AS c
        FROM "Application"
        WHERE "eventId" = ${eventId} AND "slotClaimed" = true
      )
      UPDATE "Event" e SET
        "claimedCount"            = (SELECT c FROM actual),
        "claimedCountRefreshedAt" = now()
      WHERE e.id = ${eventId}
        AND e.mode = 'INSTANT'
      RETURNING e.id, (SELECT c FROM before) - (SELECT c FROM actual) AS drift
    `;

    return rows[0] ?? null;
  }
}
