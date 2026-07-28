import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditActorRole, AuditTargetType, DepositReason } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { assertAffected } from '../common/db/assert-affected';
import { appendAuditLog, SYSTEM_CHAIN_KEY, type Tx } from './internal/audit';

/**
 * 한 배치에서 클레임하는 홀드 수. Vercel 함수 실행 시간 안에서 끝나야 하고,
 * 못 집은 홀드는 다음 분에 집힌다(`deposit_sweep_idx` 가 dueAt 순으로 준다).
 */
const SWEEP_BATCH_SIZE = 200;

/** 한 번의 크론 호출에서 돌리는 최대 배치 수. 함수 타임아웃 전에 스스로 멈춘다. */
const MAX_BATCHES_PER_RUN = 5;

/** 리마인더 배치 크기와 발송 시점(만기 N분 전). */
const REMINDER_BATCH_SIZE = 500;
const REMINDER_LEAD_MINUTES = 4;

interface ClaimedHold {
  id: string;
  applicationId: string;
  eventId: string;
  userId: string;
  reason: DepositReason;
}

export interface SweepResult {
  batches: number;
  claimed: number;
  expiredApplications: number;
  seatsReleased: number;
  rolledBack: number;
  notified: number;
  /** 다른 인스턴스가 이미 돌고 있어서 아무것도 안 했다는 뜻. 오류가 아니다. */
  skipped: boolean;
}

/**
 * 예약금 홀드 만료 스위퍼. (D-05 / IC-24)
 *
 * 서버리스라 상주 프로세스가 없다 — "10분 뒤에 만료시킨다"를 타이머로 만들 수 없으므로
 * 크론이 지나가며 따라잡고, 조회 시 지연 만료(lazy expiry)가 그 사이를 메운다.
 * 그래서 이 코드는 **재진입 가능**해야 한다: 같은 행을 두 경로가 동시에 만져도 안전해야 하고,
 * 중간에 함수가 죽어도 다음 실행이 이어받을 수 있어야 한다.
 *
 * 만료의 결과는 홀드의 성격에 따라 완전히 다르다(D-06).
 *  - INITIAL / REAPPLY  → 신청 자체가 무효(EXPIRED). INSTANT 면 잡아둔 자리를 **대칭으로** 반환한다(IC-15).
 *  - RAISE_SHORTFALL    → 신청을 죽이지 않고 **직전에 완납된 금액으로 롤백**한다(IC-23).
 *    상향 차액 미납으로 신청을 통째로 무효화하면 완납했던 금액까지 잃게 되어 부당하고,
 *    아무것도 안 하면 "올리기만 하고 안 내기"가 영구 이득이 된다.
 *
 * 락 순서: 자문 락(system 체인) → Deposit(클레임) → Application → Event.
 * IC-02 의 일반 순서(Event → Application → Deposit)와 Deposit/Event 위치가 다른데, 그 이유는
 * IC-15 가 자리 반환을 **Application 먼저, 그 다음 Event** 로 못 박았기 때문이다(★ 규칙이 우선한다).
 * 예약금 확정 경로(IC-21)도 Deposit → Application 순이라 앞부분은 그 경로와 일치한다.
 */
@Injectable()
export class DepositSweeperService {
  private readonly logger = new Logger(DepositSweeperService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 크론 진입점. 배치를 비울 때까지 돌되, 상한을 두고 스스로 멈춘다. */
  async expireHolds(): Promise<SweepResult> {
    const total: SweepResult = {
      batches: 0,
      claimed: 0,
      expiredApplications: 0,
      seatsReleased: 0,
      rolledBack: 0,
      notified: 0,
      skipped: false,
    };

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
      const batch = await this.sweepBatch();

      if (batch === 'BUSY') {
        total.skipped = true;
        break;
      }

      if (batch === null) break;

      total.batches += 1;
      total.claimed += batch.claimed;
      total.expiredApplications += batch.expiredApplications;
      total.seatsReleased += batch.seatsReleased;
      total.rolledBack += batch.rolledBack;
      total.notified += batch.notified;
    }

    if (total.claimed > 0 || total.skipped) {
      this.logger.log(`예약금 만료 스위퍼: ${JSON.stringify(total)}`);
    }

    return total;
  }

  /**
   * 배치 하나. 클레임부터 알림까지 한 트랜잭션이다.
   *
   * 자문 락을 `pg_try_advisory_xact_lock` 으로 잡는 이유: Vercel Cron 은 겹쳐서 실행된다
   * (이전 실행이 끝나기 전에 다음 실행이 시작된다). 블로킹 락으로 잡으면 두 번째 실행이 첫 번째를
   * 기다리다가 함수 타임아웃으로 죽고, 그 죽은 실행이 또 다음 실행을 밀어낸다. 못 잡으면
   * "이미 누가 돌고 있다"는 뜻이므로 조용히 물러나는 게 맞다 — 만료는 1분 늦어도 되는 일이다.
   * 락 자체가 필요한 이유는 마지막에 감사 집계 행을 system 체인에 잇기 때문이다(IC-02: 첫 문장).
   */
  private async sweepBatch(): Promise<Omit<SweepResult, 'batches' | 'skipped'> | null | 'BUSY'> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${SYSTEM_CHAIN_KEY})) AS acquired
      `;

      if (!lock?.acquired) return 'BUSY';

      // ★ FOR UPDATE SKIP LOCKED (IC-24). 없으면 겹쳐 뜬 두 실행이 같은 행에서 서로 기다리다
      //   둘 다 타임아웃한다. 지연 만료 경로도 같은 술어를 쓰므로 서로를 막지 않는다.
      const claimed = await tx.$queryRaw<ClaimedHold[]>`
        SELECT d.id, d."applicationId", d."eventId", d."userId", d.reason
        FROM "Deposit" d
        WHERE d.status = 'PENDING'
          AND d."dueAt" <= now()
        ORDER BY d."dueAt"
        LIMIT ${SWEEP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;

      if (claimed.length === 0) return null;

      const ids = claimed.map((row) => row.id);
      const shortfallIds = claimed
        .filter((row) => row.reason === DepositReason.RAISE_SHORTFALL)
        .map((row) => row.id);
      const initialIds = ids.filter((id) => !shortfallIds.includes(id));

      const expiry = initialIds.length
        ? await this.expireApplications(tx, initialIds)
        : { expired: 0, seatsReleased: 0 };
      const rolledBack = shortfallIds.length ? await this.rollbackShortfalls(tx, shortfallIds) : 0;

      // 홀드 자체는 성격과 무관하게 전부 EXPIRED 로 닫는다. 여기까지 왔다는 것은 그 행에 대한
      // 행 락을 우리가 들고 있고 클레임 시점에 PENDING 이었다는 뜻이라, 정확히 전부여야 한다(IC-01).
      const closed = await tx.$executeRaw`
        UPDATE "Deposit" d SET
          status       = 'EXPIRED'::"DepositStatus",
          "resolvedAt" = now(),
          "updatedAt"  = now()
        WHERE d.id = ANY(${ids})
          AND d.status = 'PENDING'
      `;

      assertAffected(closed, ids.length, 'DEPOSIT_SWEEP_RACE');

      const notified =
        (initialIds.length ? await this.notifyExpired(tx, initialIds) : 0) +
        (shortfallIds.length ? await this.notifyRolledBack(tx, shortfallIds) : 0);

      await appendAuditLog(tx, {
        actorUserId: null,
        actorRole: AuditActorRole.SYSTEM,
        actorLabel: 'system:cron/expire-holds',
        action: AuditAction.SYSTEM_SWEEP_EXPIRED_HOLDS,
        targetType: AuditTargetType.SYSTEM,
        targetId: 'deposit-sweeper',
        chainKey: SYSTEM_CHAIN_KEY,
        // 행마다 쓰지 않고 배치 집계 1행이다(IC-61). 홀드 200건에 감사 200행을 쓰면
        // 이 트랜잭션이 system 체인 락을 200배 오래 들고 다른 시스템 감사가 전부 뒤에 줄을 선다.
        summary:
          `예약금 홀드 만료 ${ids.length}건 — 신청 만료 ${expiry.expired}건, ` +
          `자리 반환 ${expiry.seatsReleased}건, 금액 롤백 ${rolledBack}건`,
        afterJson: {
          holds: ids.length,
          expiredApplications: expiry.expired,
          seatsReleased: expiry.seatsReleased,
          rolledBack,
        },
        // 멱등 키를 두지 않는다: 처리된 홀드는 더 이상 PENDING 이 아니라 같은 배치가 다시 잡히지
        // 않는다. 배치 구성이 매번 달라지므로 안정적인 키를 만들 방법도 없다.
      });

      return {
        claimed: ids.length,
        expiredApplications: expiry.expired,
        seatsReleased: expiry.seatsReleased,
        rolledBack,
        notified,
      };
    });
  }

  /**
   * 최초/재신청 홀드 만료 → 신청 무효 + INSTANT 자리 반환. (IC-15)
   *
   * 한 문장인 것이 핵심이다. 신청을 먼저 내리고 Event 를 따로 UPDATE 하면 그 사이가 경합 창이고,
   * 신청마다 Event 를 만지면 같은 행에 배치 크기만큼 줄이 선다 — D-03 이 없앤 병목을 되살리는 짓이다.
   * 그래서 `target` 에서 **UPDATE 이전 스냅샷**의 `slotClaimed` 를 세고, 실제로 자리를 들고 있던
   * 개수만큼만 `claimedCount` 를 깎는다. 이것이 IC-15 가 요구하는 대칭이다:
   * "점유했던 행만 반환하고, 반환한 개수만큼만 카운터를 내린다."
   *
   * `lastCanceledAt` 을 함께 찍는 이유: 만료 → 즉시 재신청으로 타이브레이크 시계를 세탁하는
   * 경로를 재신청 쿨다운(IC-14)이 막을 수 있게 하기 위해서다. 만료는 사용자가 누른 취소는 아니지만
   * 시계 세탁의 효과는 완전히 같다.
   */
  private async expireApplications(
    tx: Tx,
    depositIds: string[],
  ): Promise<{ expired: number; seatsReleased: number }> {
    const rows = await tx.$queryRaw<{ expired: number; seats_released: number }[]>`
      WITH target AS (
        SELECT d.id AS deposit_id, a.id AS app_id, a."eventId" AS event_id,
               a."slotClaimed" AS was_claimed
        FROM "Deposit" d
        JOIN "Application" a ON a.id = d."applicationId"
        WHERE d.id = ANY(${depositIds})
          AND a.status = 'PENDING_DEPOSIT'
        ORDER BY a.id
        FOR UPDATE OF a
      ),
      expired AS (
        UPDATE "Application" a SET
          status           = 'EXPIRED'::"ApplicationStatus",
          "depositStatus"  = 'EXPIRED'::"DepositStatus",
          "cancelReason"   = 'DEPOSIT_TIMEOUT'::"ApplicationCancelReason",
          "canceledAt"     = COALESCE(a."canceledAt", now()),
          "lastCanceledAt" = now(),
          "slotClaimed"    = false,
          "version"        = a."version" + 1,
          "updatedAt"      = now()
        FROM target t
        WHERE a.id = t.app_id
          AND a.status = 'PENDING_DEPOSIT'
        RETURNING a.id
      ),
      released AS (
        SELECT t.event_id, count(*)::int AS n
        FROM target t
        WHERE t.was_claimed
        GROUP BY t.event_id
      ),
      seats AS (
        UPDATE "Event" e SET
          "claimedCount" = GREATEST(e."claimedCount" - r.n, 0),
          "soldOutAt"    = CASE WHEN e."claimedCount" - r.n < e."capacity"
                                THEN NULL ELSE e."soldOutAt" END,
          "version"      = e."version" + 1,
          "updatedAt"    = now()
        FROM released r
        WHERE e.id = r.event_id
          AND e."claimedCount" > 0
        RETURNING e.id, r.n
      )
      SELECT
        (SELECT count(*)::int FROM expired)                    AS expired,
        COALESCE((SELECT sum(n)::int FROM seats), 0)           AS seats_released
    `;

    return {
      expired: rows[0]?.expired ?? 0,
      seatsReleased: rows[0]?.seats_released ?? 0,
    };
  }

  /**
   * 상향 차액 미납 → 금액과 시각을 **쌍으로** 되돌린다. (IC-23 / D-06)
   *
   * 둘을 따로 되돌리면 D-04 의 순위 규칙상 **존재한 적 없는 조합**이 복원되고, 그 순위는
   * 어떤 이력으로도 설명할 수 없다. `highestAmountEver` 는 되돌리지 않는다 — 그게 재상향의 하한이다.
   *
   * `BidHistory` 에 ROLLBACK 1행을 남기는 것이 규칙의 나머지 절반이다. `restoredLastBidAt` 이 없으면
   * 나중에 "왜 내 순위가 내려갔나" 문의에 답할 근거가 아무 데도 없다. 멱등 키를 홀드 id 로 만들어
   * 크론이 겹쳐 돌아도 이력이 두 번 남지 않게 한다(`bid_history_app_idem_uq`).
   */
  private async rollbackShortfalls(tx: Tx, depositIds: string[]): Promise<number> {
    const rows = await tx.$queryRaw<{ rolled: number }[]>`
      WITH target AS (
        SELECT d.id AS deposit_id, a.id AS app_id, a."eventId" AS event_id, a."userId" AS user_id,
               a."amount" AS prev_amount, a."settledAmount" AS settled_amount,
               a."settledLastBidAt" AS settled_last_bid_at, a."depositPaidAmount" AS deposit_paid
        FROM "Deposit" d
        JOIN "Application" a ON a.id = d."applicationId"
        WHERE d.id = ANY(${depositIds})
          AND a."depositStatus" = 'SHORTFALL_PENDING'
          AND a."settledAmount" < a."amount"
        ORDER BY a.id
        FOR UPDATE OF a
      ),
      rolled AS (
        UPDATE "Application" a SET
          "amount"        = a."settledAmount",
          "lastBidAt"     = a."settledLastBidAt",
          "depositStatus" = 'PAID'::"DepositStatus",
          "version"       = a."version" + 1,
          "updatedAt"     = now()
        FROM target t
        WHERE a.id = t.app_id
          AND a."depositStatus" = 'SHORTFALL_PENDING'
          AND a."settledAmount" < a."amount"
        RETURNING a.id
      ),
      history AS (
        INSERT INTO "BidHistory"
          ("id","applicationId","eventId","userId","seq","source","previousAmount","newAmount",
           "deltaAmount","bidAt","restoredLastBidAt","depositRequiredAfter","depositId",
           "actorType","idempotencyKey","updatedAt")
        SELECT
          gen_random_uuid()::text, t.app_id, t.event_id, t.user_id,
          COALESCE((SELECT max(b.seq) FROM "BidHistory" b WHERE b."applicationId" = t.app_id), 0) + 1,
          'ROLLBACK'::"BidSource",
          t.prev_amount,
          t.settled_amount,
          t.settled_amount - t.prev_amount,
          now(),
          t.settled_last_bid_at,
          t.deposit_paid,
          t.deposit_id,
          'SYSTEM_CRON'::"CoreActorType",
          'rollback:' || t.deposit_id,
          now()
        FROM target t
        WHERE t.app_id IN (SELECT id FROM rolled)
        ON CONFLICT ("applicationId","idempotencyKey") DO NOTHING
        RETURNING 1
      )
      SELECT (SELECT count(*)::int FROM rolled) AS rolled
    `;

    return rows[0]?.rolled ?? 0;
  }

  /**
   * 만료 통보. (IC-42)
   *
   * 도메인 쓰기와 같은 트랜잭션이다 — 자리를 잃은 사실을 알리지 못하는 만료는 소비자 보호 실패다.
   * 문구에 금액·순위·커트라인이 없다(D-07/IC-44): 만료는 본인 사정이고, 남의 숫자를 알려줄 이유가 없다.
   */
  private notifyExpired(tx: Tx, depositIds: string[]): Promise<number> {
    const titleKo = '예약금 납부 시간이 지났습니다';
    const bodyKo =
      '납부 시간 안에 예약금이 확인되지 않아 신청이 만료되었습니다. 신청 기간이 남아 있다면 다시 신청하실 수 있습니다.';

    return tx.$executeRaw`
      INSERT INTO "Notification"
        ("id","userId","type","category","priority","titleKo","bodyKo","payload",
         "deepLinkPath","eventId","applicationId","dedupeKey","updatedAt")
      SELECT
        gen_random_uuid()::text,
        d."userId",
        'DEPOSIT_HOLD_EXPIRED'::"NotificationType",
        'DEPOSIT'::"NotificationCategory",
        'HIGH'::"NotificationPriority",
        ${titleKo}::text,
        ${bodyKo}::text,
        jsonb_build_object('eventId', d."eventId"),
        '/events/' || d."eventId",
        d."eventId",
        d."applicationId",
        'DEPOSIT_HOLD_EXPIRED:' || d.id,
        now()
      FROM "Deposit" d
      WHERE d.id = ANY(${depositIds})
      ON CONFLICT ("userId","dedupeKey") DO NOTHING
    `;
  }

  /** 롤백 통보. 신청이 살아 있다는 점을 반드시 말해 준다 — 안 그러면 만료로 오해한다(D-06). */
  private notifyRolledBack(tx: Tx, depositIds: string[]): Promise<number> {
    const titleKo = '추가 예약금이 확인되지 않았습니다';
    const bodyKo =
      '올리신 금액에 대한 추가 예약금이 납부되지 않아, 신청 금액이 직전 금액으로 되돌아갔습니다. 신청 자체는 그대로 유효합니다.';

    return tx.$executeRaw`
      INSERT INTO "Notification"
        ("id","userId","type","category","priority","titleKo","bodyKo","payload",
         "deepLinkPath","eventId","applicationId","dedupeKey","updatedAt")
      SELECT
        gen_random_uuid()::text,
        d."userId",
        'REBID_ROLLED_BACK'::"NotificationType",
        'DEPOSIT'::"NotificationCategory",
        'HIGH'::"NotificationPriority",
        ${titleKo}::text,
        ${bodyKo}::text,
        jsonb_build_object('eventId', d."eventId"),
        '/events/' || d."eventId",
        d."eventId",
        d."applicationId",
        'REBID_ROLLED_BACK:' || d.id,
        now()
      FROM "Deposit" d
      WHERE d.id = ANY(${depositIds})
      ON CONFLICT ("userId","dedupeKey") DO NOTHING
    `;
  }

  /**
   * 만기 임박 리마인더. 홀드당 **정확히 1회**다. (IC-25)
   *
   * 순서가 규칙이다: 먼저 `reminderSentAt` 을 조건부로 찍고, **찍힌 행에 대해서만** 알림을 만든다.
   * 반대로 하면 매분 도는 크론이 열린 홀드 전부에 대해 INSERT 를 시도하고
   * `uq_notification_user_dedupe` 위반으로 트랜잭션을 굴려서 중복을 막는 꼴이 된다 —
   * 그건 중복 제거가 아니라 실패를 중복 제거로 착각하는 것이고, 같은 트랜잭션의 다른 쓰기까지 함께 죽는다.
   *
   * 한 문장 안의 CTE 로 묶은 이유: 클레임과 알림 생성 사이에서 함수가 죽으면 그 홀드는
   * "리마인더를 보냈다고 표시됐지만 실제로는 안 간" 상태로 영구히 남는다. 홀드당 1회라 재시도도 없다.
   */
  async sendDepositReminders(): Promise<{ claimed: number; notified: number }> {
    const titleKo = '예약금 납부 시간이 곧 끝납니다';
    const bodyKo =
      '예약금 납부 시간이 얼마 남지 않았습니다. 시간 안에 납부하지 않으면 신청이 만료됩니다.';

    const rows = await this.prisma.$queryRaw<{ claimed: number; notified: number }[]>`
      WITH claimed AS (
        UPDATE "Deposit" d SET
          "reminderSentAt" = now(),
          "updatedAt"      = now()
        WHERE d.id IN (
          SELECT x.id FROM "Deposit" x
          WHERE x.status = 'PENDING'
            AND x."reminderSentAt" IS NULL
            AND x."dueAt" > now()
            AND x."dueAt" <= now() + make_interval(mins => ${REMINDER_LEAD_MINUTES}::int)
          ORDER BY x."dueAt"
          LIMIT ${REMINDER_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
          AND d.status = 'PENDING'
          AND d."reminderSentAt" IS NULL
          AND d."dueAt" > now()
        RETURNING d.id, d."applicationId", d."eventId", d."userId", d."dueAt"
      ),
      sent AS (
        INSERT INTO "Notification"
          ("id","userId","type","category","priority","titleKo","bodyKo","payload",
           "deepLinkPath","eventId","applicationId","dedupeKey","updatedAt")
        SELECT
          gen_random_uuid()::text,
          c."userId",
          'DEPOSIT_REMINDER'::"NotificationType",
          'DEPOSIT'::"NotificationCategory",
          'CRITICAL'::"NotificationPriority",
          ${titleKo}::text,
          ${bodyKo}::text,
          -- 만기 시각은 본인 정보라 payload 에 실어도 D-07 에 걸리지 않는다.
          -- 금액을 싣지 않는 이유는 다르다: 이 알림은 이메일로도 나가고, 메일함은 유출 경로가 하나 더 많다.
          jsonb_build_object(
            'eventId', c."eventId",
            'dueAt', to_char(c."dueAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ),
          '/events/' || c."eventId",
          c."eventId",
          c."applicationId",
          'DEPOSIT_REMINDER:' || c.id,
          now()
        FROM claimed c
        ON CONFLICT ("userId","dedupeKey") DO NOTHING
        RETURNING 1
      )
      SELECT (SELECT count(*)::int FROM claimed) AS claimed,
             (SELECT count(*)::int FROM sent)    AS notified
    `;

    const result = rows[0] ?? { claimed: 0, notified: 0 };

    if (result.claimed > 0) {
      this.logger.log(`예약금 리마인더: ${JSON.stringify(result)}`);
    }

    return result;
  }
}
