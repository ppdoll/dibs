/**
 * 예약금 만료 스위퍼 — 자리 반환과 재진입 가능성. (D-05 / IC-15 / IC-24)
 *
 * 서버리스에는 상주 프로세스가 없어서 "10분 뒤 만료"를 타이머로 만들 수 없다. 크론이 지나가며
 * 따라잡고, 조회 시 지연 만료가 그 사이를 메운다. 그래서 이 코드는 **두 번 돌아도 안전해야 한다** —
 * Vercel Cron 은 at-least-once 이고, 겹쳐서 실행되며, 함수는 타임아웃으로 죽는다.
 *
 * 두 번째 실행을 "0건 처리"로 단언하지 않고 **우리 행의 스냅샷이 그대로인지**로 단언하는 이유:
 * 스위퍼의 술어는 전역(`status='PENDING' AND dueAt <= now()`)이라, 같은 DB 에 시드나 다른
 * 데이터가 있으면 두 번째 실행도 0이 아닐 수 있다. 멱등성의 정의는 "아무 일도 안 한다"가 아니라
 * **"이미 처리한 행을 다시 건드리지 않는다"** 이므로 그쪽을 본다.
 */
import { DepositReason, EventMode } from '@prisma/client';
import { RANKABLE_STATUSES } from '@dibs/shared';

import { DepositSweeperService } from '../src/selection/deposit-sweeper.service';
import { describeIntegration, disconnectPrisma, getPrisma } from './helpers/integration-db';
import {
  asPrismaService,
  createEvent,
  createUsers,
  createWorld,
  destroyWorld,
  insertApplication,
  insertDeposit,
  microStamp,
  minutes,
  type TestWorld,
} from './helpers/fixtures';

describeIntegration('예약금 만료 스위퍼 (IC-24)', () => {
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

  it('INSTANT 자리는 반환되고 BID 신청은 순위 자격을 잃는다. 두 번 돌려도 같은 행을 다시 건드리지 않는다', async () => {
    const users = await createUsers(world, 3);
    const [instantUser, bidUser, keeperUser] = users;
    if (!instantUser || !bidUser || !keeperUser) throw new Error('테스트 사용자 생성 실패');

    // ── INSTANT: 자리를 잡아둔 채 예약금 카운트다운 중인 신청 ────────────────
    const instantEventId = await createEvent(world, {
      mode: EventMode.INSTANT,
      capacity: 2,
      fixedAmount: 30_000,
      deposit: { type: 'FIXED', amount: 5_000 },
    });

    const instantAppId = await insertApplication(prisma, {
      id: `it-app-${world.tag}-instant`,
      eventId: instantEventId,
      userId: instantUser.id,
      eventMode: EventMode.INSTANT,
      status: 'PENDING_DEPOSIT',
      amount: 30_000,
      lastBidAt: microStamp(minutes(-30), '000000'),
      depositStatus: 'PENDING',
      depositRequiredAmount: 5_000,
      // D-05: 모드 A 는 예약금을 내기 전에도 자리를 붙들고 있다. 만료가 그 자리를 되돌린다.
      slotClaimed: true,
    });

    await prisma.event.update({
      where: { id: instantEventId },
      data: { claimedCount: 1 },
    });

    await insertDeposit(prisma, {
      id: `it-dep-${world.tag}-instant`,
      applicationId: instantAppId,
      eventId: instantEventId,
      userId: instantUser.id,
      reason: DepositReason.INITIAL,
      basisAmount: 30_000,
      amountDue: 5_000,
      dueInMinutes: -1, // 이미 만료
    });

    // ── BID: 예약금 미납 신청 하나 + 완납 신청 하나 ─────────────────────────
    const bidEventId = await createEvent(world, {
      mode: EventMode.BID,
      capacity: 5,
      minAmount: 10_000,
      maxAmount: 1_000_000,
      deposit: { type: 'FIXED', amount: 5_000 },
    });

    const bidAppId = await insertApplication(prisma, {
      id: `it-app-${world.tag}-bid`,
      eventId: bidEventId,
      userId: bidUser.id,
      eventMode: EventMode.BID,
      status: 'PENDING_DEPOSIT',
      amount: 200_000,
      lastBidAt: microStamp(minutes(-30), '000000'),
      depositStatus: 'PENDING',
      depositRequiredAmount: 5_000,
    });

    await insertDeposit(prisma, {
      id: `it-dep-${world.tag}-bid`,
      applicationId: bidAppId,
      eventId: bidEventId,
      userId: bidUser.id,
      reason: DepositReason.INITIAL,
      basisAmount: 200_000,
      amountDue: 5_000,
      dueInMinutes: -1,
    });

    // 완납한 사람. 만료 스윕이 이 행까지 건드리면 안 된다.
    const keeperAppId = await insertApplication(prisma, {
      id: `it-app-${world.tag}-keeper`,
      eventId: bidEventId,
      userId: keeperUser.id,
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: 90_000,
      lastBidAt: microStamp(minutes(-40), '000000'),
      depositStatus: 'PAID',
      depositRequiredAmount: 5_000,
      depositPaidAmount: 5_000,
    });

    const sweeper = new DepositSweeperService(asPrismaService(prisma));

    // ── 1회차 ────────────────────────────────────────────────────────────
    await sweeper.expireHolds();

    const instantAfter = await prisma.application.findUniqueOrThrow({
      where: { id: instantAppId },
      select: { status: true, depositStatus: true, slotClaimed: true, version: true, cancelReason: true },
    });
    expect(instantAfter.status).toBe('EXPIRED');
    // app_expired_deposit_chk 가 강제하는 한 쌍. 이게 깨지면 뒤늦은 웹훅이 신청을 되살린다.
    expect(instantAfter.depositStatus).toBe('EXPIRED');
    expect(instantAfter.slotClaimed).toBe(false);
    expect(instantAfter.cancelReason).toBe('DEPOSIT_TIMEOUT');

    const instantEventAfter = await prisma.event.findUniqueOrThrow({
      where: { id: instantEventId },
      select: { claimedCount: true, soldOutAt: true, version: true },
    });
    // ★ 자리 반환. 점유와 대칭이라 정확히 1만 내려간다(IC-15).
    expect(instantEventAfter.claimedCount).toBe(0);

    const bidAfter = await prisma.application.findUniqueOrThrow({
      where: { id: bidAppId },
      select: { status: true, depositStatus: true, version: true },
    });
    expect(bidAfter.status).toBe('EXPIRED');

    // ★ 순위 자격 술어는 status IN ('VALID','CONFIRMED') 다(IC-32).
    //   만료된 신청은 그 집합에서 빠지고, 완납한 사람만 남는다.
    const rankable = await prisma.application.findMany({
      where: { eventId: bidEventId, status: { in: [...RANKABLE_STATUSES] } },
      select: { id: true },
    });
    expect(rankable.map((r) => r.id)).toEqual([keeperAppId]);

    const holdsAfter = await prisma.deposit.findMany({
      where: { eventId: { in: [instantEventId, bidEventId] } },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, resolvedAt: true, updatedAt: true },
    });
    expect(holdsAfter.every((h) => h.status === 'EXPIRED')).toBe(true);

    // ── 2회차: 같은 행을 다시 건드리면 안 된다 (IC-24 재진입) ────────────────
    await sweeper.expireHolds();

    const instantSecond = await prisma.application.findUniqueOrThrow({
      where: { id: instantAppId },
      select: { status: true, depositStatus: true, slotClaimed: true, version: true },
    });
    const bidSecond = await prisma.application.findUniqueOrThrow({
      where: { id: bidAppId },
      select: { status: true, depositStatus: true, version: true },
    });
    const instantEventSecond = await prisma.event.findUniqueOrThrow({
      where: { id: instantEventId },
      select: { claimedCount: true, version: true },
    });
    const holdsSecond = await prisma.deposit.findMany({
      where: { eventId: { in: [instantEventId, bidEventId] } },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, resolvedAt: true, updatedAt: true },
    });

    // version 이 그대로라는 것이 "아무 UPDATE 도 나가지 않았다"의 증거다.
    expect(instantSecond).toEqual({
      status: instantAfter.status,
      depositStatus: instantAfter.depositStatus,
      slotClaimed: instantAfter.slotClaimed,
      version: instantAfter.version,
    });
    expect(bidSecond.version).toBe(bidAfter.version);
    expect(instantEventSecond.version).toBe(instantEventAfter.version);
    // ★ 여기가 핵심이다. 2회차가 자리를 한 번 더 반환하면 claimedCount 가 음수 방향으로 새고,
    //   GREATEST(...,0) 때문에 0에서 멈춰 아무도 눈치채지 못한 채 좌석 회계가 어긋난다.
    expect(instantEventSecond.claimedCount).toBe(0);
    expect(holdsSecond).toEqual(holdsAfter);

    // 롤백 대상(RAISE_SHORTFALL)이 없었으므로 그쪽 카운터는 0이어야 한다.
    const rollbackHistory = await prisma.bidHistory.count({
      where: { eventId: bidEventId, source: 'ROLLBACK' },
    });
    expect(rollbackHistory).toBe(0);
  });
});
