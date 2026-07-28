import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, SelectionRoundStatus } from '@prisma/client';
import { assertNoVisibilityLeak } from '@dibs/shared';

import { PrismaService } from '../prisma/prisma.service';
import { assertVersionMatch } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { acquireAuditChainLock, appendAuditLog, eventChainKey, type Tx } from './internal/audit';
import { actorLabelOf, actorRoleOf, ownerScopeOf } from './internal/selection-context';
import { FinalizeSelectionDto } from './dto/selection.dto';

export interface FinalizeResult {
  selectionId: string;
  eventId: string;
  roundNo: number;
  selectedCount: number;
  notSelectedCount: number;
  refundSignaled: number;
  notified: number;
  version: number;
}

/**
 * 명단 확정.
 *
 * 이 트랜잭션이 하는 일은 되돌릴 수 없다: 신청 상태가 종결되고, 비선정자 예약금이 환불 큐에 오르고,
 * 전원에게 결과 알림이 나간다. 그래서 전부 **한 트랜잭션**이다 — 알림만 나가고 상태가 롤백되거나,
 * 상태만 바뀌고 알림이 안 나가는 상태가 영구히 남으면 그게 이 도메인에서 가장 나쁜 실패 모드다(IC-42).
 *
 * 락 순서(IC-02): 자문 락 → Event → Selection → SelectionEntry → Application → Deposit.
 * 표준 순서에서 SelectionEntry 를 Application 앞으로 당긴 이유는 **파생 관계** 때문이다 —
 * 신청의 최종 상태는 엔트리의 최종 상태에서 나오므로 엔트리를 먼저 확정해야 한다.
 * 순서를 당겨도 사이클이 생기지 않는 근거: SelectionEntry 에 쓰는 경로는 이 모듈뿐이고
 * 전부 같은 이벤트 자문 락을 **첫 문장**으로 잡는다. 즉 엔트리 락은 이미 직렬화돼 있다.
 */
@Injectable()
export class SelectionFinalizeService {
  private readonly logger = new Logger(SelectionFinalizeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async finalize(
    user: AuthenticatedUser,
    selectionId: string,
    ifMatchVersion: number,
    dto: FinalizeSelectionDto,
  ): Promise<FinalizeResult> {
    const scope = ownerScopeOf(user);

    // 체인 키(eventId)와 알림 문구(title)를 위한 읽기다. 진짜 가드는 전부 아래 WHERE 절 안에 있다.
    const round = await this.prisma.selection.findFirst({
      where: { id: selectionId, event: { deletedAt: null, ...(scope ? { partnerId: scope } : {}) } },
      select: {
        id: true,
        eventId: true,
        roundNo: true,
        event: { select: { title: true, partner: { select: { userId: true } } } },
      },
    });

    if (!round) throw new NotFoundException('선정 라운드를 찾을 수 없습니다.');

    return this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, eventChainKey(round.eventId));

      await this.finalizeEvent(tx, round.eventId);

      const finalized = await tx.$executeRaw`
        UPDATE "Selection" s SET
          status              = 'FINALIZED'::"SelectionRoundStatus",
          "finalizedAt"       = now(),
          "finalizedByUserId" = ${user.id},
          "partnerMemo"       = COALESCE(${dto.memo ?? null}::text, s."partnerMemo"),
          "version"           = s."version" + 1,
          "updatedAt"         = now()
        WHERE s.id = ${selectionId}
          AND s."version" = ${ifMatchVersion}
          AND s.status IN ('RANKING_READY','DRAFT','REOPENED')
      `;

      assertVersionMatch(finalized, 'SELECTION_VERSION_MISMATCH');

      const selectedCount = await this.promoteSelected(tx, selectionId);
      const notSelectedCount = await this.rejectRemaining(tx, selectionId);
      await this.settleApplications(tx, selectionId);
      const refundSignaled = await this.signalRefunds(tx, selectionId);
      const notified = await this.enqueueResultNotifications(
        tx,
        selectionId,
        round.eventId,
        round.event.title,
      );

      const version = await this.closeRound(tx, selectionId);

      await appendAuditLog(tx, {
        actorUserId: user.id,
        actorRole: actorRoleOf(user),
        actorLabel: actorLabelOf(user),
        action: AuditAction.PARTNER_FINAL_LIST_EDITED,
        targetType: AuditTargetType.SELECTION,
        targetId: selectionId,
        targetOwnerUserId: round.event.partner.userId,
        chainKey: eventChainKey(round.eventId),
        // 엔트리마다 감사 행을 쓰지 않는다 — 200명짜리 라운드면 자문 락을 200배 오래 든다(IC-61).
        summary:
          `명단 확정 라운드 ${round.roundNo} — 선정 ${selectedCount}명, ` +
          `비선정 ${notSelectedCount}명, 환불 예약 ${refundSignaled}건, 알림 ${notified}건`,
        reasonMemo: dto.memo ?? null,
        afterJson: { selectionId, selectedCount, notSelectedCount, refundSignaled },
        idempotencyKey: `selection-finalize:${selectionId}`,
      });

      this.logger.log(
        `선정 확정 selectionId=${selectionId} 선정=${selectedCount} 비선정=${notSelectedCount}`,
      );

      return {
        selectionId,
        eventId: round.eventId,
        roundNo: round.roundNo,
        selectedCount,
        notSelectedCount,
        refundSignaled,
        notified,
        version,
      };
    });
  }

  /**
   * 이벤트를 FINALIZED 로 올린다.
   *
   * 0행이어도 오류가 아니다 — 결원 보충 라운드(roundNo≥2)를 확정할 때 이벤트는 이미 FINALIZED 다.
   * 그래서 여기만 assert 를 걸지 않는다.
   */
  private async finalizeEvent(tx: Tx, eventId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Event" e SET
        status        = 'FINALIZED'::"EventStatus",
        "finalizedAt" = COALESCE(e."finalizedAt", now()),
        "version"     = e."version" + 1,
        "updatedAt"   = now()
      WHERE e.id = ${eventId}
        AND e."deletedAt" IS NULL
        AND e.status = 'CLOSED'
    `;
  }

  /** 예비선정 → 선정. 스냅샷은 건드리지 않는다(IC-34) — 바뀌는 건 심사 상태뿐이다. */
  private promoteSelected(tx: Tx, selectionId: string): Promise<number> {
    return tx.$executeRaw`
      UPDATE "SelectionEntry" se SET
        status              = 'SELECTED'::"SelectionStatus",
        "selectedAt"        = now(),
        "amountAtSelection" = COALESCE(se."amountAtSelection", se."amountSnapshot"),
        "version"           = se."version" + 1,
        "updatedAt"         = now()
      WHERE se."selectionId" = ${selectionId}
        AND se.status = 'PRESELECTED'
        AND se."isEligible" = true
    `;
  }

  /** 남은 후보와 제외자는 전부 비선정으로 닫는다. 애매한 상태로 남기면 환불 큐가 대상을 못 찾는다. */
  private rejectRemaining(tx: Tx, selectionId: string): Promise<number> {
    return tx.$executeRaw`
      UPDATE "SelectionEntry" se SET
        status      = 'NOT_SELECTED'::"SelectionStatus",
        "version"   = se."version" + 1,
        "updatedAt" = now()
      WHERE se."selectionId" = ${selectionId}
        AND se.status IN ('CANDIDATE','WAITING')
    `;
  }

  /**
   * 엔트리의 결론을 신청에 반영한다.
   *
   * 선정 → CONFIRMED, 비선정·취소 → NOT_SELECTED. 다른 애그리게이트지만 서비스를 주입하지 않고
   * 같은 트랜잭션의 SQL 로만 닿는다. 커밋이 갈리면 "선정됐는데 신청은 아직 VALID" 같은 상태가 남고,
   * 그 상태에서는 환불 큐도 정산도 대상을 정할 수 없다.
   */
  private async settleApplications(tx: Tx, selectionId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Application" a SET
        status        = 'CONFIRMED'::"ApplicationStatus",
        "confirmedAt" = COALESCE(a."confirmedAt", now()),
        "version"     = a."version" + 1,
        "updatedAt"   = now()
      FROM "SelectionEntry" se
      WHERE se."selectionId" = ${selectionId}
        AND se.status = 'SELECTED'
        AND a.id = se."applicationId"
        AND a.status IN ('VALID','CONFIRMED')
    `;

    await tx.$executeRaw`
      UPDATE "Application" a SET
        status      = 'NOT_SELECTED'::"ApplicationStatus",
        "version"   = a."version" + 1,
        "updatedAt" = now()
      FROM "SelectionEntry" se
      WHERE se."selectionId" = ${selectionId}
        AND se.status IN ('NOT_SELECTED','REVOKED')
        AND a.id = se."applicationId"
        AND a.status IN ('VALID','CONFIRMED')
    `;
  }

  /**
   * 비선정자 예약금을 환불 큐에 올린다. (D-05)
   *
   * ★ 실제 송금은 여기서 하지 않는다 — PG 연동은 D-05 가 명시적으로 후속 단계로 미뤘고,
   * 트랜잭션 안에서 외부 API 를 부르면 커밋이 실패해도 돈은 이미 나간다(IC-42).
   * 여기서는 상태 전이만 만들고 `deposit_refund_queue_idx` 가 집어갈 수 있게 표시한다.
   * 실제 환불 실행기는 `refundStatus='REQUESTED'` 를 읽어 `refundIdempotencyKey` 로 중복을 막는다.
   *
   * `status` 를 PAID 로 남겨두는 이유: 그 컬럼은 "홀드가 어떻게 끝났나"이고 환불은 별도 축이다.
   * 둘을 한 컬럼에 섞으면 "환불 요청 중인데 완납이었던 홀드"를 표현할 수 없다.
   */
  private async signalRefunds(tx: Tx, selectionId: string): Promise<number> {
    const affected = await tx.$executeRaw`
      UPDATE "Deposit" d SET
        "refundStatus"         = 'REQUESTED'::"DepositRefundStatus",
        "refundReason"         = 'NOT_SELECTED'::"DepositRefundReason",
        "refundRequestedAt"    = now(),
        "refundAmount"         = d."amountPaid",
        "refundIdempotencyKey" = 'refund:' || d.id || ':NOT_SELECTED',
        "updatedAt"            = now()
      FROM "SelectionEntry" se
      WHERE se."selectionId" = ${selectionId}
        AND se.status IN ('NOT_SELECTED','REVOKED')
        AND d."applicationId" = se."applicationId"
        AND d.status = 'PAID'
        AND d."amountPaid" > 0
        AND d."refundStatus" IS NULL
    `;

    await tx.$executeRaw`
      UPDATE "SelectionEntry" se SET
        "refundSignaledAt" = now(),
        "updatedAt"        = now()
      WHERE se."selectionId" = ${selectionId}
        AND se.status IN ('NOT_SELECTED','REVOKED')
        AND se."refundSignaledAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "Deposit" d
          WHERE d."applicationId" = se."applicationId" AND d."refundStatus" = 'REQUESTED'
        )
    `;

    return affected;
  }

  /**
   * 결과 알림을 아웃박스로 넣는다. (IC-42 / IC-44)
   *
   * ★ 문구에 커트라인도, 누구의 금액도, 본인 순위도 들어가지 않는다(D-07).
   * "8만원에 밀리셨습니다"는 커트라인을 그대로 알려주는 것과 같고, "42등이었습니다"는 밀봉입찰을
   * 사후에 공개입찰로 만든다. 그래서 payload 를 만들 때 D-07 스캐너를 통과시킨다.
   *
   * INSERT ... SELECT 로 DB 안에서 팬아웃한다 — 수신자 목록을 애플리케이션으로 꺼내면 함수 메모리와
   * 트랜잭션 시간이 인원 수에 비례해 늘어난다. `ON CONFLICT DO NOTHING` 은 IC-41 의 skipDuplicates 와
   * 같은 뜻이다: 중복 알림 하나 때문에 명단 확정 자체가 롤백되면 우선순위가 완전히 뒤바뀐 것이다.
   */
  private async enqueueResultNotifications(
    tx: Tx,
    selectionId: string,
    eventId: string,
    title: string,
  ): Promise<number> {
    const payload = { eventId, eventTitle: title };
    assertNoVisibilityLeak(payload, 'SELECTION_FINALIZED 알림 payload');

    const selectedTitle = '선정되셨습니다';
    const selectedBody = `'${title}' 예약이 확정되었습니다. 상세 내용을 확인해 주세요.`;
    const rejectedTitle = '이번에는 선정되지 않았습니다';
    const rejectedBody = `'${title}' 선정 결과가 나왔습니다. 아쉽게도 이번에는 선정되지 않으셨습니다. 납부하신 예약금이 있다면 전액 환불됩니다.`;

    // 파라미터에 ::text 를 붙이는 이유: INSERT ... SELECT 는 SELECT 를 먼저 해석하므로 대상 컬럼
    // 타입으로 추론이 흐르지 않고 "could not determine data type" 이 나는 경우가 있다.
    const inserted = await tx.$executeRaw`
      INSERT INTO "Notification"
        ("id","userId","type","category","priority","titleKo","bodyKo","payload",
         "deepLinkPath","eventId","applicationId","dedupeKey","updatedAt")
      SELECT
        gen_random_uuid()::text,
        se."userId",
        CASE WHEN se.status = 'SELECTED'
             THEN 'SELECTION_FINALIZED_SELECTED'::"NotificationType"
             ELSE 'SELECTION_FINALIZED_NOT_SELECTED'::"NotificationType" END,
        'RESULT'::"NotificationCategory",
        'HIGH'::"NotificationPriority",
        CASE WHEN se.status = 'SELECTED' THEN ${selectedTitle}::text ELSE ${rejectedTitle}::text END,
        CASE WHEN se.status = 'SELECTED' THEN ${selectedBody}::text ELSE ${rejectedBody}::text END,
        ${JSON.stringify(payload)}::jsonb,
        ${`/events/${eventId}`}::text,
        ${eventId}::text,
        se."applicationId",
        -- 중복 제거 단위는 수신자별이다. 라운드 단위 키를 써도 (userId, dedupeKey) 유니크라 충돌하지 않고,
        -- 같은 라운드가 두 번 확정되는 사고가 나도 알림은 1인 1건이다.
        'SELECTION_RESULT:' || ${selectionId}::text,
        now()
      FROM "SelectionEntry" se
      WHERE se."selectionId" = ${selectionId}
        AND se.status IN ('SELECTED','NOT_SELECTED')
      ON CONFLICT ("userId","dedupeKey") DO NOTHING
    `;

    await tx.$executeRaw`
      UPDATE "SelectionEntry" se SET "notifiedAt" = now(), "updatedAt" = now()
      WHERE se."selectionId" = ${selectionId}
        AND se.status IN ('SELECTED','NOT_SELECTED')
        AND se."notifiedAt" IS NULL
    `;

    return inserted;
  }

  /**
   * 집계 마무리. `version` 을 다시 올리지 않는다 — 낙관적 락 토큰은 위에서 이미 한 번 올렸고,
   * 여기서 또 올리면 방금 확정한 클라이언트가 받은 version 이 그 순간 낡은 값이 된다.
   */
  private async closeRound(tx: Tx, selectionId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ version: number; status: SelectionRoundStatus }[]>`
      UPDATE "Selection" s SET
        "selectedCount"      = (
          SELECT count(*)::int FROM "SelectionEntry" e
          WHERE e."selectionId" = s.id AND e.status = 'SELECTED'
        ),
        "notifyDispatchedAt" = now(),
        "updatedAt"          = now()
      WHERE s.id = ${selectionId}
      RETURNING s."version", s.status
    `;

    return rows[0]?.version ?? 0;
  }
}
