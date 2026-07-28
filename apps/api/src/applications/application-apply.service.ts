import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ApplicationStatus,
  BidSource,
  DepositReason,
  DepositStatus,
  EventMode,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import {
  REAPPLY_COOLDOWN_MINUTES,
  canReapply,
  orThrow,
  validateBidAmount,
  type AmountRule,
} from '@dibs/shared';

import { PrismaService } from '../prisma/prisma.service';
import {
  APPLICATION_TX_OPTIONS,
  IdempotencyEndpoint,
  hashIp,
  stateChanged,
  type RequestContext,
  type Tx,
} from './internal/application-context';
import { IdempotencyService, isUniqueViolation } from './internal/idempotency.service';
import {
  claimInstantSlot,
  enqueueNotification,
  insertBidHistory,
  lockEventForApply,
  lockSoftCloseChain,
  mayAttemptSoftClose,
  openDepositHold,
  readEventForInstantApply,
  tryExtendSoftClose,
  type EventApplyContext,
  type SoftCloseOutcome,
} from './internal/application-writes';
import { fundedAmount, planInitialDeposit, settledStatusFor } from './internal/deposit-policy';
import { OWN_DATA_KEYS } from './internal/application-view';
import type { CreateApplicationDto, ReapplyDto } from './dto/application.dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * 신청 생성과 재신청.
 *
 * 두 모드의 진입 방식이 근본적으로 다르다(D-02).
 *  - BID     기간 동안 정원 초과로 얼마든지 받는다. 신청은 **단순 INSERT** 이고 정원 카운터가 없다.
 *            대신 트랜잭션의 첫 문장이 Event 에 대한 `FOR SHARE` 다(IC-11).
 *  - INSTANT 신청하는 순간 자리를 잡는다. 단일 원자적 조건부 UPDATE 하나가 게이트다(IC-15).
 *
 * D-03 이 "정원 초과를 허용한다"고 정한 덕분에 BID 쪽에서는 분산 락도, 원자적 카운터도,
 * 대기열 승계도 전부 불필요하다. 그 결정을 코드에서 되돌리지 않는 것이 이 서비스의 핵심 제약이다.
 */
@Injectable()
export class ApplicationApplyService {
  private readonly logger = new Logger(ApplicationApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  /** D-05: 실제 결제(PG) 집행은 후속 단계다. 홀드 행에 스냅샷으로 남겨 나중에 구분할 수 있게 한다. */
  private get paymentEnabled(): boolean {
    return this.config.get<boolean>('DEPOSIT_HOLD_ENABLED') === true;
  }

  async apply(user: AuthenticatedUser, dto: CreateApplicationDto, ctx: RequestContext) {
    const ref = {
      userId: user.id,
      endpoint: IdempotencyEndpoint.apply(),
      key: ctx.idempotencyKey,
      requestHash: this.idempotency.hashRequest(dto),
    };

    // 트랜잭션을 열기 전에 재생을 먼저 본다. 이 빠른 경로가 없으면 마감 직전에 성공한
    // 신청의 재시도가 IC-11 게이트에서 "이미 마감됨"으로 튕긴다 — 이미 성공한 요청은
    // 이벤트 상태와 무관하게 그때의 응답을 받아야 한다.
    const replayed = await this.idempotency.findCompleted(ref);
    if (replayed) return replayed.body;

    // 라우팅용 사전 조회. 여기서 얻은 값으로 판단하는 것은 **어느 경로로 갈지**와
    // **자문 락을 잡을지** 둘뿐이고, 실제 가드는 전부 트랜잭션 안 WHERE 절에 있다.
    // 모드를 잘못 읽어도 Application 의 (eventId, eventMode) 복합 FK 가 잘못된 행을 거부한다.
    const preview = await this.prisma.event.findFirst({
      where: { id: dto.eventId, deletedAt: null },
      select: {
        mode: true,
        applyEndAt: true,
        softCloseEnabled: true,
        softCloseWindowMinutes: true,
        softCloseMaxExtensions: true,
        softCloseExtensionCount: true,
      },
    });

    if (!preview) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    const result = await this.prisma.$transaction(async (tx) => {
      const wantsSoftClose =
        preview.mode === EventMode.BID && mayAttemptSoftClose(preview, new Date());

      // IC-02 의 락 순서: 자문 락 → Event → Application → Deposit.
      // 연장을 시도할 트랜잭션만 이 락을 잡는다 — 이유는 mayAttemptSoftClose 주석에 적어뒀다.
      if (wantsSoftClose) await lockSoftCloseChain(tx, dto.eventId);

      const event =
        preview.mode === EventMode.BID
          ? await lockEventForApply(tx, dto.eventId)
          : await readEventForInstantApply(tx, dto.eventId);

      const replay = await this.idempotency.claim(tx, ref);
      if (replay) return replay.body;

      const amount = this.resolveAmount(event, dto.amount);
      const gate = planInitialDeposit(event, amount);
      const needsHold = gate.shortfall > 0;

      // 부족분이 남은 신청은 아직 유효하지 않으므로 마감을 늘리지 못한다(D-08).
      // Event 를 다시 만지는 문장이라 Application INSERT 보다 **앞**에 둔다 —
      // 그래야 락 획득 순서가 Event → Application → Deposit 하나로 유지된다(IC-02).
      // 뒤이은 INSERT 가 실패하면(이미 신청함) 이 연장도 함께 롤백된다.
      const softClose =
        wantsSoftClose && !needsHold
          ? await tryExtendSoftClose(tx, event.id, user.id)
          : undefined;

      const applicationId = await this.insertApplication(tx, {
        user,
        event,
        amount,
        needsHold,
        requiredAmount: gate.required,
        agreedTermsVersion: dto.agreedTermsVersion ?? null,
      });

      // 자리 점유가 홀드보다 먼저다. 락 순서(Event → Application → Deposit)를 지키기도 하고,
      // 정원이 이미 찼다면 홀드를 만들 이유 자체가 없다. 예약금을 아직 안 냈어도 자리는 잡는다 —
      // D-05 가 정한 "모드 A 는 잡아둔 자리를 유지"가 그 뜻이고, 미납 시 만료가 반환한다.
      if (event.mode === EventMode.INSTANT) {
        await claimInstantSlot(tx, applicationId, event.id);
      }

      const depositId = needsHold
        ? await openDepositHold(tx, {
            applicationId,
            eventId: event.id,
            userId: user.id,
            reason: DepositReason.INITIAL,
            policy: event,
            basisAmount: amount,
            requiredAmount: gate.required,
            amountDue: gate.shortfall,
            paymentEnabled: this.paymentEnabled,
          })
        : null;

      await insertBidHistory(tx, {
        applicationId,
        eventId: event.id,
        userId: user.id,
        source: BidSource.INITIAL_APPLY,
        previousAmount: null,
        newAmount: amount,
        depositRequiredAfter: gate.required,
        depositId,
        softClose,
        idempotencyKey: ctx.idempotencyKey,
        ipHash: hashIp(ctx.ip),
      });

      const body = await this.finishApplication(tx, {
        applicationId,
        event,
        userId: user.id,
        amount,
        needsHold,
        requiredAmount: gate.required,
        depositId,
        softClose,
        firstTime: true,
      });

      await this.idempotency.complete(tx, ref, HttpStatus.CREATED, body);
      return body;
    }, APPLICATION_TX_OPTIONS);

    return result;
  }

  /**
   * 취소 후 재신청. (IC-14 / D-06)
   *
   * ★ 재신청은 **새 시계를 받는다**. 취소 이전의 `lastBidAt` 을 돌려주지 않는 것이 이 규칙의 전부다.
   * D-04 의 2순위 키는 오름차순 — 먼저 부른 사람이 이긴다 — 이므로 이른 `lastBidAt` 은 자산이다.
   * 옛 값을 이어주면 취소로 예약금 의무나 롤백을 회피한 사람이 그 자산을 그대로 들고 돌아온다.
   *
   * 레이트리밋을 서비스 검사가 아니라 UPDATE 의 WHERE 절에 넣는 이유: 서비스에서 보면
   * 동시에 도착한 두 요청이 같이 통과한다. 재신청마다 `depositDueAt` 이 새로 열리므로
   * 상한이 없으면 취소·재신청을 반복해 예약금을 영원히 미루면서 INSTANT 자리를 잡았다 놨다 할 수 있다.
   */
  async reapply(
    user: AuthenticatedUser,
    applicationId: string,
    dto: ReapplyDto,
    ctx: RequestContext,
  ) {
    const ref = {
      userId: user.id,
      endpoint: IdempotencyEndpoint.reapply(applicationId),
      key: ctx.idempotencyKey,
      requestHash: this.idempotency.hashRequest(dto),
    };

    const replayed = await this.idempotency.findCompleted(ref);
    if (replayed) return replayed.body;

    const current = await this.prisma.application.findFirst({
      where: { id: applicationId, userId: user.id },
      select: {
        id: true,
        eventId: true,
        eventMode: true,
        status: true,
        amount: true,
        version: true,
        depositPaidAmount: true,
        depositRefundedAmount: true,
        lastCanceledAt: true,
        event: {
          select: {
            mode: true,
            applyEndAt: true,
            softCloseEnabled: true,
            softCloseWindowMinutes: true,
            softCloseMaxExtensions: true,
            softCloseExtensionCount: true,
          },
        },
      },
    });

    if (!current) throw new NotFoundException('신청 내역을 찾을 수 없습니다.');

    if (current.status !== ApplicationStatus.CANCELED) {
      throw stateChanged('APPLICATION_NOT_CANCELED', '취소된 신청만 다시 신청할 수 있습니다.');
    }

    // 쿨다운은 아래 WHERE 절이 실제로 강제한다. 여기서 미리 보는 것은 **문구를 위한 것**이다 —
    // 몇 분 남았는지 알려주지 않으면 사용자는 이유도 모른 채 계속 재시도한다.
    orThrow(canReapply(current.lastCanceledAt, new Date()));

    return this.prisma.$transaction(async (tx) => {
      const wantsSoftClose =
        current.eventMode === EventMode.BID && mayAttemptSoftClose(current.event, new Date());

      if (wantsSoftClose) await lockSoftCloseChain(tx, current.eventId);

      const event =
        current.eventMode === EventMode.BID
          ? await lockEventForApply(tx, current.eventId)
          : await readEventForInstantApply(tx, current.eventId);

      const replay = await this.idempotency.claim(tx, ref);
      if (replay) return replay.body;

      const amount = this.resolveAmount(event, dto.amount);

      // 취소 시점에 환불이 집행되지 않았다면 그때 낸 예약금은 여전히 담보다.
      // 이미 낸 돈을 다시 받으면 재신청이 부당하게 비싸진다.
      const paid = fundedAmount(current);
      const gate = planInitialDeposit(event, amount, paid);
      const needsHold = gate.shortfall > 0;

      // 신청과 같은 이유로 Event 를 먼저 만진다(IC-02). 재신청은 새 홀드를 열므로
      // 대개 부족분이 남고, 그러면 연장 자격이 없다.
      const softClose =
        wantsSoftClose && !needsHold ? await tryExtendSoftClose(tx, event.id, user.id) : undefined;

      await this.updateForReapply(tx, {
        applicationId,
        expectedVersion: current.version,
        event,
        amount,
        needsHold,
        requiredAmount: gate.required,
        paid,
      });

      if (event.mode === EventMode.INSTANT) {
        // 점유는 `slotClaimed = false` 인 행에만 걸린다. 재시도된 재신청이 카운터를
        // 두 번 올려 좌석을 영구 소멸시키는 것을 막는 유일한 장치다(IC-15).
        await claimInstantSlot(tx, applicationId, event.id);
      }

      const depositId = needsHold
        ? await openDepositHold(tx, {
            applicationId,
            eventId: event.id,
            userId: user.id,
            reason: DepositReason.REAPPLY,
            policy: event,
            basisAmount: amount,
            requiredAmount: gate.required,
            amountDue: gate.shortfall,
            paymentEnabled: this.paymentEnabled,
          })
        : null;

      await insertBidHistory(tx, {
        applicationId,
        eventId: event.id,
        userId: user.id,
        source: BidSource.REAPPLY,
        previousAmount: current.amount,
        newAmount: amount,
        depositRequiredAfter: gate.required,
        depositId,
        softClose,
        idempotencyKey: ctx.idempotencyKey,
        ipHash: hashIp(ctx.ip),
      });

      const body = await this.finishApplication(tx, {
        applicationId,
        event,
        userId: user.id,
        amount,
        needsHold,
        requiredAmount: gate.required,
        depositId,
        softClose,
        firstTime: false,
      });

      await this.idempotency.complete(tx, ref, HttpStatus.OK, body);
      return body;
    }, APPLICATION_TX_OPTIONS);
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 신청 금액을 정한다.
   *
   * INSTANT 는 클라이언트가 금액을 정하지 않는다 — 이벤트의 고정 금액을 서버가 복사한다.
   * 범위를 열어두면 "선착순인데 금액이 제각각"이 되어 즉시확정의 의미가 사라진다(D-02).
   */
  private resolveAmount(event: EventApplyContext, requested: number | undefined): number {
    if (event.mode === EventMode.INSTANT) {
      if (event.fixedAmount === null) {
        throw stateChanged('EVENT_AMOUNT_MISSING', '이벤트의 금액 설정이 올바르지 않습니다.');
      }
      return event.fixedAmount;
    }

    if (requested === undefined) {
      throw new BadRequestException({
        code: 'AMOUNT_REQUIRED',
        message: '신청 금액을 입력해 주세요.',
      });
    }

    if (event.minAmount === null || event.maxAmount === null) {
      throw stateChanged('EVENT_AMOUNT_MISSING', '이벤트의 금액 설정이 올바르지 않습니다.');
    }

    const rule: AmountRule = { min: event.minAmount, max: event.maxAmount };
    orThrow(validateBidAmount(rule, requested));

    // 호가 단위. 진짜 강제는 INSERT 문의 WHERE 절에 있고(그래야 이벤트가 그 사이에 바뀌어도 안전하다),
    // 여기서 먼저 보는 것은 **문구를 위한 것**이다 — WHERE 에서 걸리면 "정책이 바뀌었다"고만 답하게 된다.
    if ((requested - event.minAmount) % event.amountStep !== 0) {
      throw new BadRequestException({
        code: 'AMOUNT_STEP_MISMATCH',
        message: `금액은 ${event.minAmount.toLocaleString('ko-KR')}원부터 ${event.amountStep.toLocaleString('ko-KR')}원 단위로 입력해 주세요.`,
      });
    }

    return requested;
  }

  /**
   * 신청 1행을 만든다. 휴대폰 인증 검사는 **같은 문장 안**에 있다. (IC-18)
   *
   * 구글 가입은 무제한이고 `user_phone_uq` 는 인증된 행에만 걸리는 부분 유니크라,
   * 미인증 계정은 얼마든지 만들 수 있다. `application_event_user_uq` 가 보장하는 것은
   * "1인 1신청"이 아니라 "1계정 1신청"뿐이다 — 그 차이를 메우는 것이 이 술어다.
   *
   * `policyVersion` 일치를 거는 이유: 우리가 예약금·금액을 계산한 근거가 그 사이에 바뀌었으면
   * 계산 결과도 무효다. 조용히 낡은 금액으로 신청을 만드는 대신 409 로 되돌린다.
   *
   * 예약금이 필요 없는 신청은 **INSERT 에서부터** `settledAmount = amount` 여야 한다 —
   * `app_settled_amount_chk` 는 즉시 검사되므로 뒤에서 UPDATE 로 고치는 2단계 흐름이 막힌다.
   */
  private async insertApplication(
    tx: Tx,
    input: {
      user: AuthenticatedUser;
      event: EventApplyContext;
      amount: number;
      needsHold: boolean;
      requiredAmount: number;
      agreedTermsVersion: string | null;
    },
  ): Promise<string> {
    const { event, amount, needsHold } = input;
    const applicationId = randomUUID();

    const status = needsHold ? ApplicationStatus.PENDING_DEPOSIT : settledStatusFor(event.mode);
    const depositStatus = needsHold ? DepositStatus.PENDING : DepositStatus.NOT_REQUIRED;
    const requiredAmount = needsHold ? input.requiredAmount : 0;
    const settledAmount = needsHold ? 0 : amount;

    const amountGuard =
      event.mode === EventMode.INSTANT
        ? Prisma.sql`AND e."fixedAmount" = ${amount}::int`
        : Prisma.sql`AND e."minAmount" <= ${amount}::int AND e."maxAmount" >= ${amount}::int`;

    let inserted = 0;

    try {
      inserted = await tx.$executeRaw(Prisma.sql`
        INSERT INTO "Application"
          ("id","eventId","userId","eventMode","status","amount",
           "lastBidAt","firstAppliedAt","settledAmount","settledLastBidAt","highestAmountEver",
           "depositStatus","depositDueAt","depositRequiredAmount","depositPaidAmount",
           "policyVersion","slotClaimed","agreedTermsVersion","confirmedAt","updatedAt")
        SELECT
          ${applicationId}::text, e.id, u.id, e.mode,
          ${status}::"ApplicationStatus", ${amount}::int,
          now(), now(), ${settledAmount}::int, now(), ${amount}::int,
          ${depositStatus}::"DepositStatus",
          CASE WHEN ${needsHold}::boolean
               THEN now() + make_interval(mins => ${event.depositWindowMinutes}::int)
               ELSE NULL END,
          ${requiredAmount}::int, 0,
          e."policyVersion", false, ${input.agreedTermsVersion}::text,
          CASE WHEN ${status}::"ApplicationStatus" = 'CONFIRMED' THEN now() ELSE NULL END,
          now()
        FROM "User" u
        JOIN "Event" e
          ON e.id = ${event.id}
         AND e.mode = ${event.mode}::"EventMode"
         AND e."policyVersion" = ${event.policyVersion}
         AND (${amount}::int - COALESCE(e."minAmount", 0)) % e."amountStep" = 0
         ${amountGuard}
        WHERE u.id = ${input.user.id}
          AND u."phoneVerifiedAt" IS NOT NULL
          AND u."deletedAt" IS NULL
          AND u."anonymizedAt" IS NULL
          AND u.status = 'ACTIVE'
      `);
    } catch (error) {
      if (isUniqueViolation(error, 'application_event_user_uq')) {
        throw stateChanged(
          'ALREADY_APPLIED',
          '이미 신청한 이벤트입니다. 금액을 올리려면 재입찰을 이용해 주세요.',
        );
      }
      throw error;
    }

    if (inserted !== 1) await this.explainInsertFailure(tx, input.user.id);

    return applicationId;
  }

  /**
   * 0행의 이유를 갈라낸다.
   *
   * 조건부 쓰기의 0행은 그 자체로는 "전제가 깨졌다"밖에 말해주지 않는데(IC-01),
   * 사용자 입장에서 "휴대폰 인증을 하세요"와 "이벤트 정책이 바뀌었으니 다시 조회하세요"는
   * 해야 할 행동이 전혀 다르다. 그래서 진단 SELECT 는 **쓰기 경로 밖**에서 한 번만 돈다.
   */
  private async explainInsertFailure(tx: Tx, userId: string): Promise<never> {
    const account = await tx.user.findUnique({
      where: { id: userId },
      select: { phoneVerifiedAt: true, status: true, deletedAt: true, anonymizedAt: true },
    });

    if (!account || account.deletedAt || account.anonymizedAt || account.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: '이용할 수 없는 계정입니다.',
      });
    }

    if (account.phoneVerifiedAt === null) {
      throw new ForbiddenException({
        code: 'PHONE_VERIFICATION_REQUIRED',
        message: '신청하려면 휴대폰 인증이 필요합니다.',
      });
    }

    throw stateChanged(
      'EVENT_POLICY_CHANGED',
      '이벤트 조건이 변경되었습니다. 다시 조회한 뒤 신청해 주세요.',
    );
  }

  /**
   * 재신청 UPDATE. IC-14 의 술어를 그대로 쓰고 `version` 을 하나 더 건다.
   *
   * version 을 추가한 이유: 예약금 누계(`depositPaidAmount`)를 트랜잭션 밖에서 읽어 부족분을
   * 계산했으므로, 그 사이에 다른 요청이 신청을 건드렸다면 우리가 계산한 금액은 이미 낡았다.
   * 모든 신청 변경이 version 을 올리므로 이 한 조건이 그 전부를 덮는다.
   */
  private async updateForReapply(
    tx: Tx,
    input: {
      applicationId: string;
      expectedVersion: number;
      event: EventApplyContext;
      amount: number;
      needsHold: boolean;
      requiredAmount: number;
      paid: number;
    },
  ): Promise<void> {
    const { event, amount, needsHold, paid } = input;

    const status = needsHold ? ApplicationStatus.PENDING_DEPOSIT : settledStatusFor(event.mode);
    const depositStatus = needsHold
      ? DepositStatus.PENDING
      : paid > 0
        ? DepositStatus.PAID
        : DepositStatus.NOT_REQUIRED;

    const affected = await tx.$executeRaw`
      UPDATE "Application" a SET
        status              = ${status}::"ApplicationStatus",
        "amount"            = ${amount}::int,
        -- ★ 새 시계. 옛 시계를 돌려주지 않는 것이 D-06 이다.
        "lastBidAt"         = now(),
        "highestAmountEver" = GREATEST(a."highestAmountEver", ${amount}::int),
        -- 부족분이 남으면 settled* 는 롤백 목표라 건드리지 않는다. 완납이면 새 금액이 곧 담보다.
        "settledAmount"     = CASE WHEN ${needsHold}::boolean
                                   THEN LEAST(a."settledAmount", ${amount}::int)
                                   ELSE ${amount}::int END,
        "settledLastBidAt"  = CASE WHEN ${needsHold}::boolean THEN a."settledLastBidAt" ELSE now() END,
        "depositStatus"     = ${depositStatus}::"DepositStatus",
        "depositDueAt"      = CASE WHEN ${needsHold}::boolean
                                   THEN now() + make_interval(mins => ${event.depositWindowMinutes}::int)
                                   ELSE NULL END,
        "depositRequiredAmount" = ${needsHold ? input.requiredAmount : 0}::int,
        "policyVersion"     = ${event.policyVersion},
        "confirmedAt"       = CASE WHEN ${status}::"ApplicationStatus" = 'CONFIRMED'
                                   THEN COALESCE(a."confirmedAt", now()) ELSE a."confirmedAt" END,
        "cancelReason"      = NULL,
        "reapplyCount"      = a."reapplyCount" + 1,
        "lastReapplyAt"     = now(),
        "version"           = a."version" + 1,
        "updatedAt"         = now()
      WHERE a.id = ${input.applicationId}
        AND a."version" = ${input.expectedVersion}
        AND a.status = 'CANCELED'
        -- 하향 재진입 차단. IC-12 와 같은 하한이다 — amount 만 보면 롤백으로 내려간 값이 새 바닥이 된다.
        AND a."highestAmountEver" <= ${amount}::int
        AND (a."lastReapplyAt"  IS NULL OR a."lastReapplyAt"  <= now() - interval '10 minutes')
        AND (a."lastCanceledAt" IS NULL OR a."lastCanceledAt" <= now() - interval '10 minutes')
    `;

    if (affected !== 1) await this.explainReapplyFailure(tx, input.applicationId, amount);
  }

  /** 429(레이트리밋)와 409(상태·하한 충돌)를 갈라낸다. 쓰기 경로 밖에서만 돈다(IC-14). */
  private async explainReapplyFailure(
    tx: Tx,
    applicationId: string,
    amount: number,
  ): Promise<never> {
    const row = await tx.application.findUnique({
      where: { id: applicationId },
      select: { status: true, highestAmountEver: true, lastCanceledAt: true, lastReapplyAt: true },
    });

    if (!row) throw new NotFoundException('신청 내역을 찾을 수 없습니다.');

    if (row.status !== ApplicationStatus.CANCELED) {
      throw stateChanged('APPLICATION_NOT_CANCELED', '취소된 신청만 다시 신청할 수 있습니다.');
    }

    if (row.highestAmountEver > amount) {
      throw stateChanged(
        'REAPPLY_BELOW_HIGHEST',
        `이전에 ${row.highestAmountEver.toLocaleString('ko-KR')}원까지 부르셨습니다. 그보다 낮은 금액으로는 다시 신청할 수 없습니다.`,
      );
    }

    // 두 시계를 모두 본다. 취소 직후 쿨다운과 "재신청 자체의 10분 간격"은 서로 다른 제한이고,
    // 후자가 없으면 취소 없이 재신청만 반복하는 경로로 depositDueAt 을 무한히 갱신할 수 있다.
    orThrow(canReapply(row.lastCanceledAt, new Date()));

    const reapplyCooldown = canReapply(row.lastReapplyAt, new Date());
    if (!reapplyCooldown.ok) {
      throw new HttpException(
        {
          code: 'REAPPLY_RATE_LIMITED',
          message: `재신청은 ${REAPPLY_COOLDOWN_MINUTES}분에 한 번만 할 수 있습니다.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw stateChanged('APPLICATION_STATE_CHANGED', '신청 상태가 변경되었습니다. 다시 조회해 주세요.');
  }

  /**
   * 알림 아웃박스를 채우고 응답을 만든다. (IC-42 / IC-44)
   *
   * 문구에 들어가는 금액은 **본인이 낼 예약금**뿐이다. 그건 본인 정보라 공개해도 되지만,
   * 타인의 금액·커트라인·본인 순위는 어떤 알림에도 들어갈 수 없다(D-07).
   * `enqueueNotification` 이 payload 를 스캔해서 그 규칙을 강제한다.
   */
  private async finishApplication(
    tx: Tx,
    input: {
      applicationId: string;
      event: EventApplyContext;
      userId: string;
      amount: number;
      needsHold: boolean;
      requiredAmount: number;
      depositId: string | null;
      softClose: SoftCloseOutcome | undefined;
      firstTime: boolean;
    },
  ) {
    const { applicationId, event, userId } = input;

    const title = await tx.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { title: true },
    });

    const deepLinkPath = `/my/applications/${applicationId}`;
    const basePayload = { eventId: event.id, applicationId, eventTitle: title.title };

    if (input.firstTime) {
      await enqueueNotification(tx, {
        userId,
        type: NotificationType.APPLICATION_RECEIVED,
        category: NotificationCategory.APPLICATION,
        titleKo: '신청이 접수되었습니다',
        bodyKo: `'${title.title}' 신청이 접수되었습니다.`,
        payload: basePayload,
        deepLinkPath,
        eventId: event.id,
        applicationId,
        dedupeKey: `APPLICATION_RECEIVED:${applicationId}`,
        email: {
          subjectKo: `[Dibs] '${title.title}' 신청이 접수되었습니다`,
          bodyText: `'${title.title}' 신청이 접수되었습니다. 자세한 내용은 마이페이지에서 확인해 주세요.`,
        },
      });
    }

    if (input.needsHold && input.depositId) {
      const due = await tx.deposit.findUniqueOrThrow({
        where: { id: input.depositId },
        select: { dueAt: true, amountDue: true },
      });

      // 예약금은 순위가 아니라 자격 요건이다(D-05). 이 알림을 못 받으면 자리와 돈을 동시에 잃으므로
      // DEPOSIT 범주는 옵트아웃 불가 필수 범주다(IC-44) — 우선순위도 HIGH 로 올린다.
      await enqueueNotification(tx, {
        userId,
        type: NotificationType.DEPOSIT_REQUIRED,
        category: NotificationCategory.DEPOSIT,
        priority: NotificationPriority.HIGH,
        titleKo: '예약금을 입금해 주세요',
        bodyKo: `'${title.title}' 신청을 유효하게 하려면 ${due.amountDue.toLocaleString('ko-KR')}원을 ${event.depositWindowMinutes}분 안에 입금해 주세요.`,
        payload: { ...basePayload, dueAt: due.dueAt, myDepositAmount: due.amountDue },
        allowKeys: OWN_DATA_KEYS,
        deepLinkPath,
        eventId: event.id,
        applicationId,
        dedupeKey: `DEPOSIT_REQUIRED:${input.depositId}`,
        email: {
          subjectKo: `[Dibs] '${title.title}' 예약금 입금 안내`,
          bodyText: `'${title.title}' 신청의 예약금 ${due.amountDue.toLocaleString('ko-KR')}원을 ${event.depositWindowMinutes}분 안에 입금해 주세요.`,
        },
      });
    } else if (event.mode === EventMode.INSTANT) {
      await enqueueNotification(tx, {
        userId,
        type: NotificationType.APPLICATION_CONFIRMED_INSTANT,
        category: NotificationCategory.APPLICATION,
        priority: NotificationPriority.HIGH,
        titleKo: '예약이 확정되었습니다',
        bodyKo: `'${title.title}' 예약이 확정되었습니다.`,
        payload: basePayload,
        deepLinkPath,
        eventId: event.id,
        applicationId,
        dedupeKey: `APPLICATION_CONFIRMED_INSTANT:${applicationId}`,
        email: {
          subjectKo: `[Dibs] '${title.title}' 예약이 확정되었습니다`,
          bodyText: `'${title.title}' 예약이 확정되었습니다.`,
        },
      });
    }

    if (input.softClose?.extended) {
      this.logger.log(
        `소프트 클로즈 연장: event=${event.id} → ${input.softClose.deadlineAfter?.toISOString()}`,
      );
    }

    const row = await tx.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: {
        id: true,
        eventId: true,
        status: true,
        amount: true,
        depositStatus: true,
        depositDueAt: true,
        depositRequiredAmount: true,
        slotClaimed: true,
        version: true,
      },
    });

    // 응답에도 순위는 없다. `Application.finalRank` 를 스키마에서 지운 이유가 정확히
    // "이 행이 곧 응답 행이라 select 를 빠뜨린 핸들러 하나로 규칙이 깨진다"였다(D-07).
    return {
      id: row.id,
      eventId: row.eventId,
      status: row.status,
      myAmount: row.amount,
      slotHeld: row.slotClaimed,
      version: row.version,
      deposit: {
        status: row.depositStatus,
        dueAt: row.depositDueAt,
        requiredAmount: row.depositRequiredAmount,
      },
      deadlineExtendedTo: input.softClose?.extended ? input.softClose.deadlineAfter : null,
    };
  }
}
