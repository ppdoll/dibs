import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  AuditAction,
  AuditTargetType,
  DepositStatus,
  SelectionRoundStatus,
  SelectionStatus,
} from '@prisma/client';
import { RANKABLE_STATUSES, formatKst } from '@dibs/shared';

import { PrismaService } from '../prisma/prisma.service';
import { assertAffected, assertVersionMatch } from '../common/db/assert-affected';
import { toCursorPage, type CursorPage } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { acquireAuditChainLock, appendAuditLog, eventChainKey, type Tx } from './internal/audit';
import { actorLabelOf, actorRoleOf, ownerScopeOf } from './internal/selection-context';
import { SELECTION_ENTRY_SELECT, type SelectionEntryRow } from './internal/selection-select';
import {
  AutoPreselectDto,
  LiveApplicantDto,
  LiveApplicantPageDto,
  LiveApplicantQueryDto,
  PartnerSelectionEntryDto,
  PartnerSelectionRoundDto,
  PromoteEntryDto,
  SelectionEntryQueryDto,
  SelectionOverrideDto,
  type LiveApplicantBucket,
} from './dto/selection.dto';

/** CSV 한 번에 내보내는 최대 행. 이보다 큰 라운드는 페이지 조회로 유도한다. */
const CSV_MAX_ROWS = 5_000;

/**
 * `allowSelectOverCapacity` 가 켜졌을 때의 상한.
 *
 * `Number.MAX_SAFE_INTEGER` 를 쓰지 않는 이유: 그 값은 int4 범위를 넘어 Postgres 가 파라미터 타입을
 * numeric/double 로 추론하게 만든다. int4 최대값이면 비교가 정수 그대로 끝나고, 어차피 정원이
 * 21억을 넘는 시설은 없다.
 */
const UNLIMITED_SEATS = 2_147_483_647;

/** 파트너가 명단을 만질 수 있는 라운드 상태. FINALIZED/CANCELED 에서는 아무것도 바꿀 수 없다. */
const EDITABLE_ROUND_STATUSES: readonly SelectionRoundStatus[] = [
  SelectionRoundStatus.RANKING_READY,
  SelectionRoundStatus.DRAFT,
  SelectionRoundStatus.REOPENED,
];

interface RoundContext {
  id: string;
  eventId: string;
  roundNo: number;
  status: SelectionRoundStatus;
  version: number;
  remainingSeats: number;
  requireReasonOnOverride: boolean;
  allowSelectOverCapacity: boolean;
  overCapacityTolerance: number;
  autoPreselectEnabled: boolean;
  eventTitle: string;
  partnerUserId: string;
}

/**
 * 파트너의 최종 명단 심사.
 *
 * 여기 있는 모든 응답에는 **금액과 순위가 그대로 들어 있다.** D-07 이 감추는 상대는 이용자이고,
 * 파트너와 운영자는 자기 이벤트의 금액·순위를 항상 전부 본다. 대신 그 대가로:
 *  - 이 서비스의 모든 쿼리는 `partnerId` 술어(또는 운영자)로 좁혀진다. 소유권 검사는 별도 SELECT 가
 *    아니라 **WHERE 절 안에** 있다 — 새 핸들러에서 그 SELECT 를 빠뜨리면 남의 명단이 열린다.
 *  - 커트라인은 `SelectionCutoff` 를 명시적으로 조인할 때만 붙는다(IC-35). `include` 로 딸려오는
 *    기본 경로가 없다는 것이 구조적 방어다.
 *
 * 동결 스냅샷(금액·시각·순위·정원포함여부)은 **절대 UPDATE 하지 않는다**(IC-34).
 * 여기서 바뀌는 것은 심사 상태(status/source/override 계열)뿐이고, 재계산이 필요하면
 * 라운드를 새로 연다. DB 트리거가 최종 방어선이지만 거기 걸리면 이미 코드가 잘못 짜인 것이다.
 */
@Injectable()
export class SelectionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 이벤트의 최신 라운드. 파트너 화면이 처음 여는 진입점이다. */
  async getLatestRoundByEvent(
    user: AuthenticatedUser,
    eventId: string,
  ): Promise<PartnerSelectionRoundDto> {
    const scope = ownerScopeOf(user);

    const round = await this.prisma.selection.findFirst({
      where: {
        eventId,
        event: { deletedAt: null, ...(scope ? { partnerId: scope } : {}) },
      },
      orderBy: { roundNo: 'desc' },
      select: { id: true },
    });

    if (!round) {
      throw new NotFoundException('아직 순위가 확정되지 않았습니다. 예약금 마감 이후에 열립니다.');
    }

    return this.getRound(user, round.id);
  }

  /**
   * ★ 진행 중 신청자 목록. "누가 얼마에 신청했는지"를 **마감 전에도** 보는 유일한 경로다.
   *
   * `getLatestRoundByEvent` 는 예약금 마감(`rankingLockAt`)이 지나 라운드가 열려야 응답한다.
   * 그 전까지 파트너는 자기 이벤트에 누가 얼마를 걸었는지 볼 방법이 없었다 — 요구사항에 있는
   * 화면인데 데이터로 가는 길이 없던 자리라 여기 하나를 낸다. 얼린 스냅샷(SelectionEntry)이
   * 아니라 살아 있는 `Application` 을 그대로 읽으므로, 응답은 **조회 시점의 사진**이다.
   *
   * 세 가지가 이 메서드의 전부다.
   *  1. 소유권 — `ownerScopeOf` 가 준 partnerId 를 **WHERE 절 안에** 넣는다. 별도 SELECT 로
   *     확인하지 않는다(selection-context 의 주석 참고). 아래 `requireOwnedEvent` 도 같은 술어를
   *     쓰지만 그건 404 문구와 요약 숫자를 만들기 위한 읽기일 뿐, 진짜 가드는 쿼리 WHERE 다.
   *  2. 정렬   — D-04 의 정렬 키를 **SQL 안에서** 매긴다. TS 정렬 금지(IC-31). `lastBidAt` 은
   *     Timestamptz(6) 인데 Prisma 가 밀리초로 깎아 주므로, 꺼내서 정렬하면 DB 가 구분하던 두
   *     입찰이 동점이 되고 화면 순서가 확정 순위와 갈린다.
   *  3. 자격   — `status IN ('VALID','CONFIRMED')` 다(IC-32). `= 'VALID'` 로 쓰면 INSTANT
   *     이벤트 목록이 통째로 빈다. 예약금 미납(`PENDING_DEPOSIT`)은 빼지 않고 순위 없는 행으로
   *     뒤에 붙인다 — 빼면 "신청 47명인데 39명만 보이는" 화면이 되고 아무도 이유를 모른다.
   *
   * ★ 여기 붙는 순위는 **잠정(provisional)** 이다. 상향 입찰(D-06)과 예약금 만료(D-05)로 마감까지
   * 계속 바뀐다. 이 사실은 DTO 설명과 화면 문구 양쪽에 적혀 있어야 한다 — 파트너가 이 숫자를
   * 신청자에게 알려주는 순간 D-07 이 깨지고, 그건 되돌릴 수 없다.
   */
  async listLiveApplicants(
    user: AuthenticatedUser,
    eventId: string,
    query: LiveApplicantQueryDto,
  ): Promise<LiveApplicantPageDto> {
    const scope = ownerScopeOf(user);
    const event = await this.requireOwnedEvent(user, eventId);

    const statuses = bucketStatuses(query.bucket);
    const cursorSeq = parseSeqCursor(query.cursor);

    const rows = await this.prisma.$queryRaw<LiveApplicantRow[]>`
      WITH live AS (
        SELECT
          a.id                      AS application_id,
          u."displayName"           AS display_name,
          a."amount"                AS amount,
          a."firstAppliedAt"        AS applied_at,
          a."lastBidAt"             AS last_bid_at,
          a.status::text            AS status,
          a."depositStatus"::text   AS deposit_status,
          a."depositPaidAmount"     AS deposit_paid,
          a."depositRequiredAmount" AS deposit_required,
          -- 목록 전체를 관통하는 일련번호. 커서가 이 값이다. 미납 묶음이 뒤로 가도록
          -- 불리언을 첫 정렬 키로 둔다 (Postgres 에서 false < true).
          ROW_NUMBER() OVER (
            ORDER BY (a.status = 'PENDING_DEPOSIT'),
                     a."amount" DESC, a."lastBidAt" ASC, a."applySeq" ASC
          ) AS seq,
          -- 잠정 순위는 순위 집계 대상에게만 매긴다. 미납자는 NULL 이다.
          CASE WHEN a.status <> 'PENDING_DEPOSIT' THEN
            ROW_NUMBER() OVER (
              PARTITION BY (a.status = 'PENDING_DEPOSIT')
              ORDER BY a."amount" DESC, a."lastBidAt" ASC, a."applySeq" ASC
            )
          END AS provisional_position
        FROM "Application" a
        JOIN "User"  u ON u.id = a."userId"
        JOIN "Event" e ON e.id = a."eventId"
        WHERE a."eventId" = ${eventId}
          AND e."deletedAt" IS NULL
          -- ★ 소유권. 운영자는 scope 가 null 이라 술어가 빠진다.
          AND (${scope}::text IS NULL OR e."partnerId" = ${scope}::text)
          AND a.status = ANY(${statuses}::"ApplicationStatus"[])
      )
      SELECT
        l.application_id  AS "applicationId",
        l.display_name    AS "displayName",
        l.amount          AS "amount",
        l.applied_at      AS "appliedAt",
        l.last_bid_at     AS "lastBidAt",
        l.status          AS "status",
        l.deposit_status  AS "depositStatus",
        l.deposit_paid    AS "depositPaid",
        l.deposit_required AS "depositRequired",
        l.seq::int                 AS "seq",
        l.provisional_position::int AS "provisionalPosition"
      FROM live l
      WHERE l.seq > ${cursorSeq}
      ORDER BY l.seq
      LIMIT ${query.limit + 1}
    `;

    const summary = await this.countLiveApplicants(eventId, scope);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      summary: {
        capacity: event.capacity,
        validCount: summary.validCount,
        pendingDepositCount: summary.pendingDepositCount,
        // 경쟁률은 표시용 파생값이라 TS 에서 만든다. IC-31 이 금지하는 것은 "정렬"이지 산술이 아니다.
        competitionRatioX10:
          event.capacity > 0 ? Math.round((summary.validCount * 10) / event.capacity) : null,
        eventStatus: event.status,
        applyEndAt: event.applyEndAt,
        rankingLockAt: event.rankingLockAt,
        rankingLocked: event.rankingLockAt !== null && event.rankingLockAt <= new Date(),
      },
      items: page.map(toLiveApplicantDto),
      hasMore,
      nextCursor: hasMore && last ? String(last.seq) : null,
    };
  }

  /**
   * 요약 숫자.
   *
   * 목록 쿼리에 window 집계로 얹지 않고 따로 세는 이유: 목록은 `bucket` 필터로 좁혀지는데
   * 요약은 언제나 **전체 기준**이어야 한다. 같은 쿼리에 얹으면 "예약금 미납만 보기"를 누른 순간
   * 유효 신청 수가 0으로 바뀐다.
   */
  private async countLiveApplicants(
    eventId: string,
    scope: string | null,
  ): Promise<{ validCount: number; pendingDepositCount: number }> {
    const rows = await this.prisma.$queryRaw<
      { validCount: number; pendingDepositCount: number }[]
    >`
      SELECT
        count(*) FILTER (WHERE a.status IN ('VALID','CONFIRMED'))::int AS "validCount",
        count(*) FILTER (WHERE a.status = 'PENDING_DEPOSIT')::int      AS "pendingDepositCount"
      FROM "Application" a
      JOIN "Event" e ON e.id = a."eventId"
      WHERE a."eventId" = ${eventId}
        AND e."deletedAt" IS NULL
        AND (${scope}::text IS NULL OR e."partnerId" = ${scope}::text)
    `;

    return rows[0] ?? { validCount: 0, pendingDepositCount: 0 };
  }

  /**
   * 이벤트 존재 + 소유 확인. 요약 블록에 쓸 정원·마감 시각을 함께 읽는다.
   *
   * `requireRound` 와 같은 이유로 둔다(IC-01): 목록 쿼리가 0행을 돌려줬을 때 "신청자가 없다"와
   * "남의 이벤트다"를 구별하지 못하면, 남의 eventId 를 찍어 넣은 파트너에게 빈 목록이 정상 응답으로
   * 나간다. 여기서 404 를 먼저 갈라 둔다.
   */
  private async requireOwnedEvent(
    user: AuthenticatedUser,
    eventId: string,
  ): Promise<{
    capacity: number;
    status: string;
    applyEndAt: Date;
    rankingLockAt: Date | null;
  }> {
    const scope = ownerScopeOf(user);

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, deletedAt: null, ...(scope ? { partnerId: scope } : {}) },
      select: { capacity: true, status: true, applyEndAt: true, rankingLockAt: true },
    });

    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    return event;
  }

  /**
   * 라운드 상세 + 커트라인.
   *
   * 커트라인을 여기서만 조인한다. `Event → selections` 를 타고 내려가는 공개 조회에는
   * 이 관계가 절대 따라붙지 않는다 — 커트라인 하나가 새면 그 이벤트의 모든 참가자가
   * 최소 낙찰가를 알게 되어 밀봉입찰이 공개입찰이 된다(D-07 이 감추는 숫자 중 가장 위험한 값).
   */
  async getRound(user: AuthenticatedUser, selectionId: string): Promise<PartnerSelectionRoundDto> {
    const scope = ownerScopeOf(user);

    const round = await this.prisma.selection.findFirst({
      where: { id: selectionId, event: { deletedAt: null, ...(scope ? { partnerId: scope } : {}) } },
      select: {
        id: true,
        eventId: true,
        roundNo: true,
        status: true,
        capacitySnapshot: true,
        remainingSeats: true,
        eligibleCount: true,
        excludedCount: true,
        selectedCount: true,
        rankingComputedAt: true,
        rankingSnapshotHash: true,
        finalizedAt: true,
        version: true,
        cutoff: { select: { cutoffAmount: true, cutoffLastBidAt: true, hasCutoffTie: true } },
      },
    });

    if (!round) throw new NotFoundException('선정 라운드를 찾을 수 없습니다.');

    const preselected = await this.prisma.selectionEntry.count({
      where: { selectionId, status: SelectionStatus.PRESELECTED },
    });

    return {
      id: round.id,
      eventId: round.eventId,
      roundNo: round.roundNo,
      status: round.status,
      capacitySnapshot: round.capacitySnapshot,
      remainingSeats: round.remainingSeats,
      eligibleCount: round.eligibleCount,
      excludedCount: round.excludedCount,
      preselectedCount: preselected,
      selectedCount: round.selectedCount,
      rankingComputedAt: round.rankingComputedAt,
      rankingSnapshotHash: round.rankingSnapshotHash,
      finalizedAt: round.finalizedAt,
      version: round.version,
      cutoff: round.cutoff
        ? {
            amount: round.cutoff.cutoffAmount,
            lastBidAt: round.cutoff.cutoffLastBidAt,
            hasTie: round.cutoff.hasCutoffTie,
          }
        : null,
    };
  }

  /**
   * 순위순 후보 목록.
   *
   * 정렬은 `rankNo` 오름차순이고 제외된 후보(rankNo = NULL)는 뒤로 몰린다(Postgres 의 ASC 기본이
   * NULLS LAST 다). 커서는 `id` 지만 정렬은 순위 — Prisma 의 커서 페이지네이션은 커서 컬럼이
   * 유니크하기만 하면 임의 정렬과 함께 쓸 수 있으므로, 공통 `toCursorPage` 를 그대로 재사용한다.
   */
  async listEntries(
    user: AuthenticatedUser,
    selectionId: string,
    query: SelectionEntryQueryDto,
  ): Promise<CursorPage<PartnerSelectionEntryDto>> {
    await this.requireRound(user, selectionId);

    const rows = await this.prisma.selectionEntry.findMany({
      where: {
        selectionId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.eligibleOnly ? { isEligible: true } : {}),
      },
      orderBy: [{ rankNo: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: SELECTION_ENTRY_SELECT,
    });

    return toCursorPage(rows.map(toEntryDto), query.limit);
  }

  /**
   * 명단 CSV.
   *
   * BOM 을 앞에 붙이는 이유는 엑셀이다 — 없으면 한글 이름이 전부 깨지고, 파트너는 그걸
   * "서버가 이름을 잘못 저장했다"로 읽는다. 줄바꿈이 CRLF 인 것도 같은 이유다.
   */
  async exportCsv(user: AuthenticatedUser, selectionId: string): Promise<string> {
    const round = await this.requireRound(user, selectionId);

    const rows = await this.prisma.selectionEntry.findMany({
      where: { selectionId },
      orderBy: [{ rankNo: 'asc' }, { id: 'asc' }],
      take: CSV_MAX_ROWS,
      select: SELECTION_ENTRY_SELECT,
    });

    const header = [
      '순위',
      '이름',
      '신청금액',
      '금액도달시각(KST)',
      '최초신청시각(KST)',
      '재입찰횟수',
      '예약금상태',
      '납부액',
      '정원내',
      '심사상태',
      '반영경로',
      '제외사유',
    ];

    const lines = [header, ...rows.map((row) => csvRow(row))]
      .map((cells) => cells.map(csvCell).join(','))
      .join('\r\n');

    return `﻿${round.eventTitle} — ${round.roundNo}라운드\r\n${lines}\r\n`;
  }

  /**
   * 상위 N명 자동 예비선정.
   *
   * 조건부 UPDATE 하나다. "지금 몇 명이 뽑혀 있는지"를 읽어서 판단하지 않는다 —
   * 파트너가 두 탭에서 동시에 누르면 두 문장 사이가 통째로 경합 창이고, 정원이 조용히 두 배가 된다.
   */
  async autoPreselect(
    user: AuthenticatedUser,
    selectionId: string,
    ifMatchVersion: number,
    dto: AutoPreselectDto,
  ): Promise<PartnerSelectionRoundDto> {
    const round = await this.requireRound(user, selectionId);
    this.assertEditable(round);

    const limit = Math.min(dto.topN ?? round.remainingSeats, this.seatCeiling(round));

    await this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, eventChainKey(round.eventId));

      const affected = await tx.$executeRaw`
        UPDATE "SelectionEntry" se SET
          status              = 'PRESELECTED'::"SelectionStatus",
          "preselectedAt"     = COALESCE(se."preselectedAt", now()),
          source              = 'AUTO_RANK'::"SelectionEntrySource",
          "amountAtSelection" = se."amountSnapshot",
          "version"           = se."version" + 1,
          "updatedAt"         = now()
        WHERE se."selectionId" = ${selectionId}
          AND se."isEligible" = true
          AND se."rankNo" IS NOT NULL
          AND se."rankNo" <= ${limit}
          AND se.status = 'CANDIDATE'
          -- 라운드 상태와 낙관적 락 토큰까지 같은 문장 안에서 본다. 밖에서 확인하면
          -- 그 사이에 다른 탭이 확정을 눌러버릴 수 있다.
          AND EXISTS (
            SELECT 1 FROM "Selection" s
            WHERE s.id = ${selectionId}
              AND s."version" = ${ifMatchVersion}
              AND s."autoPreselectEnabled" = true
              AND s.status IN ('RANKING_READY','DRAFT','REOPENED')
          )
      `;

      const bumped = await tx.$executeRaw`
        UPDATE "Selection" s SET
          status                 = 'DRAFT'::"SelectionRoundStatus",
          "autoPreselectedCount" = (
            SELECT count(*)::int FROM "SelectionEntry" e
            WHERE e."selectionId" = s.id AND e.status = 'PRESELECTED'
          ),
          "version"              = s."version" + 1,
          "updatedAt"            = now()
        WHERE s.id = ${selectionId}
          AND s."version" = ${ifMatchVersion}
          AND s."autoPreselectEnabled" = true
          AND s.status IN ('RANKING_READY','DRAFT','REOPENED')
      `;

      assertVersionMatch(bumped, 'SELECTION_VERSION_MISMATCH');

      await appendAuditLog(tx, {
        actorUserId: user.id,
        actorRole: actorRoleOf(user),
        actorLabel: actorLabelOf(user),
        action: AuditAction.PARTNER_FINAL_LIST_EDITED,
        targetType: AuditTargetType.SELECTION,
        targetId: selectionId,
        targetOwnerUserId: round.partnerUserId,
        chainKey: eventChainKey(round.eventId),
        summary: `자동 예비선정 상위 ${limit}명 — ${affected}건 반영`,
        afterJson: { topN: limit, affected },
      });
    });

    return this.getRound(user, selectionId);
  }

  /**
   * 순위 밖 후보를 명단에 넣는다. (SelectionEntrySource.PARTNER_ADD)
   *
   * 정원 상한을 WHERE 절의 서브쿼리로 센다. 파트너가 `allowSelectOverCapacity` 를 켜지 않았다면
   * 정원 + `overCapacityTolerance` 를 넘는 순간 0행이 되고 409 가 나간다 — "일단 넣고 나중에 줄이자"가
   * 되지 않게 하는 게 목적이다. 넘겨받은 자리는 결국 시설의 물리적 수용량이다.
   */
  addEntry(
    user: AuthenticatedUser,
    selectionId: string,
    entryId: string,
    ifMatchVersion: number,
    dto: SelectionOverrideDto,
  ): Promise<PartnerSelectionRoundDto> {
    return this.override(user, selectionId, entryId, ifMatchVersion, dto, {
      action: AuditAction.PARTNER_SELECTION_OVERRIDE,
      label: '수동 추가',
      run: async (tx, ctx) => {
        const ceiling = this.seatCeiling(ctx.round);

        return tx.$executeRaw`
          UPDATE "SelectionEntry" se SET
            status               = 'PRESELECTED'::"SelectionStatus",
            "preselectedAt"      = COALESCE(se."preselectedAt", now()),
            source               = 'PARTNER_ADD'::"SelectionEntrySource",
            "amountAtSelection"  = se."amountSnapshot",
            "isOverride"         = true,
            "overrideReason"     = ${ctx.reason},
            "overriddenByUserId" = ${user.id},
            "overriddenAt"       = now(),
            "version"            = se."version" + 1,
            "updatedAt"          = now()
          WHERE se.id = ${entryId}
            AND se."selectionId" = ${selectionId}
            AND se."isEligible" = true
            AND se.status IN ('CANDIDATE','WAITING','NOT_SELECTED')
            AND (
              SELECT count(*) FROM "SelectionEntry" x
              WHERE x."selectionId" = ${selectionId}
                AND x.status IN ('PRESELECTED','SELECTED')
            ) < ${ceiling}
        `;
      },
    });
  }

  /**
   * 명단에서 뺀다. (SelectionEntrySource.PARTNER_REMOVE)
   *
   * 확정 전이면 그냥 NOT_SELECTED 지만, 확정 후에 빼는 것은 **이미 통보된 선정을 되돌리는 것**이라
   * REVOKED 로 구분하고 취소 주체·사유를 남긴다. 두 상태를 합치면 나중에 "이 사람은 애초에 안 뽑힌
   * 건가, 뽑혔다가 취소된 건가"를 구별할 수 없고, 그 차이가 곧 환불과 민원의 차이다.
   */
  removeEntry(
    user: AuthenticatedUser,
    selectionId: string,
    entryId: string,
    ifMatchVersion: number,
    dto: SelectionOverrideDto,
  ): Promise<PartnerSelectionRoundDto> {
    return this.override(user, selectionId, entryId, ifMatchVersion, dto, {
      action: AuditAction.PARTNER_APPLICANT_REMOVED,
      label: '수동 제외',
      run: async (tx, ctx) =>
        tx.$executeRaw`
          UPDATE "SelectionEntry" se SET
            status = CASE WHEN se.status = 'SELECTED'
                          THEN 'REVOKED'::"SelectionStatus"
                          ELSE 'NOT_SELECTED'::"SelectionStatus" END,
            source               = 'PARTNER_REMOVE'::"SelectionEntrySource",
            "isOverride"         = true,
            "overrideReason"     = ${ctx.reason},
            "overriddenByUserId" = ${user.id},
            "overriddenAt"       = now(),
            "revokedAt"    = CASE WHEN se.status = 'SELECTED' THEN now() ELSE se."revokedAt" END,
            "revokeReason" = CASE WHEN se.status = 'SELECTED'
                                  THEN 'PARTNER_REMOVED'::"SelectionRevokeReason"
                                  ELSE se."revokeReason" END,
            "revokedByRole" = CASE WHEN se.status = 'SELECTED'
                                   THEN 'PARTNER'::"CoreActorType"
                                   ELSE se."revokedByRole" END,
            "version"   = se."version" + 1,
            "updatedAt" = now()
          WHERE se.id = ${entryId}
            AND se."selectionId" = ${selectionId}
            AND se.status IN ('PRESELECTED','SELECTED')
        `,
    });
  }

  /**
   * 결원 승계. (SelectionEntrySource.PARTNER_PROMOTE)
   *
   * 누구의 자리를 물려받았는지 `promotedFromEntryId` 로 남긴다. 이 링크가 없으면 정원이 맞는데도
   * "왜 정원 밖 사람이 들어왔는가"를 설명할 수 없다 — 승계는 파트너의 재량이 아니라 결원의 결과여야 하므로,
   * 근거가 될 엔트리가 실제로 빠져 있는지를 WHERE 절에서 확인한다(IC-66 과 같은 사고방식이다).
   */
  promoteEntry(
    user: AuthenticatedUser,
    selectionId: string,
    entryId: string,
    ifMatchVersion: number,
    dto: PromoteEntryDto,
  ): Promise<PartnerSelectionRoundDto> {
    return this.override(user, selectionId, entryId, ifMatchVersion, dto, {
      action: AuditAction.PARTNER_SELECTION_OVERRIDE,
      label: `결원 승계(from=${dto.fromEntryId})`,
      run: async (tx, ctx) =>
        tx.$executeRaw`
          UPDATE "SelectionEntry" se SET
            status                = 'PRESELECTED'::"SelectionStatus",
            "preselectedAt"       = COALESCE(se."preselectedAt", now()),
            source                = 'PARTNER_PROMOTE'::"SelectionEntrySource",
            "amountAtSelection"   = se."amountSnapshot",
            "promotedFromEntryId" = ${dto.fromEntryId},
            "isOverride"          = true,
            "overrideReason"      = ${ctx.reason},
            "overriddenByUserId"  = ${user.id},
            "overriddenAt"        = now(),
            "version"             = se."version" + 1,
            "updatedAt"           = now()
          WHERE se.id = ${entryId}
            AND se."selectionId" = ${selectionId}
            AND se."isEligible" = true
            AND se.status IN ('CANDIDATE','WAITING','NOT_SELECTED')
            AND EXISTS (
              SELECT 1 FROM "SelectionEntry" v
              WHERE v.id = ${dto.fromEntryId}
                AND v."selectionId" = ${selectionId}
                AND v.status IN ('REVOKED','NOT_SELECTED')
            )
        `,
    });
  }

  /**
   * 수동 조정 3종의 공통 뼈대.
   *
   * 락 순서(IC-02)를 지키기 위해 감사 체인 자문 락이 **트랜잭션의 첫 문장**이다. 그래서 체인 키에
   * 필요한 eventId 만 트랜잭션 밖에서 미리 읽는다 — 그 읽기는 문구와 체인 키를 위한 것이고,
   * 진짜 가드는 전부 UPDATE 의 WHERE 절 안에 있다.
   */
  private async override(
    user: AuthenticatedUser,
    selectionId: string,
    entryId: string,
    ifMatchVersion: number,
    dto: SelectionOverrideDto,
    op: {
      action: AuditAction;
      label: string;
      run: (
        tx: Tx,
        ctx: { round: RoundContext; reason: string | null },
      ) => Promise<number>;
    },
  ): Promise<PartnerSelectionRoundDto> {
    const round = await this.requireRound(user, selectionId);
    this.assertEditable(round);

    const reason = dto.reason?.trim() ? dto.reason.trim() : null;

    if (round.requireReasonOnOverride && !reason) {
      // 사유 없는 조정은 민원이 들어왔을 때 운영자가 설명할 수 없는 상태다.
      throw new BadRequestException({
        code: 'SELECTION_OVERRIDE_REASON_REQUIRED',
        message: '이 라운드는 수동 조정 시 사유를 반드시 남기도록 설정돼 있습니다.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, eventChainKey(round.eventId));

      const affected = await op.run(tx, { round, reason });
      assertAffected(affected, 1, 'SELECTION_ENTRY_STATE_CHANGED');

      const bumped = await tx.$executeRaw`
        UPDATE "Selection" s SET
          status          = 'DRAFT'::"SelectionRoundStatus",
          "overrideCount" = s."overrideCount" + 1,
          "version"       = s."version" + 1,
          "updatedAt"     = now()
        WHERE s.id = ${selectionId}
          AND s."version" = ${ifMatchVersion}
          AND s.status IN ('RANKING_READY','DRAFT','REOPENED')
      `;

      assertVersionMatch(bumped, 'SELECTION_VERSION_MISMATCH');

      await appendAuditLog(tx, {
        actorUserId: user.id,
        actorRole: actorRoleOf(user),
        actorLabel: actorLabelOf(user),
        action: op.action,
        targetType: AuditTargetType.SELECTION_ENTRY,
        targetId: entryId,
        targetOwnerUserId: round.partnerUserId,
        chainKey: eventChainKey(round.eventId),
        summary: `${op.label} — 라운드 ${round.roundNo}, 엔트리 ${entryId}`.slice(0, 500),
        reasonMemo: reason,
        afterJson: { selectionId, entryId, action: op.action },
      });
    });

    return this.getRound(user, selectionId);
  }

  /**
   * 소유권 + 존재 확인. 감사 체인 키와 오류 문구를 만들기 위한 읽기다.
   *
   * 조건부 UPDATE 의 0행은 "없는 행"이 아니라 "전제가 깨졌다"라서 409 로 올라간다(IC-01).
   * 그런데 파트너가 남의 selectionId 를 넣으면 그 409 는 "이미 처리됨"이라고 거짓말을 한다.
   * 존재·소유를 먼저 갈라두면 404 와 409 가 각각 맞는 뜻을 갖는다.
   */
  private async requireRound(
    user: AuthenticatedUser,
    selectionId: string,
  ): Promise<RoundContext> {
    const scope = ownerScopeOf(user);

    const round = await this.prisma.selection.findFirst({
      where: { id: selectionId, event: { deletedAt: null, ...(scope ? { partnerId: scope } : {}) } },
      select: {
        id: true,
        eventId: true,
        roundNo: true,
        status: true,
        version: true,
        remainingSeats: true,
        requireReasonOnOverride: true,
        allowSelectOverCapacity: true,
        overCapacityTolerance: true,
        autoPreselectEnabled: true,
        event: { select: { title: true, partner: { select: { userId: true } } } },
      },
    });

    if (!round) throw new NotFoundException('선정 라운드를 찾을 수 없습니다.');

    return {
      id: round.id,
      eventId: round.eventId,
      roundNo: round.roundNo,
      status: round.status,
      version: round.version,
      remainingSeats: round.remainingSeats,
      requireReasonOnOverride: round.requireReasonOnOverride,
      allowSelectOverCapacity: round.allowSelectOverCapacity,
      overCapacityTolerance: round.overCapacityTolerance,
      autoPreselectEnabled: round.autoPreselectEnabled,
      eventTitle: round.event.title,
      partnerUserId: round.event.partner.userId,
    };
  }

  private assertEditable(round: RoundContext): void {
    if (!EDITABLE_ROUND_STATUSES.includes(round.status)) {
      throw new BadRequestException({
        code: 'SELECTION_ROUND_NOT_EDITABLE',
        message:
          round.status === SelectionRoundStatus.FINALIZED
            ? '이미 확정된 라운드입니다. 결원 보충은 새 라운드를 열어 진행합니다.'
            : '지금은 명단을 수정할 수 없는 라운드 상태입니다.',
      });
    }
  }

  /**
   * 이 라운드가 담을 수 있는 최대 인원.
   *
   * D-03 이 신청 단계의 정원 강제를 포기했으므로 소폭 초과는 여기서 파트너가 조정한다.
   * 무제한을 허용하는 것은 파트너가 명시적으로 켰을 때뿐이다.
   */
  private seatCeiling(round: RoundContext): number {
    return round.allowSelectOverCapacity
      ? UNLIMITED_SEATS
      : round.remainingSeats + round.overCapacityTolerance;
  }
}

/** `listLiveApplicants` 의 raw 행. 별칭을 그대로 받는다. */
interface LiveApplicantRow {
  applicationId: string;
  displayName: string;
  amount: number;
  appliedAt: Date;
  lastBidAt: Date;
  status: string;
  depositStatus: string;
  depositPaid: number;
  depositRequired: number;
  seq: number;
  provisionalPosition: number | null;
}

/**
 * `bucket` 필터를 신청 상태 집합으로 바꾼다.
 *
 * 비우면 순위 대상 + 미납을 함께 본다. 여기서 만들어지는 배열이 곧 목록의 모집단이고,
 * `RANKABLE_STATUSES` 를 손으로 다시 적지 않는 이유는 IC-32 다 — `['VALID']` 로 잘못 적으면
 * INSTANT 이벤트 목록이 조용히 빈다.
 */
function bucketStatuses(bucket: LiveApplicantBucket | undefined): ApplicationStatus[] {
  const rankable = [...RANKABLE_STATUSES] as ApplicationStatus[];

  if (bucket === 'RANKED') return rankable;
  if (bucket === 'PENDING_DEPOSIT') return [ApplicationStatus.PENDING_DEPOSIT];

  return [...rankable, ApplicationStatus.PENDING_DEPOSIT];
}

/**
 * 커서 → 일련번호.
 *
 * 형식이 깨진 커서는 400 이 아니라 "처음부터"로 흘린다. 목록 조회는 읽기 전용이고, 링크를
 * 잘못 복사한 파트너에게 오류 화면을 보여주는 것보다 1페이지를 보여주는 편이 낫다.
 */
function parseSeqCursor(cursor: string | undefined): number {
  const parsed = Number(cursor);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * raw 행 → 응답 DTO.
 *
 * 이름을 마스킹하는 이유: 이 목록은 이벤트가 **열려 있는 동안** 계속 열어 두고 보는 화면이다.
 * 실명 전체가 필요한 순간은 명단을 확정할 때(엔트리 목록·CSV)이지 관전할 때가 아니라,
 * 노출을 그 순간까지 미룬다. 금액과 잠정 순위는 그대로 보여준다 — 파트너는 자기 이벤트의
 * 금액·순위를 항상 전부 본다(D-07 이 감추는 상대는 이용자다).
 */
function toLiveApplicantDto(row: LiveApplicantRow): LiveApplicantDto {
  return {
    applicationId: row.applicationId,
    displayName: maskDisplayName(row.displayName),
    amount: row.amount,
    appliedAt: row.appliedAt,
    lastBidAt: row.lastBidAt,
    status: row.status as ApplicationStatus,
    depositStatus: row.depositStatus as DepositStatus,
    depositPaid: row.depositPaid,
    depositRequired: row.depositRequired,
    // 예약금이 필요 없는 이벤트(required=0)는 "완납"으로 본다 — 그게 곧 유효 신청이다(D-05).
    depositSettled: row.depositPaid >= row.depositRequired,
    provisionalPosition: row.provisionalPosition,
  };
}

/** 홍길동 → 홍*동. 웹의 `maskName` 과 규칙을 맞춘다. */
function maskDisplayName(name: string): string {
  if (name.length === 0) return '-';
  if (name.length === 1) return name;
  if (name.length === 2) return `${name.slice(0, 1)}*`;

  return `${name.slice(0, 1)}${'*'.repeat(name.length - 2)}${name.slice(-1)}`;
}

/** 스냅샷 컬럼의 `*Snapshot` 접미사를 화면 어휘로 바꾼다. 값은 그대로다. */
function toEntryDto(row: SelectionEntryRow): PartnerSelectionEntryDto {
  return {
    id: row.id,
    applicationId: row.applicationId,
    userId: row.userId,
    displayName: row.displayNameSnapshot,
    rankNo: row.rankNo,
    amount: row.amountSnapshot,
    lastBidAt: row.lastBidAtSnapshot,
    appliedAt: row.appliedAtSnapshot,
    rebidCount: row.rebidCountSnapshot,
    depositStatus: row.depositStatusSnapshot,
    depositPaid: row.depositPaidSnapshot,
    withinCapacity: row.withinCapacity,
    isEligible: row.isEligible,
    exclusionReason: row.exclusionReason,
    status: row.status,
    source: row.source,
    isOverride: row.isOverride,
    tieGroupKey: row.tieGroupKey,
    tieOrdinal: row.tieOrdinal,
    version: row.version,
  };
}

function csvRow(row: SelectionEntryRow): string[] {
  return [
    row.rankNo === null ? '-' : String(row.rankNo),
    row.displayNameSnapshot,
    String(row.amountSnapshot),
    formatKst(row.lastBidAtSnapshot),
    formatKst(row.appliedAtSnapshot),
    String(row.rebidCountSnapshot),
    row.depositStatusSnapshot,
    String(row.depositPaidSnapshot),
    row.withinCapacity ? 'Y' : 'N',
    row.status,
    row.source,
    row.exclusionReason ?? '',
  ];
}

/**
 * CSV 셀 이스케이프.
 *
 * 앞에 `=`, `+`, `-`, `@` 가 오면 엑셀이 수식으로 해석한다(CSV injection). 이름은 사용자가 정하는
 * 값이라 여기서 막지 않으면 파트너의 엑셀에서 임의 수식이 실행된다.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
