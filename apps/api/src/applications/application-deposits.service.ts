import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BidSource,
  CoreActorType,
  DepositReason,
  EventMode,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { assertAffected } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  APPLICATION_TX_OPTIONS,
  IdempotencyEndpoint,
  stateChanged,
  type RequestContext,
  type Tx,
} from './internal/application-context';
import { IdempotencyService } from './internal/idempotency.service';
import {
  enqueueNotification,
  insertBidHistory,
  releaseInstantSlot,
} from './internal/application-writes';
import { OWN_DATA_KEYS } from './internal/application-view';
import type { ConfirmDepositDto } from './dto/application.dto';

/** 지연 만료가 한 번에 처리할 홀드 수. 조회 응답 지연을 만들지 않을 만큼만 집는다. */
const LAZY_EXPIRY_BATCH = 20;

interface ExpiringHold {
  depositId: string;
  applicationId: string;
  eventId: string;
  userId: string;
  reason: DepositReason;
  applicationStatus: string;
  eventMode: EventMode;
  eventTitle: string;
  amount: number;
  settledAmount: number;
  settledLastBidAt: Date;
}

/**
 * 예약금 홀드의 확정과 만료.
 *
 * D-05 가 정한 두 가지가 여기 다 들어 있다.
 *  - 예약금은 **순위가 아니라 자격 요건**이다. 순위를 정하는 금액은 신청 금액이지 낸 예약금이 아니다.
 *  - 실제 결제(PG) 연동은 후속 단계다. 지금은 상태·타이머·테이블만 만들고
 *    `DEPOSIT_HOLD_ENABLED=false` 로 집행을 꺼둔다.
 *
 * 서버리스라 상주 프로세스로 만기를 지킬 수 없으므로 만료는 **크론 스위퍼 + 조회 시 지연 만료**
 * 두 경로다. 두 경로가 같은 행을 동시에 처리해도 안전해야 하므로 전부 `SKIP LOCKED` 와
 * 조건부 UPDATE 로만 이루어져 있다(IC-24).
 */
@Injectable()
export class ApplicationDepositsService {
  private readonly logger = new Logger(ApplicationDepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  private get paymentEnabled(): boolean {
    return this.config.get<boolean>('DEPOSIT_HOLD_ENABLED') === true;
  }

  /**
   * ★ 예약금 납부 확인. 조건부 UPDATE 두 개이고 둘 다 정확히 1행이어야 한다. (IC-21)
   *
   * PG 웹훅은 재전송이 정상 동작이다. 조건 없이 `status='PAID'` 를 쓰면, 이미 만료되어
   * 그 자리가 다른 사람에게 넘어간 뒤에 도착한 재생 웹훅이 신청을 CONFIRMED 로 되살린다.
   * 같은 좌석에 두 명이 확정되고 DB 에는 그게 정상으로 보인다 —
   * 두 번째 UPDATE 의 상태 조건이 이걸 막는 **유일한** 장치다.
   *
   * `settledAmount` 와 `settledLastBidAt` 을 반드시 함께 쓴다. 따로 갱신하면 롤백(IC-23) 때
   * 금액과 시각이 어긋난 조합이 복원되고, 그 조합은 D-04 의 순위 규칙상 존재한 적이 없다.
   */
  async confirm(
    user: AuthenticatedUser,
    applicationId: string,
    dto: ConfirmDepositDto,
    ctx: RequestContext,
  ) {
    const ref = {
      userId: user.id,
      endpoint: IdempotencyEndpoint.confirmDeposit(applicationId),
      key: ctx.idempotencyKey,
      requestHash: this.idempotency.hashRequest(dto),
    };

    const replayed = await this.idempotency.findCompleted(ref);
    if (replayed) return replayed.body;

    // ─────────────────────────────────────────────────────────────────────
    // ★ PG 연동 자리 (D-05 — 실제 결제 집행은 후속 단계)
    //
    //   여기가 포트원/토스페이먼츠 호출이 들어갈 지점이다. 트랜잭션 **밖**인 것이 중요하다:
    //   트랜잭션 안에서 외부 API 를 부르면 행 락을 든 채 네트워크를 기다리게 되고,
    //   커밋이 실패해도 결제는 이미 나간 상태가 된다(IC-42 가 알림에서 막는 것과 같은 문제).
    //
    //   구현할 때의 순서는 이렇게 된다.
    //     1) 홀드를 읽어 amountDue 를 확인한다
    //     2) PG 승인 API 호출 → paymentIntentId 획득
    //     3) 아래 트랜잭션에서 상태를 전이시키고 paymentIntentId 를 홀드에 기록한다
    //     4) 3)이 실패하면 PG 취소 API 로 보상한다 (Deposit.paymentIntentId 유니크가 중복 승인을 막는다)
    //
    //   플래그가 켜져 있는데 구현이 없는 상태로 조용히 상태만 바꾸면, 돈을 받지 않고
    //   "납부 완료"로 확정하는 것이 된다. 그래서 켜져 있으면 명시적으로 거절한다.
    // ─────────────────────────────────────────────────────────────────────
    if (this.paymentEnabled) {
      throw new HttpException(
        {
          code: 'PAYMENT_PROVIDER_NOT_IMPLEMENTED',
          message: '결제 연동이 아직 준비되지 않았습니다.',
        },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const replay = await this.idempotency.claim(tx, ref);
      if (replay) return replay.body;

      // 락 순서는 Application → Deposit 이다(IC-02). 홀드를 잠가야 만료 스위퍼와 겹치지 않는다.
      const [hold] = await tx.$queryRaw<
        {
          id: string;
          reason: DepositReason;
          amountDue: number;
          applicationStatus: string;
          applicationVersion: number;
          eventMode: EventMode;
          eventId: string;
          eventTitle: string;
        }[]
      >`
        SELECT d.id, d.reason, d."amountDue",
               a.status::text AS "applicationStatus", a."version" AS "applicationVersion",
               a."eventMode", a."eventId", e.title AS "eventTitle"
        FROM "Deposit" d
        JOIN "Application" a ON a.id = d."applicationId"
        JOIN "Event" e       ON e.id = a."eventId"
        WHERE d."applicationId" = ${applicationId}
          AND d."userId" = ${user.id}
          AND d.status = 'PENDING'
          AND d."dueAt" > now()
        FOR UPDATE OF d
      `;

      if (!hold) {
        throw stateChanged(
          'DEPOSIT_HOLD_NOT_OPEN',
          '입금 대기 중인 예약금이 없거나 입금 시간이 지났습니다.',
        );
      }

      // (1) 홀드 확정. 이미 만료됐거나 이미 납부됐으면 여기서 0행이 나온다.
      const holdAffected = await tx.$executeRaw`
        UPDATE "Deposit" d SET
          status              = 'PAID'::"DepositStatus",
          "amountPaid"        = d."amountDue",
          "paidAt"            = now(),
          "resolvedAt"        = now(),
          "paymentMethod"     = ${dto.paymentReference ? 'EXTERNAL_REF' : null}::varchar(30),
          "featureFlagSnapshot" = ${this.paymentEnabled}::boolean,
          "updatedAt"         = now()
        WHERE d.id = ${hold.id}
          AND d.status = 'PENDING'
          AND d."dueAt" > now()
      `;

      assertAffected(holdAffected, 1, 'DEPOSIT_HOLD_NOT_OPEN');

      // (2) 신청 전이. 두 형태로 갈리는 이유는 홀드의 성격이 다르기 때문이다.
      //     최초/재신청 홀드는 "아직 유효하지 않은 신청"을 유효하게 만들고(PENDING_DEPOSIT →),
      //     상향 부족분 홀드는 이미 유효한 신청의 롤백 목표를 새 금액으로 승격시킨다.
      const appAffected =
        hold.reason === DepositReason.RAISE_SHORTFALL
          ? await this.confirmShortfall(tx, applicationId, hold.applicationVersion, hold.amountDue)
          : await this.confirmInitial(tx, applicationId, hold.applicationVersion, hold.amountDue);

      assertAffected(appAffected, 1, 'APPLICATION_STATE_CHANGED');

      await enqueueNotification(tx, {
        userId: user.id,
        type: NotificationType.DEPOSIT_CONFIRMED,
        category: NotificationCategory.DEPOSIT,
        priority: NotificationPriority.HIGH,
        titleKo: '예약금이 확인되었습니다',
        bodyKo:
          hold.eventMode === EventMode.INSTANT
            ? `'${hold.eventTitle}' 예약이 확정되었습니다.`
            : `'${hold.eventTitle}' 신청이 유효해졌습니다. 결과는 마감 후 안내드립니다.`,
        payload: {
          eventId: hold.eventId,
          applicationId,
          eventTitle: hold.eventTitle,
          myDepositAmount: hold.amountDue,
        },
        allowKeys: OWN_DATA_KEYS,
        deepLinkPath: `/my/applications/${applicationId}`,
        eventId: hold.eventId,
        applicationId,
        dedupeKey: `DEPOSIT_CONFIRMED:${hold.id}`,
        email: {
          subjectKo: `[Dibs] '${hold.eventTitle}' 예약금 입금이 확인되었습니다`,
          bodyText: `예약금 ${hold.amountDue.toLocaleString('ko-KR')}원 입금이 확인되었습니다.`,
        },
      });

      const row = await tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: {
          id: true,
          eventId: true,
          status: true,
          amount: true,
          depositStatus: true,
          depositPaidAmount: true,
          depositRequiredAmount: true,
          version: true,
        },
      });

      const body = {
        id: row.id,
        eventId: row.eventId,
        status: row.status,
        myAmount: row.amount,
        version: row.version,
        deposit: {
          status: row.depositStatus,
          dueAt: null,
          requiredAmount: row.depositRequiredAmount,
          paidAmount: row.depositPaidAmount,
        },
      };

      await this.idempotency.complete(tx, ref, HttpStatus.OK, body);
      return body;
    }, APPLICATION_TX_OPTIONS);
  }

  /** 최초·재신청 홀드의 확정. IC-21 의 형태 그 자체다. */
  private confirmInitial(
    tx: Tx,
    applicationId: string,
    version: number,
    amount: number,
  ): Promise<number> {
    return tx.$executeRaw`
      UPDATE "Application" a SET
        "depositStatus"     = 'PAID'::"DepositStatus",
        "depositPaidAmount" = a."depositPaidAmount" + ${amount}::int,
        "depositDueAt"      = NULL,
        status              = CASE WHEN a."eventMode" = 'INSTANT'
                                   THEN 'CONFIRMED'::"ApplicationStatus"
                                   ELSE 'VALID'::"ApplicationStatus" END,
        -- 완납된 금액을 롤백 목표로 승격. 금액과 시각을 반드시 "쌍으로" 갱신한다.
        "settledAmount"     = a."amount",
        "settledLastBidAt"  = a."lastBidAt",
        "confirmedAt"       = COALESCE(a."confirmedAt", now()),
        "version"           = a."version" + 1,
        "updatedAt"         = now()
      WHERE a.id = ${applicationId}
        AND a."version" = ${version}
        AND a.status = 'PENDING_DEPOSIT'
    `;
  }

  /**
   * 상향 부족분 홀드의 확정.
   *
   * 신청은 이미 VALID/CONFIRMED 다 — 부족분 미납은 무효 대상이 아니라 롤백 대상이기 때문에
   * `app_valid_requires_deposit_chk` 가 SHORTFALL_PENDING 을 허용하고 있다(D-06).
   * 여기서 하는 일은 롤백 목표를 새 금액으로 올리는 것뿐이다.
   */
  private confirmShortfall(
    tx: Tx,
    applicationId: string,
    version: number,
    amount: number,
  ): Promise<number> {
    return tx.$executeRaw`
      UPDATE "Application" a SET
        "depositStatus"     = 'PAID'::"DepositStatus",
        "depositPaidAmount" = a."depositPaidAmount" + ${amount}::int,
        "depositDueAt"      = NULL,
        "settledAmount"     = a."amount",
        "settledLastBidAt"  = a."lastBidAt",
        "version"           = a."version" + 1,
        "updatedAt"         = now()
      WHERE a.id = ${applicationId}
        AND a."version" = ${version}
        AND a."depositStatus" = 'SHORTFALL_PENDING'
        AND a.status IN ('VALID','CONFIRMED')
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 조회 시 지연 만료(lazy expiry). (D-05 / IC-24)
   *
   * 서버리스에는 상주 프로세스가 없어서 "10분이 지나면 만료"를 타이머로 만들 수 없다.
   * 크론 스위퍼가 주 경로지만 크론은 분 단위라, 내 화면이 "만료됨"을 보여주기까지 최대 1분이 뜬다.
   * 그 사이에 사용자가 이미 죽은 홀드를 보고 입금을 시도하는 것이 가장 나쁜 실패 모드다.
   *
   * 두 경로가 같은 행을 동시에 처리해도 안전해야 하므로 배치를 `FOR UPDATE SKIP LOCKED` 로 집는다.
   * 크론이 이미 잡은 행은 조용히 건너뛴다 — 기다리면 둘 다 함수 타임아웃에 걸린다.
   * 대상은 **요청자 본인의 홀드**로 한정한다. 남의 홀드까지 훑으면 조회 한 번이
   * 플랫폼 전체 스위퍼가 되어 응답 시간이 예측 불가능해진다.
   */
  async expireOverdueHoldsOf(userId: string): Promise<number> {
    // 후보만 고른다. 여기서 `FOR UPDATE` 를 걸어도 소용이 없다 — 트랜잭션 밖의 쿼리는
    // 자기 암시적 트랜잭션이 끝나는 순간 락을 놓기 때문에, 클레임처럼 보이지만 클레임이 아니다.
    // 실제 클레임은 아래 각 트랜잭션 안에서 다시 잡는다.
    const candidates = await this.prisma.$queryRaw<{ depositId: string }[]>`
      SELECT d.id AS "depositId"
      FROM "Deposit" d
      WHERE d."userId" = ${userId}
        AND d.status = 'PENDING'
        AND d."dueAt" <= now()
      ORDER BY d."dueAt"
      LIMIT ${LAZY_EXPIRY_BATCH}
    `;

    let expired = 0;

    for (const candidate of candidates) {
      // 홀드마다 트랜잭션을 나눈다. 하나가 경합으로 실패해도 나머지는 정리되어야 하고,
      // 조회 경로에서 긴 트랜잭션을 여는 것 자체가 신청 hot path 를 막는다.
      expired += await this.prisma
        .$transaction((tx) => this.expireOne(tx, candidate.depositId))
        .catch((error: unknown) => {
          this.logger.warn(`지연 만료 실패 deposit=${candidate.depositId}: ${String(error)}`);
          return 0;
        });
    }

    return expired;
  }

  /**
   * 홀드 1건 만료.
   *
   * 두 갈래다.
   *  - 최초/재신청 홀드 미납 → 신청 자체가 무효다. INSTANT 는 자리를 반환한다(D-05).
   *  - 상향 부족분 미납     → 신청은 살려두고 **금액과 시각을 쌍으로** 되돌린다(IC-23).
   *    통째로 무효화하면 완납했던 금액까지 잃게 되어 부당하고, 아무것도 안 하면
   *    "올리기만 하고 안 내기"가 이득이 된다.
   *
   * `SKIP LOCKED` 로 잡는다(IC-24). 크론 스위퍼가 이미 이 행을 들고 있으면 조용히 건너뛴다 —
   * 기다리면 Vercel 함수 타임아웃 안에서 둘 다 죽는다. 만료 처리는 반드시 재진입 가능해야 한다.
   */
  private async expireOne(tx: Tx, depositId: string): Promise<number> {
    const [hold] = await tx.$queryRaw<ExpiringHold[]>`
      SELECT d.id           AS "depositId",
             d."applicationId",
             d."eventId",
             d."userId",
             d.reason,
             a.status::text AS "applicationStatus",
             a."eventMode",
             e.title        AS "eventTitle",
             a."amount",
             a."settledAmount",
             a."settledLastBidAt"
      FROM "Deposit" d
      JOIN "Application" a ON a.id = d."applicationId"
      JOIN "Event" e       ON e.id = d."eventId"
      WHERE d.id = ${depositId}
        AND d.status = 'PENDING'
        AND d."dueAt" <= now()
      FOR UPDATE OF d SKIP LOCKED
    `;

    // 다른 경로가 이미 처리했거나 지금 잡고 있다는 뜻이다. 오류가 아니다.
    if (!hold) return 0;

    const holdClosed = await tx.$executeRaw`
      UPDATE "Deposit" d SET
        status       = 'EXPIRED'::"DepositStatus",
        "resolvedAt" = now(),
        "updatedAt"  = now()
      WHERE d.id = ${hold.depositId} AND d.status = 'PENDING' AND d."dueAt" <= now()
    `;

    if (holdClosed !== 1) return 0;

    if (hold.reason === DepositReason.RAISE_SHORTFALL) {
      await this.rollbackToSettled(tx, hold);
      return 1;
    }

    const invalidated = await tx.$executeRaw`
      UPDATE "Application" a SET
        status          = 'EXPIRED'::"ApplicationStatus",
        "cancelReason"  = 'DEPOSIT_TIMEOUT'::"ApplicationCancelReason",
        -- app_expired_deposit_chk: EXPIRED 신청은 예약금도 EXPIRED 여야 한다.
        -- 이 한 쌍이 깨지면 뒤늦은 확인 웹훅이 만료된 신청을 되살릴 수 있다.
        "depositStatus" = 'EXPIRED'::"DepositStatus",
        "depositDueAt"  = NULL,
        "version"       = a."version" + 1,
        "updatedAt"     = now()
      WHERE a.id = ${hold.applicationId}
        AND a.status = 'PENDING_DEPOSIT'
    `;

    if (invalidated === 1 && hold.eventMode === EventMode.INSTANT) {
      await releaseInstantSlot(tx, hold.applicationId, hold.eventId);
    }

    await enqueueNotification(tx, {
      userId: hold.userId,
      type: NotificationType.DEPOSIT_HOLD_EXPIRED,
      category: NotificationCategory.DEPOSIT,
      priority: NotificationPriority.HIGH,
      titleKo: '예약금 입금 시간이 지났습니다',
      bodyKo: `'${hold.eventTitle}' 신청이 예약금 미입금으로 무효 처리되었습니다.`,
      payload: {
        eventId: hold.eventId,
        applicationId: hold.applicationId,
        eventTitle: hold.eventTitle,
      },
      deepLinkPath: `/my/applications/${hold.applicationId}`,
      eventId: hold.eventId,
      applicationId: hold.applicationId,
      dedupeKey: `DEPOSIT_HOLD_EXPIRED:${hold.depositId}`,
      email: {
        subjectKo: `[Dibs] '${hold.eventTitle}' 예약금 미입금 안내`,
        bodyText: '예약금 입금 시간이 지나 신청이 무효 처리되었습니다.',
      },
    });

    return 1;
  }

  /**
   * 부족분 미납 롤백. 금액과 시각을 **쌍으로** 되돌린다. (IC-23 / D-06)
   *
   * `highestAmountEver` 는 되돌리지 않는다 — 그게 IC-12 의 재상향 하한이다.
   * 되돌리고 나면 롤백으로 내려간 금액이 새 바닥이 되어, 올렸다 안 내기를 반복하며
   * 하한을 계속 리셋할 수 있게 된다.
   */
  private async rollbackToSettled(tx: Tx, hold: ExpiringHold): Promise<void> {
    const rolledBack = await tx.$executeRaw`
      UPDATE "Application" a SET
        "amount"           = a."settledAmount",
        "lastBidAt"        = a."settledLastBidAt",
        "depositStatus"    = 'PAID'::"DepositStatus",
        "depositDueAt"     = NULL,
        -- 되돌아간 금액은 정의상 완납된 금액이므로, 요구액을 실효 납부액으로 맞춘다.
        -- 상향분에 대한 요구액을 남겨두면 화면이 "아직 덜 냈다"고 표시한다.
        "depositRequiredAmount" = a."depositPaidAmount" - a."depositRefundedAmount",
        "version"          = a."version" + 1,
        "updatedAt"        = now()
      WHERE a.id = ${hold.applicationId}
        AND a."depositStatus" = 'SHORTFALL_PENDING'
        AND a."settledAmount" < a."amount"
    `;

    if (rolledBack !== 1) return;

    // ROLLBACK 이력은 deltaAmount < 0 이고 restoredLastBidAt 이 반드시 있어야 한다
    // (bid_history_rollback_clock_chk). 그게 없으면 나중에 "왜 내 순위가 내려갔나" 문의에
    // 답할 근거가 없다.
    await insertBidHistory(tx, {
      applicationId: hold.applicationId,
      eventId: hold.eventId,
      userId: hold.userId,
      source: BidSource.ROLLBACK,
      previousAmount: hold.amount,
      newAmount: hold.settledAmount,
      depositRequiredAfter: 0,
      depositId: hold.depositId,
      restoredLastBidAt: hold.settledLastBidAt,
      // 사람이 아니라 조회 시 지연 만료가 일으킨 전이다. 크론(SYSTEM_CRON)과 구분해 둬야
      // 나중에 "만료가 어느 경로로 돌았나"를 이력만 보고 재구성할 수 있다.
      actorType: CoreActorType.SYSTEM_LAZY,
      actorUserId: null,
    });

    await enqueueNotification(tx, {
      userId: hold.userId,
      type: NotificationType.REBID_ROLLED_BACK,
      category: NotificationCategory.DEPOSIT,
      priority: NotificationPriority.HIGH,
      titleKo: '재입찰 금액이 되돌려졌습니다',
      bodyKo:
        `'${hold.eventTitle}' 재입찰 차액이 입금되지 않아 신청 금액이 ` +
        `${hold.settledAmount.toLocaleString('ko-KR')}원으로 되돌아갔습니다. 신청 자체는 유지됩니다.`,
      payload: {
        eventId: hold.eventId,
        applicationId: hold.applicationId,
        eventTitle: hold.eventTitle,
      },
      deepLinkPath: `/my/applications/${hold.applicationId}`,
      eventId: hold.eventId,
      applicationId: hold.applicationId,
      dedupeKey: `REBID_ROLLED_BACK:${hold.depositId}`,
      email: {
        subjectKo: `[Dibs] '${hold.eventTitle}' 재입찰 금액 원복 안내`,
        bodyText: '재입찰 차액이 입금되지 않아 이전 금액으로 되돌렸습니다. 신청은 유지됩니다.',
      },
    });
  }
}
