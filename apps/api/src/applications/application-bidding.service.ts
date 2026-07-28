import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApplicationCancelReason,
  ApplicationStatus,
  BidSource,
  DepositReason,
  EventMode,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
} from '@prisma/client';
import { orThrow, validateRaise, type AmountRule } from '@dibs/shared';

import { PrismaService } from '../prisma/prisma.service';
import { assertAffected } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  APPLICATION_TX_OPTIONS,
  IdempotencyEndpoint,
  hashIp,
  stateChanged,
  type RequestContext,
  type Tx,
} from './internal/application-context';
import { IdempotencyService } from './internal/idempotency.service';
import {
  cancelOpenHold,
  enqueueNotification,
  insertBidHistory,
  insertCancelBidHistory,
  lockEventForApply,
  lockSoftCloseChain,
  mayAttemptSoftClose,
  openDepositHold,
  raiseOpenHold,
  releaseInstantSlot,
  tryExtendSoftClose,
  type EventApplyContext,
  type SoftCloseOutcome,
} from './internal/application-writes';
import { fundedAmount, planAmountRaise, requiredDepositFor } from './internal/deposit-policy';
import { OWN_DATA_KEYS } from './internal/application-view';
import type { CancelApplicationDto, RaiseBidDto } from './dto/application.dto';

/**
 * 금액 상향과 취소.
 *
 * ★ "상향만 가능"은 서비스의 if 문이 아니라 **WHERE 절**이다(IC-12). 서비스 레이어에서 읽고
 * 비교하면 동시 요청 두 개가 각각 통과해서 낮은 쪽이 나중에 커밋될 수 있다.
 * 그래서 아래 UPDATE 에는 `amount < $new` 와 `highestAmountEver <= $new` 가 **둘 다** 들어 있다.
 * 전자만으로는 롤백(D-06)으로 내려간 금액이 새 바닥이 되어, 과거에 불렀던 금액보다 낮게
 * 다시 들어오는 경로가 열린다.
 */
@Injectable()
export class ApplicationBiddingService {
  private readonly logger = new Logger(ApplicationBiddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  private get paymentEnabled(): boolean {
    return this.config.get<boolean>('DEPOSIT_HOLD_ENABLED') === true;
  }

  /**
   * 재입찰(상향). (D-06)
   *
   * 상향하면 `lastBidAt` 이 그 시각으로 갱신되므로 같은 금액 그룹에서는 뒤로 밀린다 —
   * 그게 "그 금액에 먼저 도달한 사람이 이긴다"(D-04)의 실제 구현이다.
   * 정률 예약금이면 상향은 차액을 만들고, 그 차액을 새 창 안에 안 내면 금액만
   * 직전(완납되었던) 값으로 되돌린다. 신청 자체는 유효하게 살려둔다.
   */
  async raise(
    user: AuthenticatedUser,
    applicationId: string,
    dto: RaiseBidDto,
    ctx: RequestContext,
  ) {
    const ref = {
      userId: user.id,
      endpoint: IdempotencyEndpoint.raise(applicationId),
      key: ctx.idempotencyKey,
      requestHash: this.idempotency.hashRequest(dto),
    };

    const replayed = await this.idempotency.findCompleted(ref);
    if (replayed) return replayed.body;

    const current = await this.loadOwnApplication(applicationId, user.id);

    if (current.eventMode === EventMode.INSTANT) {
      throw stateChanged(
        'RAISE_NOT_ALLOWED_FOR_INSTANT',
        '선착순 즉시확정 예약은 금액이 고정되어 있어 재입찰할 수 없습니다.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const wantsSoftClose = mayAttemptSoftClose(current.event, new Date());
      if (wantsSoftClose) await lockSoftCloseChain(tx, current.eventId);

      const event = await lockEventForApply(tx, current.eventId);

      const replay = await this.idempotency.claim(tx, ref);
      if (replay) return replay.body;

      if (event.minAmount === null || event.maxAmount === null) {
        throw stateChanged('EVENT_AMOUNT_MISSING', '이벤트의 금액 설정이 올바르지 않습니다.');
      }

      const rule: AmountRule = { min: event.minAmount, max: event.maxAmount };
      orThrow(validateRaise(rule, current.amount, dto.amount));

      // 호가 단위는 아래 UPDATE 의 WHERE 절이 강제한다. 여기서 먼저 보는 것은 문구 때문이다.
      if ((dto.amount - event.minAmount) % event.amountStep !== 0) {
        throw new BadRequestException({
          code: 'AMOUNT_STEP_MISMATCH',
          message: `금액은 ${event.minAmount.toLocaleString('ko-KR')}원부터 ${event.amountStep.toLocaleString('ko-KR')}원 단위로 입력해 주세요.`,
        });
      }

      const paid = fundedAmount(current);
      const plan = planAmountRaise({
        policy: event,
        currentAmount: current.amount,
        nextAmount: dto.amount,
        paidSoFar: paid,
        now: new Date(),
      });
      const hasShortfall = plan.shortfall > 0;
      const requiredAfter = requiredDepositFor(event, dto.amount);

      // 부족분이 남는 상향은 마감을 늘리지 못한다(planRaise 가 그렇게 판정한다).
      // Event 를 다시 만지는 문장이라 Application UPDATE 보다 앞에 둔다 — 락 순서는 Event → Application(IC-02).
      const softClose =
        wantsSoftClose && plan.mayTriggerSoftClose
          ? await tryExtendSoftClose(tx, event.id, user.id)
          : undefined;

      await this.applyRaise(tx, {
        applicationId,
        expectedVersion: current.version,
        event,
        nextAmount: dto.amount,
        hasShortfall,
        requiredAfter,
      });

      const depositId = hasShortfall
        ? await this.ensureShortfallHold(tx, {
            applicationId,
            eventId: event.id,
            userId: user.id,
            policy: event,
            basisAmount: dto.amount,
            requiredAmount: requiredAfter,
            amountDue: plan.shortfall,
            // 최초 홀드가 아직 열려 있는(= 예약금 미납) 상태에서의 상향인지.
            replacesInitialHold: current.status === ApplicationStatus.PENDING_DEPOSIT,
          })
        : null;

      await insertBidHistory(tx, {
        applicationId,
        eventId: event.id,
        userId: user.id,
        source: BidSource.RAISE,
        previousAmount: current.amount,
        newAmount: dto.amount,
        depositRequiredAfter: requiredAfter,
        depositId,
        softClose,
        idempotencyKey: ctx.idempotencyKey,
        ipHash: hashIp(ctx.ip),
      });

      const body = await this.finishRaise(tx, {
        applicationId,
        eventId: event.id,
        userId: user.id,
        depositId,
        rollbackTo: hasShortfall ? plan.rollbackTo : null,
        softClose,
      });

      await this.idempotency.complete(tx, ref, HttpStatus.OK, body);
      return body;
    }, APPLICATION_TX_OPTIONS);
  }

  /**
   * 신청 취소.
   *
   * 취소는 반드시 `BidSource.CANCEL` 이력 1행을 남긴다(IC-13). 스칼라 컬럼 하나로만 남기면
   * 재신청 때 덮어써져 흔적이 사라지고, "취소 → 대기 → 재신청"으로 타이브레이크 시계를
   * 세탁하는 어뷰징을 사후에 탐지할 수도, 증명할 수도 없게 된다.
   * `canceledAt` 은 최초 1회만 채우고 `lastCanceledAt` 을 갱신하는 것도 같은 이유다.
   */
  async cancel(
    user: AuthenticatedUser,
    applicationId: string,
    dto: CancelApplicationDto,
    ctx: RequestContext,
  ) {
    const ref = {
      userId: user.id,
      endpoint: IdempotencyEndpoint.cancel(applicationId),
      key: ctx.idempotencyKey,
      requestHash: this.idempotency.hashRequest(dto),
    };

    const replayed = await this.idempotency.findCompleted(ref);
    if (replayed) return replayed.body;

    const current = await this.loadOwnApplication(applicationId, user.id);

    return this.prisma.$transaction(async (tx) => {
      const replay = await this.idempotency.claim(tx, ref);
      if (replay) return replay.body;

      // 이력이 먼저다. 상태를 먼저 바꾸면 이 INSERT 가 읽는 a."amount" 가
      // 이미 취소된 행의 값이 되어, "취소 직전 금액"이라는 정보를 영영 잃는다.
      await insertCancelBidHistory(tx, {
        applicationId,
        idempotencyKey: ctx.idempotencyKey,
        ipHash: hashIp(ctx.ip),
        actorUserId: user.id,
      });

      const affected = await tx.$executeRaw`
        UPDATE "Application" a SET
          status           = 'CANCELED'::"ApplicationStatus",
          "cancelReason"   = ${ApplicationCancelReason.USER_REQUEST}::"ApplicationCancelReason",
          -- 최초 취소 시각은 보존한다. 재신청이 덮어쓰면 어뷰징 추적의 기준점이 사라진다.
          "canceledAt"     = COALESCE(a."canceledAt", now()),
          "lastCanceledAt" = now(),
          -- 열린 홀드를 닫으므로 만기도 함께 지운다(app_deposit_due_required_chk).
          -- 낸 돈이 있으면 PAID 로 남겨 환불 큐가 대상을 찾을 수 있게 한다.
          "depositStatus"  = CASE
                               WHEN a."depositStatus" = 'NOT_REQUIRED' THEN 'NOT_REQUIRED'
                               WHEN a."depositPaidAmount" > a."depositRefundedAmount" THEN 'PAID'
                               ELSE 'EXPIRED'
                             END::"DepositStatus",
          "depositDueAt"   = NULL,
          "version"        = a."version" + 1,
          "updatedAt"      = now()
        WHERE a.id = ${applicationId}
          AND a."userId" = ${user.id}
          AND a."version" = ${current.version}
          -- CONFIRMED 를 포함하는 이유: INSTANT 는 즉시확정이라 정상 종착이 CONFIRMED 다(D-02).
          -- 여기서 빼면 INSTANT 예약을 취소할 방법이 아예 없어지고, 자리는 이용일까지 묶인다.
          AND a.status IN ('PENDING_DEPOSIT','VALID','CONFIRMED')
      `;

      assertAffected(affected, 1, 'APPLICATION_NOT_CANCELABLE');

      await cancelOpenHold(tx, applicationId);

      if (current.eventMode === EventMode.INSTANT) {
        // 반환은 점유와 대칭이다 — `slotClaimed = true` 가드가 이중 차감을 구조적으로 막는다(IC-15).
        await releaseInstantSlot(tx, applicationId, current.eventId);
      }

      const event = await tx.event.findUniqueOrThrow({
        where: { id: current.eventId },
        select: { title: true },
      });

      await enqueueNotification(tx, {
        userId: user.id,
        type: NotificationType.APPLICATION_CANCELED_BY_USER,
        category: NotificationCategory.APPLICATION,
        titleKo: '신청이 취소되었습니다',
        bodyKo: `'${event.title}' 신청이 취소되었습니다.${dto.memo ? ` (${dto.memo})` : ''}`,
        payload: { eventId: current.eventId, applicationId, eventTitle: event.title },
        deepLinkPath: `/my/applications/${applicationId}`,
        eventId: current.eventId,
        applicationId,
        // 취소는 재신청 후 다시 일어날 수 있으므로 취소 시각을 키에 섞는다.
        // 고정 키로 두면 두 번째 취소 알림이 조용히 사라진다.
        dedupeKey: `APPLICATION_CANCELED:${applicationId}:${current.version + 1}`,
      });

      const body = {
        id: applicationId,
        eventId: current.eventId,
        status: ApplicationStatus.CANCELED,
        canceledAt: new Date().toISOString(),
      };

      await this.idempotency.complete(tx, ref, HttpStatus.OK, body);
      return body;
    }, APPLICATION_TX_OPTIONS);
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async loadOwnApplication(applicationId: string, userId: string) {
    const row = await this.prisma.application.findFirst({
      where: { id: applicationId, userId },
      select: {
        id: true,
        eventId: true,
        eventMode: true,
        status: true,
        amount: true,
        version: true,
        depositPaidAmount: true,
        depositRefundedAmount: true,
        event: {
          select: {
            applyEndAt: true,
            softCloseEnabled: true,
            softCloseWindowMinutes: true,
            softCloseMaxExtensions: true,
            softCloseExtensionCount: true,
          },
        },
      },
    });

    if (!row) throw new NotFoundException('신청 내역을 찾을 수 없습니다.');

    return row;
  }

  /**
   * ★ IC-12 의 형태 그 자체. 조건을 하나라도 빼면 규칙이 무효가 된다.
   *
   * `amountStep` 나머지 검사까지 WHERE 에 넣는 이유는 같다 — 서비스에서 보면
   * 이벤트가 그 사이에 바뀌었을 때 조용히 규칙 밖의 금액이 커밋된다.
   *
   * 부족분이 남으면 `settledAmount / settledLastBidAt` 은 건드리지 않는다. 그 조합이 곧
   * 롤백 목표이고, 둘을 따로 갱신하면 D-04 의 순위 규칙상 존재한 적 없는 순위가 복원된다(IC-21).
   */
  private async applyRaise(
    tx: Tx,
    input: {
      applicationId: string;
      expectedVersion: number;
      event: EventApplyContext;
      nextAmount: number;
      hasShortfall: boolean;
      requiredAfter: number;
    },
  ): Promise<void> {
    const { event, nextAmount, hasShortfall } = input;

    const affected = await tx.$executeRaw`
      UPDATE "Application" a SET
        "amount"            = ${nextAmount}::int,
        -- IC-04: 반드시 DB 시계. JS 의 new Date() 는 밀리초라 Timestamptz(6) 순서를 깎는다.
        "lastBidAt"         = now(),
        "highestAmountEver" = GREATEST(a."highestAmountEver", ${nextAmount}::int),
        "rebidCount"        = a."rebidCount" + 1,
        "settledAmount"     = CASE WHEN ${hasShortfall}::boolean
                                   THEN a."settledAmount" ELSE ${nextAmount}::int END,
        "settledLastBidAt"  = CASE WHEN ${hasShortfall}::boolean
                                   THEN a."settledLastBidAt" ELSE now() END,
        -- 최초 홀드가 아직 열려 있으면(PENDING_DEPOSIT) 그 홀드의 금액만 올린다.
        -- SHORTFALL_PENDING 으로 바꿔버리면 app_pending_deposit_chk 에 걸린다.
        "depositStatus"     = CASE
                                WHEN NOT ${hasShortfall}::boolean AND a."depositStatus" = 'NOT_REQUIRED'
                                  THEN 'NOT_REQUIRED'
                                WHEN NOT ${hasShortfall}::boolean THEN 'PAID'
                                WHEN a.status = 'PENDING_DEPOSIT' THEN 'PENDING'
                                ELSE 'SHORTFALL_PENDING'
                              END::"DepositStatus",
        "depositDueAt"      = CASE
                                WHEN NOT ${hasShortfall}::boolean THEN NULL
                                -- 이미 열려 있는 창은 연장하지 않는다. 상향으로 시계를 새로 여는 것이
                                -- "올려놓고 안 내기"의 입구다(D-06).
                                WHEN a."depositDueAt" IS NOT NULL THEN a."depositDueAt"
                                ELSE now() + make_interval(mins => ${event.depositWindowMinutes}::int)
                              END,
        "depositRequiredAmount" = ${input.requiredAfter}::int,
        "version"           = a."version" + 1,
        "updatedAt"         = now()
      WHERE a.id = ${input.applicationId}
        AND a."version" = ${input.expectedVersion}
        AND a.status IN ('PENDING_DEPOSIT','VALID')
        AND a."amount" < ${nextAmount}::int
        AND a."highestAmountEver" <= ${nextAmount}::int
        AND (${nextAmount}::int - COALESCE(${event.minAmount}::int, 0)) % ${event.amountStep}::int = 0
    `;

    if (affected !== 1) await this.explainRaiseFailure(tx, input.applicationId, nextAmount);
  }

  /** 0행의 이유를 갈라낸다. 쓰기 경로 밖에서만 도는 진단 조회다(IC-01 의 409 는 이유를 말해주지 않는다). */
  private async explainRaiseFailure(
    tx: Tx,
    applicationId: string,
    nextAmount: number,
  ): Promise<never> {
    const row = await tx.application.findUnique({
      where: { id: applicationId },
      select: { status: true, amount: true, highestAmountEver: true },
    });

    if (!row) throw new NotFoundException('신청 내역을 찾을 수 없습니다.');

    if (!['PENDING_DEPOSIT', 'VALID'].includes(row.status)) {
      throw stateChanged(
        'APPLICATION_NOT_RAISABLE',
        '지금 상태에서는 금액을 올릴 수 없습니다. 다시 조회해 주세요.',
      );
    }

    if (row.highestAmountEver > nextAmount || row.amount >= nextAmount) {
      throw stateChanged(
        'RAISE_ONLY',
        `금액은 올릴 수만 있습니다. 현재 ${Math.max(row.amount, row.highestAmountEver).toLocaleString('ko-KR')}원보다 높게 입력해 주세요.`,
      );
    }

    throw stateChanged(
      'APPLICATION_STATE_CHANGED',
      '신청 내용이 변경되었습니다. 다시 조회한 뒤 시도해 주세요.',
    );
  }

  /**
   * 부족분 홀드를 확보한다. **열린 홀드는 신청당 최대 1개다**(`one_open_deposit`).
   *
   * 이미 열린 홀드가 있으면 새로 만들지 않고 그 홀드의 청구 금액만 올린다. 새로 만들면
   * 부분 유니크 위반으로 상향 트랜잭션 전체가 죽고, 설령 통과해도 어느 홀드가 만료돼야 하는지
   * 스위퍼가 판단할 수 없다. 만기가 그대로 유지되는 것도 의도다 — 상향으로 시계를 다시 여는 순간
   * 최소 단위로 계속 올리며 납부를 무한히 미룰 수 있다.
   *
   * 기존 홀드를 `FOR UPDATE` 로 잡는 이유: 이 순간 만료 스위퍼가 같은 행을 집어가면
   * 우리는 방금 금액을 올린 홀드를 만료 처리당한다. 락 순서는 Application → Deposit 이다(IC-02).
   */
  private async ensureShortfallHold(
    tx: Tx,
    input: {
      applicationId: string;
      eventId: string;
      userId: string;
      policy: EventApplyContext;
      basisAmount: number;
      requiredAmount: number;
      amountDue: number;
      replacesInitialHold: boolean;
    },
  ): Promise<string> {
    const [open] = await tx.$queryRaw<{ id: string; amountDue: number; expired: boolean }[]>`
      SELECT d.id, d."amountDue", d."dueAt" <= now() AS expired
      FROM "Deposit" d
      WHERE d."applicationId" = ${input.applicationId} AND d.status = 'PENDING'
      FOR UPDATE
    `;

    if (open) {
      if (open.expired) {
        throw stateChanged(
          'DEPOSIT_HOLD_EXPIRED',
          '예약금 입금 시간이 지났습니다. 잠시 후 다시 조회해 주세요.',
        );
      }

      await raiseOpenHold(tx, open.id, {
        basisAmount: input.basisAmount,
        requiredAmount: input.requiredAmount,
        // 이미 열린 홀드에 부분 납부가 있었다면 차액은 그만큼 줄어든다.
        // amountDue 를 내리지는 않는다(raiseOpenHold 의 `<=` 가드).
        amountDue: Math.max(open.amountDue, input.amountDue),
      });

      return open.id;
    }

    return openDepositHold(tx, {
      applicationId: input.applicationId,
      eventId: input.eventId,
      userId: input.userId,
      reason: input.replacesInitialHold ? DepositReason.INITIAL : DepositReason.RAISE_SHORTFALL,
      policy: input.policy,
      basisAmount: input.basisAmount,
      requiredAmount: input.requiredAmount,
      amountDue: input.amountDue,
      paymentEnabled: this.paymentEnabled,
    });
  }

  /** 상향 결과 알림과 응답. 롤백 목표 금액은 **본인 금액**이라 본인에게만 알려준다. */
  private async finishRaise(
    tx: Tx,
    input: {
      applicationId: string;
      eventId: string;
      userId: string;
      depositId: string | null;
      rollbackTo: number | null;
      softClose: SoftCloseOutcome | undefined;
    },
  ) {
    const row = await tx.application.findUniqueOrThrow({
      where: { id: input.applicationId },
      select: {
        id: true,
        eventId: true,
        status: true,
        amount: true,
        depositStatus: true,
        depositDueAt: true,
        depositRequiredAmount: true,
        version: true,
        event: { select: { title: true } },
      },
    });

    const deepLinkPath = `/my/applications/${input.applicationId}`;
    const payload = {
      eventId: input.eventId,
      applicationId: input.applicationId,
      eventTitle: row.event.title,
    };

    if (input.depositId) {
      const due = await tx.deposit.findUniqueOrThrow({
        where: { id: input.depositId },
        select: { dueAt: true, amountDue: true },
      });

      await enqueueNotification(tx, {
        userId: input.userId,
        type: NotificationType.REBID_DEPOSIT_SHORTFALL,
        category: NotificationCategory.DEPOSIT,
        priority: NotificationPriority.HIGH,
        titleKo: '재입찰 차액을 입금해 주세요',
        bodyKo:
          `금액을 올리셨습니다. 차액 ${due.amountDue.toLocaleString('ko-KR')}원을 기한 안에 입금하지 않으면 ` +
          `${(input.rollbackTo ?? 0).toLocaleString('ko-KR')}원으로 되돌아갑니다. 신청 자체는 유지됩니다.`,
        payload: { ...payload, dueAt: due.dueAt, myDepositAmount: due.amountDue },
        allowKeys: OWN_DATA_KEYS,
        deepLinkPath,
        eventId: input.eventId,
        applicationId: input.applicationId,
        dedupeKey: `REBID_DEPOSIT_SHORTFALL:${input.depositId}`,
        email: {
          subjectKo: `[Dibs] '${row.event.title}' 재입찰 차액 입금 안내`,
          bodyText: `차액 ${due.amountDue.toLocaleString('ko-KR')}원을 기한 안에 입금해 주세요.`,
        },
      });
    } else {
      await enqueueNotification(tx, {
        userId: input.userId,
        type: NotificationType.REBID_ACCEPTED,
        category: NotificationCategory.APPLICATION,
        titleKo: '재입찰이 반영되었습니다',
        bodyKo: `'${row.event.title}' 신청 금액이 ${row.amount.toLocaleString('ko-KR')}원으로 변경되었습니다.`,
        payload,
        deepLinkPath,
        eventId: input.eventId,
        applicationId: input.applicationId,
        dedupeKey: `REBID_ACCEPTED:${input.applicationId}:${row.version}`,
      });
    }

    if (input.softClose?.extended) {
      this.logger.log(
        `소프트 클로즈 연장(상향): event=${input.eventId} → ${input.softClose.deadlineAfter?.toISOString()}`,
      );

      await enqueueNotification(tx, {
        userId: input.userId,
        type: NotificationType.DEADLINE_EXTENDED,
        category: NotificationCategory.EVENT_CHANGE,
        titleKo: '마감이 연장되었습니다',
        bodyKo: `'${row.event.title}' 신청 마감이 연장되었습니다.`,
        payload: { ...payload, applyEndAt: input.softClose.deadlineAfter },
        deepLinkPath,
        eventId: input.eventId,
        applicationId: input.applicationId,
        dedupeKey: `DEADLINE_EXTENDED:${input.eventId}:${input.userId}:${input.softClose.deadlineAfter?.toISOString()}`,
      });
    }

    return {
      id: row.id,
      eventId: row.eventId,
      status: row.status,
      myAmount: row.amount,
      version: row.version,
      deposit: {
        status: row.depositStatus,
        dueAt: row.depositDueAt,
        requiredAmount: row.depositRequiredAmount,
      },
      /** 차액 미납 시 되돌아갈 금액. 본인 금액이므로 본인에게는 공개다. */
      rollbackTo: input.rollbackTo,
      deadlineExtendedTo: input.softClose?.extended ? input.softClose.deadlineAfter : null,
    };
  }
}
