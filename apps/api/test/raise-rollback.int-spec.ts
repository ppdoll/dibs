/**
 * 상향 후 차액 미납 → 금액과 시각을 **쌍으로** 롤백한다. (D-06 / IC-23)
 *
 * 여기서 무너지면 무슨 일이 벌어지나:
 *   - 아무것도 안 하면 "올려놓고 차액은 안 내기"가 영구 이득이 된다. 돈 한 푼 더 안 내고
 *     순위만 올라간 채로 마감을 맞는다.
 *   - 신청을 통째로 무효화하면 이미 완납했던 금액까지 잃는다. 소비자 보호 실패다.
 *   - 금액만 되돌리고 lastBidAt 을 그대로 두면 **존재한 적 없는 (금액, 시각) 조합**이 복원된다.
 *     그 조합이 만든 순위는 어떤 이력으로도 설명할 수 없다 — D-04 가 정의되지 않는 상태다.
 *
 * 그래서 세 가지를 함께 본다: 금액·시각이 쌍으로 돌아왔는가 / 신청이 살아 있는가 /
 * `highestAmountEver` 는 **안** 돌아갔는가(그게 IC-12 의 재상향 하한이다).
 */
import { DepositReason, EventMode } from '@prisma/client';

import { ApplicationBiddingService } from '../src/applications/application-bidding.service';
import { IdempotencyService } from '../src/applications/internal/idempotency.service';
import { DepositSweeperService } from '../src/selection/deposit-sweeper.service';
import { describeIntegration, disconnectPrisma, getPrisma } from './helpers/integration-db';
import {
  asPrismaService,
  createEvent,
  createUsers,
  createWorld,
  destroyWorld,
  insertApplication,
  microStamp,
  minutes,
  testConfig,
  type TestWorld,
} from './helpers/fixtures';

const FUNDED_AMOUNT = 100_000;
const RAISED_AMOUNT = 150_000;
/** 정률 10% → 완납 10,000원, 상향 후 요구 15,000원, 부족분 5,000원. */
const PERCENT_BP = 1_000;

describeIntegration('상향 차액 미납 롤백 (D-06 / IC-23)', () => {
  const prisma = getPrisma();
  let world: TestWorld;

  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    world = await createWorld(prisma);
  });

  afterEach(async () => {
    await destroyWorld(world);
  });

  it('차액 창이 지나면 amount 와 lastBidAt 이 쌍으로 되돌아가고, 신청은 VALID 로 남는다', async () => {
    const [user] = await createUsers(world, 1);
    if (!user) throw new Error('테스트 사용자 생성 실패');

    const eventId = await createEvent(world, {
      mode: EventMode.BID,
      capacity: 5,
      minAmount: 50_000,
      maxAmount: 300_000,
      amountStep: 1_000,
      deposit: { type: 'PERCENT', bp: PERCENT_BP },
      depositWindowMinutes: 10,
    });

    // 이미 10,000원을 완납한 유효 신청. settledAmount / settledLastBidAt 이 곧 롤백 목표다.
    const settledStamp = microStamp(minutes(-60), '123456');
    const applicationId = await insertApplication(prisma, {
      id: `it-app-${world.tag}-raise`,
      eventId,
      userId: user.id,
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: FUNDED_AMOUNT,
      lastBidAt: settledStamp,
      depositStatus: 'PAID',
      depositRequiredAmount: 10_000,
      depositPaidAmount: 10_000,
    });

    const before = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { settledAmount: true, settledLastBidAt: true, lastBidAt: true },
    });
    expect(before.settledAmount).toBe(FUNDED_AMOUNT);

    const bidding = new ApplicationBiddingService(
      asPrismaService(prisma),
      new IdempotencyService(asPrismaService(prisma)),
      testConfig(),
    );

    // ── 상향 ──────────────────────────────────────────────────────────────
    await bidding.raise(
      user,
      applicationId,
      { amount: RAISED_AMOUNT },
      { idempotencyKey: `it-raise-${world.tag}`, ip: '10.0.0.1' },
    );

    const raised = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: {
        amount: true,
        lastBidAt: true,
        settledAmount: true,
        settledLastBidAt: true,
        highestAmountEver: true,
        status: true,
        depositStatus: true,
      },
    });

    expect(raised.amount).toBe(RAISED_AMOUNT);
    expect(raised.status).toBe('VALID');
    // ★ 부족분이 남은 상향은 settled* 를 건드리지 않는다. 그게 롤백 목표이기 때문이다(IC-21 주석).
    expect(raised.settledAmount).toBe(FUNDED_AMOUNT);
    expect(raised.settledLastBidAt.getTime()).toBe(before.settledLastBidAt.getTime());
    // 열린 홀드의 status 는 언제나 PENDING 이고, 부족분이라는 사실은 신청 쪽 사본만 표현한다(IC-22).
    expect(raised.depositStatus).toBe('SHORTFALL_PENDING');
    expect(raised.lastBidAt.getTime()).toBeGreaterThan(before.lastBidAt.getTime());

    const shortfallHold = await prisma.deposit.findFirstOrThrow({
      where: { applicationId, status: 'PENDING' },
      select: { id: true, reason: true, amountDue: true },
    });
    expect(shortfallHold.reason).toBe(DepositReason.RAISE_SHORTFALL);
    // 15,000(상향 후 요구) - 10,000(이미 낸 돈) = 5,000
    expect(shortfallHold.amountDue).toBe(5_000);

    // ── 차액 창을 넘긴다 ──────────────────────────────────────────────────
    // 실제로 10분을 기다릴 수는 없으므로 시계를 과거로 민다. 스위퍼는 Deposit.dueAt 만 본다.
    //
    // ★ dueAt 만 밀면 안 된다. deposit_window_chk 가 `"dueAt" > "openedAt"` 을 요구하므로
    //   만기만 과거로 보내면 23514 로 거절당한다. openedAt 도 같이 밀어서 "창이 열렸고
    //   그 창이 이미 닫혔다"는, 실제로 일어날 수 있는 배치를 만든다.
    await prisma.$executeRaw`
      UPDATE "Deposit"
         SET "openedAt" = now() - interval '11 minutes',
             "dueAt"    = now() - interval '1 minute'
       WHERE id = ${shortfallHold.id}
    `;
    await prisma.$executeRaw`
      UPDATE "Application" SET "depositDueAt" = now() - interval '1 minute' WHERE id = ${applicationId}
    `;

    const sweeper = new DepositSweeperService(asPrismaService(prisma));
    await sweeper.expireHolds();

    // ── 롤백 결과 ─────────────────────────────────────────────────────────
    const rolled = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: {
        amount: true,
        lastBidAt: true,
        settledAmount: true,
        settledLastBidAt: true,
        highestAmountEver: true,
        status: true,
        depositStatus: true,
      },
    });

    // ★ 쌍으로 돌아왔다. 둘 중 하나만 맞으면 그건 롤백이 아니라 새로운 버그다.
    expect(rolled.amount).toBe(FUNDED_AMOUNT);
    expect(rolled.lastBidAt.getTime()).toBe(before.settledLastBidAt.getTime());

    // 신청은 무효화되지 않는다. 완납했던 금액까지 잃게 하면 부당하다(D-06).
    expect(rolled.status).toBe('VALID');
    expect(rolled.depositStatus).toBe('PAID');

    // ★ highestAmountEver 는 되돌리지 않는다. 되돌리면 "올렸다 안 내기"를 반복해
    //   재상향 하한을 계속 리셋할 수 있게 된다(IC-12).
    expect(rolled.highestAmountEver).toBe(RAISED_AMOUNT);

    // ── 이력 ─────────────────────────────────────────────────────────────
    // restoredLastBidAt 이 없으면 "왜 내 순위가 내려갔나" 문의에 답할 근거가 아무 데도 없다.
    const rollbackRow = await prisma.bidHistory.findFirstOrThrow({
      where: { applicationId, source: 'ROLLBACK' },
      select: {
        previousAmount: true,
        newAmount: true,
        deltaAmount: true,
        restoredLastBidAt: true,
      },
    });
    expect(rollbackRow.previousAmount).toBe(RAISED_AMOUNT);
    expect(rollbackRow.newAmount).toBe(FUNDED_AMOUNT);
    // bid_history_delta_direction_chk: ROLLBACK 은 반드시 음수다.
    expect(rollbackRow.deltaAmount).toBe(FUNDED_AMOUNT - RAISED_AMOUNT);
    expect(rollbackRow.restoredLastBidAt?.getTime()).toBe(before.settledLastBidAt.getTime());

    // 홀드는 닫혔고, 같은 신청에 열린 홀드가 남아 있으면 안 된다(one_open_deposit).
    const openHolds = await prisma.deposit.count({ where: { applicationId, status: 'PENDING' } });
    expect(openHolds).toBe(0);
  });
});
