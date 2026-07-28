import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditActorRole,
  AuditTargetType,
  SelectionRoundStatus,
} from '@prisma/client';
import { RANKABLE_STATUSES } from '@dibs/shared';

import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { acquireAuditChainLock, appendAuditLog, eventChainKey, type Tx } from './internal/audit';
import {
  actorLabelOf,
  actorRoleOf,
  isAdmin,
  ownerScopeOf,
} from './internal/selection-context';
import { reconcileRankingLockSql } from './internal/soft-close.sql';

/** 한 번의 크론에서 라운드를 여는 이벤트 수. 못 집은 이벤트는 다음 분에 집힌다. */
const OPEN_ROUND_BATCH_SIZE = 20;

/** 대사는 평시에 0행이라 크게 잡아도 비용이 없다. */
const RANKING_LOCK_RECONCILE_BATCH = 200;

/** 라운드를 새로 열 수 없는 상태 — 아직 심사가 끝나지 않은 라운드가 살아 있다는 뜻이다. */
const LIVE_ROUND_STATUSES: readonly SelectionRoundStatus[] = [
  SelectionRoundStatus.PENDING,
  SelectionRoundStatus.RANKING_READY,
  SelectionRoundStatus.DRAFT,
  SelectionRoundStatus.REOPENED,
];

export interface OpenRoundResult {
  eventId: string;
  selectionId: string;
  roundNo: number;
  entryCount: number;
  eligibleCount: number;
  excludedCount: number;
}

/**
 * 순위 확정(라운드 개시).
 *
 * 이 서비스가 하는 일은 하나다: **그 순간의 순위를 얼려서 SelectionEntry 에 박는다.**
 * 파트너 심사는 그 위에서만 일어난다(SelectionService).
 *
 * 세 가지가 이 서비스의 전부다.
 *  1. 게이트 — `rankingLockAt` 이 지났고, **열린 예약금 홀드가 하나도 없어야** 한다(D-04 / IC-26).
 *  2. 순위   — `ROW_NUMBER()` 로 DB 안에서 계산한다. TS 정렬 금지(IC-31).
 *  3. 동결   — `INSERT ... SELECT` 로 DB 안에서 복사한다. 애플리케이션을 왕복시키지 않는다(IC-34).
 *
 * 2·3 이 raw SQL 인 이유는 취향이 아니다. `lastBidAt` 은 `Timestamptz(6)`(마이크로초)인데 Prisma 는
 * 그걸 밀리초 JS `Date` 로 깎아서 준다. 꺼냈다 넣는 순간 DB 에서는 순서가 확정돼 있던 두 입찰이
 * 동점이 되고, TS 정렬 결과가 `app_rank_active` 인덱스의 순서와 갈린다. 분쟁이 났을 때
 * "그때 순위가 이랬음"을 증명하려고 만든 스냅샷이 DB 에서 재현 불가능해진다(IC-04).
 */
@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 순위 확정 시각 대사(對査). 라운드를 열기 **직전에** 돌린다.
   *
   * 소프트 클로즈 연장은 `applyEndAt` 과 `rankingLockAt` 을 한 문장에서 함께 옮기므로 평시에는
   * 대상이 0행이다. 그래도 먼저 돌리는 이유는 순서 때문이다 — 어긋난 `rankingLockAt` 을 그대로 두고
   * 라운드를 열면, 아직 예약금 시계가 남은 신청자를 빼놓은 채로 순위가 얼어붙는다.
   * 그건 되돌리려면 라운드를 통째로 다시 여는 수밖에 없는 종류의 사고다(D-04).
   */
  async reconcileRankingLocks(): Promise<number> {
    const repaired = await this.prisma.$executeRaw(
      reconcileRankingLockSql(RANKING_LOCK_RECONCILE_BATCH),
    );

    if (repaired > 0) {
      this.logger.warn(`rankingLockAt 이 마감보다 앞선 이벤트 ${repaired}건을 되돌렸습니다.`);
    }

    return repaired;
  }

  /**
   * 크론: `rankingLockAt` 이 지난 이벤트의 1라운드를 연다.
   *
   * 이벤트마다 트랜잭션을 따로 잡는다. 한 배치를 통째로 한 트랜잭션에 넣으면 이벤트 하나가
   * 실패할 때 나머지가 전부 롤백되고, 감사 체인 자문 락도 그동안 계속 잡혀 있다(IC-61).
   * 실패는 이벤트 단위로 삼키고 로그로 남긴다 — 다음 분에 다시 집힌다.
   */
  async openDueRounds(): Promise<{ scanned: number; opened: OpenRoundResult[]; failed: number }> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT e.id
      FROM "Event" e
      WHERE e.status = 'CLOSED'
        AND e."deletedAt" IS NULL
        AND e."suspendedAt" IS NULL
        AND e."rankingLockAt" IS NOT NULL
        AND e."rankingLockAt" <= now()
        -- 열린 홀드가 하나라도 남아 있으면 확정하지 않는다(IC-26).
        -- dueAt 이 지난 PENDING 도 포함해서 막는 이유: 그건 "만료됐지만 스위퍼가 아직 안 지나간"
        -- 홀드다. 그 상태로 순위를 얼리면 곧 무효가 될 신청이 명단에 들어간다.
        AND NOT EXISTS (
          SELECT 1 FROM "Deposit" d WHERE d."eventId" = e.id AND d.status = 'PENDING'
        )
        AND NOT EXISTS (SELECT 1 FROM "Selection" s WHERE s."eventId" = e.id)
      ORDER BY e."rankingLockAt"
      LIMIT ${OPEN_ROUND_BATCH_SIZE}
    `;

    const opened: OpenRoundResult[] = [];
    let failed = 0;

    for (const { id } of due) {
      try {
        const result = await this.openRound(id, {
          actorUserId: null,
          actorRole: AuditActorRole.SYSTEM,
          actorLabel: 'system:cron/finalize-rankings',
        });

        if (result) opened.push(result);
      } catch (error) {
        failed += 1;
        this.logger.error(`라운드 개시 실패 eventId=${id}: ${String(error)}`);
      }
    }

    return { scanned: due.length, opened, failed };
  }

  /**
   * 파트너·운영자가 직접 라운드를 연다.
   *
   * 크론이 1분마다 도는데도 수동 경로를 두는 이유: 1라운드가 확정된 뒤 결원이 생기면
   * (선정자 취소·노쇼) 파트너가 **결원 보충 라운드**를 열어야 하는데, 그건 시각이 아니라
   * 사람의 판단으로 시작된다(`roundNo` 2 이상).
   */
  async openRoundManually(user: AuthenticatedUser, eventId: string): Promise<OpenRoundResult> {
    const scope = ownerScopeOf(user);

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, deletedAt: null, ...(scope ? { partnerId: scope } : {}) },
      select: { id: true, status: true, rankingLockAt: true },
    });

    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    const result = await this.openRound(eventId, {
      actorUserId: user.id,
      actorRole: actorRoleOf(user),
      actorLabel: actorLabelOf(user),
      partnerScope: isAdmin(user) ? null : scope,
    });

    if (!result) {
      // 0행의 뜻은 셋 중 하나다: 아직 확정 시각 전 / 살아 있는 홀드가 남음 / 심사 중인 라운드가 있음.
      // 셋 다 "지금 상태에서는 받을 수 없다"이므로 409 다(IC-01).
      throw new ConflictException({
        code: 'SELECTION_ROUND_NOT_OPENABLE',
        message:
          '아직 순위를 확정할 수 없습니다. 예약금 마감이 지나야 하고, 진행 중인 심사 라운드가 없어야 합니다.',
      });
    }

    return result;
  }

  /**
   * 라운드 개시 본체. 한 트랜잭션 안에서 게이트·순위·동결·커트라인·감사를 전부 끝낸다.
   *
   * 락 순서는 전 코드베이스에서 하나다(IC-02): 자문 락 → Event → Application → SelectionEntry.
   * 감사 행을 쓰는 트랜잭션이므로 자문 락이 **첫 문장**이다. 중간에서 잡으면 이미 확보한 행 락을
   * 든 채로 대기하게 되어 순서 규칙이 깨지고, 이벤트 취소 트랜잭션과 만나 데드락이 난다.
   */
  private async openRound(
    eventId: string,
    actor: {
      actorUserId: string | null;
      actorRole: AuditActorRole;
      actorLabel: string;
      partnerScope?: string | null;
    },
  ): Promise<OpenRoundResult | null> {
    return this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, eventChainKey(eventId));

      const created = await this.insertRound(tx, eventId, actor.partnerScope ?? null);
      if (!created) return null;

      const entryCount = await this.freezeEntries(tx, created.id, created.partnerId);
      const counts = await this.computeRankingSnapshot(tx, created.id);
      await this.upsertCutoff(tx, created.id);

      await appendAuditLog(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        actorLabel: actor.actorLabel,
        action: AuditAction.SYSTEM_RANKING_FINALIZED,
        targetType: AuditTargetType.SELECTION,
        targetId: created.id,
        targetOwnerUserId: created.partnerUserId,
        chainKey: eventChainKey(eventId),
        // 대량 작업은 행마다 쓰지 않고 집계 1행이다(IC-61). 200명짜리 라운드에 감사 200행을 쓰면
        // 그 트랜잭션이 자문 락을 200배 오래 들고, 같은 이벤트의 다른 쓰기가 전부 뒤에 줄을 선다.
        summary:
          `순위 확정 라운드 ${created.roundNo} 개시 — 후보 ${entryCount}명 ` +
          `(적격 ${counts.eligibleCount} / 제외 ${counts.excludedCount})`,
        afterJson: {
          selectionId: created.id,
          roundNo: created.roundNo,
          rankingSnapshotHash: counts.rankingSnapshotHash,
        },
        // 크론이 겹쳐 돌아도(Vercel Cron 은 at-least-once) 감사 행은 하나다.
        idempotencyKey: `ranking-open:${created.id}`,
      });

      return {
        eventId,
        selectionId: created.id,
        roundNo: created.roundNo,
        entryCount,
        eligibleCount: counts.eligibleCount,
        excludedCount: counts.excludedCount,
      };
    });
  }

  /**
   * 라운드 행을 만든다. **게이트가 전부 이 문장의 WHERE 안에 있다.**
   *
   * 읽고 → 검사하고 → INSERT 하면 그 사이에 예약금이 하나 더 들어오거나 다른 인스턴스가 같은
   * 라운드를 연다. `selection_event_round_uq` 가 최종 방어선이지만, 유니크 위반으로 트랜잭션이
   * 굴러떨어지는 것과 0행이 나오는 것은 운영상 완전히 다른 사건이라 `ON CONFLICT DO NOTHING` 으로
   * 조용히 넘긴다(크론은 겹쳐서 실행된다).
   *
   * `remainingSeats` 를 여기서 확정하는 이유: 결원 보충 라운드(roundNo≥2)의 정원은 전체 정원이
   * 아니라 **앞 라운드에서 이미 선정된 사람을 뺀 나머지**다. 이 값이 곧 `withinCapacity` 의 기준선이라
   * 나중에 고치면 스냅샷(write-once)과 어긋난다.
   */
  private async insertRound(
    tx: Tx,
    eventId: string,
    partnerScope: string | null,
  ): Promise<{ id: string; roundNo: number; partnerId: string; partnerUserId: string } | null> {
    const rows = await tx.$queryRaw<{ id: string; roundNo: number }[]>`
      INSERT INTO "Selection" (
        "id","eventId","roundNo","status","eventMode",
        "capacitySnapshot","remainingSeats","effectiveDeadlineAt","depositWindowMinutes",
        "rankingBasisAt","updatedAt"
      )
      SELECT
        gen_random_uuid()::text,
        e.id,
        COALESCE((SELECT max(s2."roundNo") FROM "Selection" s2 WHERE s2."eventId" = e.id), 0) + 1,
        'PENDING'::"SelectionRoundStatus",
        e.mode,
        e."capacity",
        GREATEST(
          e."capacity" - (
            SELECT count(*) FROM "SelectionEntry" pe
            WHERE pe."eventId" = e.id AND pe.status = 'SELECTED'
          ),
          0
        )::int,
        e."applyEndAt",
        CASE WHEN e."depositRequired" THEN e."depositWindowMinutes" ELSE 0 END,
        COALESCE(e."rankingLockAt", e."applyEndAt"),
        now()
      FROM "Event" e
      WHERE e.id = ${eventId}
        AND e."deletedAt" IS NULL
        AND e."suspendedAt" IS NULL
        AND e.status IN ('CLOSED','FINALIZED')
        AND (${partnerScope}::text IS NULL OR e."partnerId" = ${partnerScope}::text)
        AND e."rankingLockAt" IS NOT NULL
        AND e."rankingLockAt" <= now()
        AND NOT EXISTS (
          SELECT 1 FROM "Deposit" d WHERE d."eventId" = e.id AND d.status = 'PENDING'
        )
        -- 심사가 끝나지 않은 라운드가 살아 있으면 새 라운드를 열지 않는다. 두 라운드가 동시에
        -- 열려 있으면 같은 신청이 두 명단에 들어가고, 어느 쪽이 진짜인지 정할 근거가 없다.
        AND NOT EXISTS (
          SELECT 1 FROM "Selection" s
          WHERE s."eventId" = e.id AND s.status = ANY(${[...LIVE_ROUND_STATUSES]}::"SelectionRoundStatus"[])
        )
      ON CONFLICT ("eventId","roundNo") DO NOTHING
      RETURNING id, "roundNo"
    `;

    const created = rows[0];
    if (!created) return null;

    const owner = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { partnerId: true, partner: { select: { userId: true } } },
    });

    return {
      id: created.id,
      roundNo: Number(created.roundNo),
      partnerId: owner.partnerId,
      partnerUserId: owner.partner.userId,
    };
  }

  /**
   * ★ 순위 계산 + 스냅샷 동결. (IC-31 / IC-32 / IC-33 / IC-34)
   *
   * 정렬 키는 D-04 그대로다: `amount DESC, "lastBidAt" ASC, "applySeq" ASC`.
   * 세 키의 순서도 방향도 바꾸지 않는다. 3순위가 `id` 가 아니라 `applySeq` 인 이유는,
   * cuid v1 이 "우연히" 시간순인 것에 공정성을 기대면 id 생성기를 바꾸는 순간 조용히 임의 순서가
   * 되기 때문이다.
   *
   * 자격 술어는 `status IN ('VALID','CONFIRMED')` 다(IC-32). `= 'VALID'` 로 쓰면 INSTANT 이벤트의
   * 명단이 **통째로 빈다** — 에러도 아니라서 아무도 눈치채지 못한다. BID 는 VALID 에서 멈춰
   * 파트너 심사를 기다리고 INSTANT 는 CONFIRMED 에서 끝나기 때문이다.
   *
   * 제외 대상(차단 이용자·직전 라운드 선정자)은 목록에서 빼지 않고 `rankNo = NULL` 인 행으로
   * 남긴다. 빼버리면 파트너 화면에서 "왜 이 사람이 없지"를 설명할 수 없고, IC-66 이 요구하는
   * "근거가 행으로 남는다"도 무너진다. 순번은 `PARTITION BY (제외여부)` 로 적격자에게만 매긴다.
   */
  private async freezeEntries(tx: Tx, selectionId: string, partnerId: string): Promise<number> {
    return tx.$executeRaw`
      INSERT INTO "SelectionEntry" (
        "id","selectionId","eventId","applicationId","userId",
        "displayNameSnapshot","amountSnapshot","lastBidAtSnapshot","appliedAtSnapshot",
        "rebidCountSnapshot","depositStatusSnapshot","depositPaidSnapshot","depositConfirmedAtSnapshot",
        "rankNo","isEligible","exclusionReason","tieGroupKey","tieOrdinal","withinCapacity",
        "status","source","preselectedAt","updatedAt"
      )
      SELECT
        -- id 를 SQL 에서 만드는 이유: 애플리케이션으로 꺼냈다 넣으면 그 왕복에서 lastBidAt 이
        -- 밀리초로 깎인다. 다른 모델은 cuid 지만 이 컬럼은 String @id 라 형식을 강제하지 않는다.
        gen_random_uuid()::text,
        r.selection_id, r.event_id, r.application_id, r.user_id,
        r.display_name, r.amount, r.last_bid_at, r.first_applied_at,
        r.rebid_count, r.deposit_status, r.deposit_paid, r.confirmed_at,
        CASE WHEN r.exclusion IS NULL THEN r.rank_no::int END,
        r.exclusion IS NULL,
        r.exclusion::"SelectionExclusionReason",
        CASE WHEN r.exclusion IS NULL THEN r.tie_key END,
        CASE WHEN r.exclusion IS NULL THEN r.tie_ord::int END,
        -- selection_entry_capacity_chk: 정원 안에 든 항목은 반드시 적격이어야 한다.
        r.exclusion IS NULL AND r.rank_no <= r.remaining_seats,
        -- INSTANT 는 신청 순간 이미 자리를 잡았다(D-02). 파트너가 다시 고르는 물건이 아니므로
        -- 정원 안쪽은 곧바로 PRESELECTED 로 들어간다. BID 만 CANDIDATE 에서 심사를 기다린다.
        CASE
          WHEN r.event_mode = 'INSTANT' AND r.exclusion IS NULL AND r.rank_no <= r.remaining_seats
            THEN 'PRESELECTED'::"SelectionStatus"
          ELSE 'CANDIDATE'::"SelectionStatus"
        END,
        CASE
          WHEN r.event_mode = 'INSTANT' THEN 'INSTANT_CLAIM'::"SelectionEntrySource"
          ELSE 'AUTO_RANK'::"SelectionEntrySource"
        END,
        CASE
          WHEN r.event_mode = 'INSTANT' AND r.exclusion IS NULL AND r.rank_no <= r.remaining_seats
            THEN now()
        END,
        now()
      FROM (
        SELECT
          s.id                AS selection_id,
          s."remainingSeats"  AS remaining_seats,
          a."eventId"         AS event_id,
          a.id                AS application_id,
          a."userId"          AS user_id,
          a."eventMode"       AS event_mode,
          u."displayName"     AS display_name,
          a."amount"          AS amount,
          a."lastBidAt"       AS last_bid_at,
          a."firstAppliedAt"  AS first_applied_at,
          a."rebidCount"      AS rebid_count,
          a."depositStatus"   AS deposit_status,
          a."depositPaidAmount" AS deposit_paid,
          a."confirmedAt"     AS confirmed_at,
          x.exclusion,
          ROW_NUMBER() OVER (
            PARTITION BY (x.exclusion IS NULL)
            ORDER BY a."amount" DESC, a."lastBidAt" ASC, a."applySeq" ASC
          ) AS rank_no,
          ROW_NUMBER() OVER (
            PARTITION BY (x.exclusion IS NULL), a."amount", a."lastBidAt"
            ORDER BY a."applySeq" ASC
          ) AS tie_ord,
          -- 동점 그룹 키는 (금액, 그 금액 도달 시각) 조합이다. 마이크로초(US)까지 넣어야
          -- 컬럼과 1:1 로 대응한다 — 밀리초까지만 넣으면 DB 가 구분하는 두 입찰이 같은 키를 받는다.
          a."amount"::text || '-' ||
            to_char(a."lastBidAt" AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS tie_key
        FROM "Selection" s
        JOIN "Application" a ON a."eventId" = s."eventId"
        JOIN "User" u        ON u.id = a."userId"
        CROSS JOIN LATERAL (
          SELECT CASE
            -- IC-66: 제외에는 근거 행이 있어야 한다. 자동 신호로는 제외하지 않는다.
            WHEN EXISTS (
              SELECT 1 FROM "PartnerBlockedUser" pb
              WHERE pb."partnerProfileId" = ${partnerId}
                AND pb."userId" = a."userId"
                AND pb."releasedAt" IS NULL
            ) THEN 'BLOCKED_USER'
            WHEN EXISTS (
              SELECT 1 FROM "SelectionEntry" pe
              WHERE pe."eventId" = s."eventId"
                AND pe."userId" = a."userId"
                AND pe."selectionId" <> s.id
                AND pe.status = 'SELECTED'
            ) THEN 'ALREADY_SELECTED_PRIOR_ROUND'
            ELSE NULL
          END AS exclusion
        ) x
        WHERE s.id = ${selectionId}
          AND a.status = ANY(${[...RANKABLE_STATUSES]}::"ApplicationStatus"[])   -- IC-32
          -- IC-33: 마감 이후에 들어온 신청은 순위에 넣지 않는다. FOR SHARE 가드가 있어도
          -- 운영자 수동 조정·크론 부분 실패·데이터 이관 경로가 남아 있고, 순위 확정은
          -- 되돌리기 가장 비싼 연산이다. 술어 하나 더 거는 비용은 인덱스 한 번이다.
          AND a."firstAppliedAt" < s."effectiveDeadlineAt"
      ) r
      ON CONFLICT ("selectionId","applicationId") DO NOTHING
    `;
  }

  /**
   * 순위 스냅샷 해시와 집계. (IC-04)
   *
   * 해시를 SQL 안에서 만드는 이유는 재현 가능성 하나다. TS 에서 만들면 `Timestamptz(6)` 이
   * 밀리초로 깎인 값 위에서 계산되므로 **DB 에서 같은 값을 다시 만들 수 없다**. 분쟁이 났을 때
   * "그때 순위가 이랬음"을 증명하려고 만든 해시가 증명을 못 하면 존재 이유가 없다.
   *
   * IC-04 의 예시는 `Application` 위에서 계산하지만 여기서는 방금 얼린 `SelectionEntry` 위에서
   * 계산한다. Application 의 금액과 시각은 이후에도 계속 움직이므로(다음 라운드, 관리자 조정)
   * 몇 달 뒤에 같은 해시를 재현할 수 있는 테이블은 write-once 인 스냅샷 쪽뿐이다.
   * 구분자로 `chr(10)` 을 쓰는 이유는 TS 템플릿 리터럴에서 `E'\n'` 이 진짜 개행으로 먼저 치환되기 때문이다.
   */
  private async computeRankingSnapshot(
    tx: Tx,
    selectionId: string,
  ): Promise<{ eligibleCount: number; excludedCount: number; rankingSnapshotHash: string }> {
    const rows = await tx.$queryRaw<
      { eligibleCount: number; excludedCount: number; rankingSnapshotHash: string }[]
    >`
      UPDATE "Selection" s SET
        status                = 'RANKING_READY'::"SelectionRoundStatus",
        "rankingComputedAt"   = now(),
        "rankingSnapshotHash" = h.hash,
        "eligibleCount"       = h.eligible_count,
        "excludedCount"       = h.excluded_count,
        "autoPreselectedCount"= h.preselected_count,
        "selectedCount"       = 0,
        "version"             = s."version" + 1,
        "updatedAt"           = now()
      FROM (
        SELECT
          encode(sha256(convert_to(COALESCE(string_agg(
            e."applicationId" || '|' || e."amountSnapshot"::text || '|' ||
            to_char(e."lastBidAtSnapshot" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            || '|' || e."rankNo"::text,
            chr(10) ORDER BY e."rankNo"
          ) FILTER (WHERE e."rankNo" IS NOT NULL), ''), 'UTF8')), 'hex')      AS hash,
          count(*) FILTER (WHERE e."isEligible")::int                          AS eligible_count,
          count(*) FILTER (WHERE NOT e."isEligible")::int                      AS excluded_count,
          count(*) FILTER (WHERE e.status = 'PRESELECTED')::int                AS preselected_count
        FROM "SelectionEntry" e
        WHERE e."selectionId" = ${selectionId}
      ) h
      WHERE s.id = ${selectionId}
        AND s.status = 'PENDING'
      RETURNING s."eligibleCount" AS "eligibleCount",
                s."excludedCount" AS "excludedCount",
                s."rankingSnapshotHash" AS "rankingSnapshotHash"
    `;

    const row = rows[0];
    if (!row) {
      throw new ConflictException({
        code: 'SELECTION_RANKING_ALREADY_COMPUTED',
        message: '이미 순위가 계산된 라운드입니다.',
      });
    }

    return row;
  }

  /**
   * ★ 커트라인. `SelectionCutoff` 에만 쓴다. (IC-35 / D-07)
   *
   * 별도 테이블인 것이 방어의 핵심이다. `Selection` 의 스칼라였을 때는 `include: { selections: true }`
   * 한 줄로 공개됐다. 커트라인 하나가 새면 그 이벤트의 모든 참가자가 최소 낙찰가를 알게 되어
   * 밀봉입찰이 공개입찰이 된다 — D-07 이 감추는 숫자 중 가장 위험한 값이다.
   *
   * `hasCutoffTie` 는 "경계 금액·시각과 완전히 같은데 정원 밖으로 밀린 사람이 있는가"다.
   * 있으면 3순위 키(`applySeq`)만으로 당락이 갈렸다는 뜻이라 파트너가 알아야 한다.
   */
  private async upsertCutoff(tx: Tx, selectionId: string): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "SelectionCutoff" ("selectionId","cutoffAmount","cutoffLastBidAt","hasCutoffTie","updatedAt")
      SELECT
        ${selectionId},
        b."amountSnapshot",
        b."lastBidAtSnapshot",
        EXISTS (
          SELECT 1 FROM "SelectionEntry" t
          WHERE t."selectionId" = ${selectionId}
            AND t."amountSnapshot"    = b."amountSnapshot"
            AND t."lastBidAtSnapshot" = b."lastBidAtSnapshot"
            AND t."withinCapacity" = false
            AND t."isEligible" = true
        ),
        now()
      FROM "SelectionEntry" b
      JOIN "Selection" s ON s.id = b."selectionId"
      WHERE b."selectionId" = ${selectionId}
        AND b."isEligible" = true
        AND b."rankNo" = s."remainingSeats"
      ON CONFLICT ("selectionId") DO UPDATE SET
        "cutoffAmount"    = EXCLUDED."cutoffAmount",
        "cutoffLastBidAt" = EXCLUDED."cutoffLastBidAt",
        "hasCutoffTie"    = EXCLUDED."hasCutoffTie",
        "updatedAt"       = now()
    `;
  }
}
