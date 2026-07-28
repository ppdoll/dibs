/**
 * BID 순위 확정 — 금액 DESC → lastBidAt ASC → applySeq ASC. (D-04 / IC-31)
 *
 * 이 테스트가 지키는 것은 **정렬을 TS 가 하지 않는다**는 사실이다.
 * 기대 순서를 손으로 적고, 실제 순서는 RankingService 가 DB 안 `ROW_NUMBER()` 로 계산한 것을 읽는다.
 * 테스트에서 다시 정렬해 비교하면 "SQL 과 TS 가 같은 순서를 만드는가"를 검증하지 못하고,
 * 정확히 그 어긋남이 IC-04 가 경고하는 사고다.
 *
 * 동점을 두 종류로 심는다.
 *   (a) 금액만 같고 lastBidAt 이 다름  → 2순위 키(먼저 부른 사람이 이긴다)로 갈려야 한다.
 *   (b) 금액도 lastBidAt 도 **마이크로초까지** 같음 → 3순위 키(applySeq)로 갈려야 한다.
 * (b) 를 JS Date 로는 만들 수 없다 — Timestamptz(6) 리터럴을 직접 넣는 이유다.
 */
import { EventMode, EventStatus } from '@prisma/client';

import { RankingService } from '../src/selection/ranking.service';
import { describeIntegration, disconnectPrisma, getPrisma } from './helpers/integration-db';
import {
  asPrismaService,
  createEvent,
  createUsers,
  createWorld,
  destroyWorld,
  days,
  ensureIntegrationAdmin,
  insertApplication,
  microStamp,
  minutes,
  type TestWorld,
} from './helpers/fixtures';

describeIntegration('BID 순위 확정 (D-04 / IC-31)', () => {
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

  it('금액 → 그 금액에 도달한 시각 → 신청 순서 로 갈리고, 순위는 서비스가 계산한다', async () => {
    const admin = await ensureIntegrationAdmin(prisma);
    const users = await createUsers(world, 4);

    // 마감이 이미 지났고 확정 시각도 지난 이벤트. 열린 예약금 홀드는 없다(IC-26 게이트 통과).
    const eventId = await createEvent(world, {
      mode: EventMode.BID,
      status: EventStatus.CLOSED,
      capacity: 2,
      minAmount: 10_000,
      maxAmount: 1_000_000,
      applyStartAt: days(-10),
      applyEndAt: minutes(-120),
      depositWindowMinutes: 10,
    });

    // 신청 시각 기준점. IC-33 이 `firstAppliedAt < effectiveDeadlineAt(=applyEndAt)` 을 요구한다.
    const base = minutes(-300);

    // ★ 같은 밀리초, 다른 마이크로초가 아니라 **완전히 같은 순간**을 만든다.
    //   이래야 3순위 키(applySeq)가 실제로 동작하는지 볼 수 있다.
    const SAME_MOMENT = microStamp(base, '100456');
    const LATER = microStamp(minutes(-270), '000000');
    const TOP = microStamp(minutes(-290), '000000');

    const u = (i: number) => {
      const user = users[i];
      if (!user) throw new Error(`테스트 사용자 ${i} 가 없습니다.`);
      return user.id;
    };

    // 삽입 순서가 곧 applySeq 순서다(BIGSERIAL). A 를 C 보다 먼저 넣는다.
    const A = await insertApplication(prisma, {
      id: `it-app-${world.tag}-A`,
      eventId,
      userId: u(0),
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: 100_000,
      lastBidAt: SAME_MOMENT,
    });
    const C = await insertApplication(prisma, {
      id: `it-app-${world.tag}-C`,
      eventId,
      userId: u(1),
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: 100_000,
      lastBidAt: SAME_MOMENT, // A 와 마이크로초까지 동일 → applySeq 로만 갈린다
    });
    const B = await insertApplication(prisma, {
      id: `it-app-${world.tag}-B`,
      eventId,
      userId: u(2),
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: 100_000,
      lastBidAt: LATER, // 같은 금액을 늦게 불렀다 → A·C 보다 뒤
    });
    const D = await insertApplication(prisma, {
      id: `it-app-${world.tag}-D`,
      eventId,
      userId: u(3),
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: 120_000,
      lastBidAt: TOP, // 금액이 1순위 → 시각과 무관하게 1등
    });

    const ranking = new RankingService(asPrismaService(prisma));
    const opened = await ranking.openRoundManually(admin, eventId);

    expect(opened.eventId).toBe(eventId);
    expect(opened.roundNo).toBe(1);
    expect(opened.entryCount).toBe(4);
    expect(opened.eligibleCount).toBe(4);
    expect(opened.excludedCount).toBe(0);

    // 순위는 DB 가 매긴 rankNo 를 그대로 읽는다. 여기서 다시 sort 하지 않는다.
    const entries = await prisma.selectionEntry.findMany({
      where: { selectionId: opened.selectionId },
      orderBy: { rankNo: 'asc' },
      select: { applicationId: true, rankNo: true, tieOrdinal: true, withinCapacity: true },
    });

    expect(entries.map((e) => e.applicationId)).toEqual([D, A, C, B]);
    expect(entries.map((e) => e.rankNo)).toEqual([1, 2, 3, 4]);

    // (amount, lastBidAt) 이 완전히 같은 A·C 만 같은 동점 그룹이고, 그 안에서 applySeq 로 번호가 붙는다.
    const byApplication = new Map(entries.map((e) => [e.applicationId, e]));
    expect(byApplication.get(A)?.tieOrdinal).toBe(1);
    expect(byApplication.get(C)?.tieOrdinal).toBe(2);

    // 정원 2 → 상위 2명만 withinCapacity. 커트라인은 SelectionEntry 가 아니라 별도 테이블에 있다.
    expect(entries.map((e) => e.withinCapacity)).toEqual([true, true, false, false]);

    // ★ 커트라인은 SelectionCutoff 에만 쓴다(IC-35 / D-07).
    //   정원 경계(rankNo=2)가 A 이고, A 와 (금액, 시각)이 완전히 같은 C 가 정원 밖에 있으므로
    //   "3순위 키만으로 당락이 갈렸다" = hasCutoffTie 가 true 여야 한다. 파트너가 알아야 하는 사실이다.
    const cutoff = await prisma.selectionCutoff.findUniqueOrThrow({
      where: { selectionId: opened.selectionId },
      select: { cutoffAmount: true, hasCutoffTie: true },
    });
    expect(cutoff.cutoffAmount).toBe(100_000);
    expect(cutoff.hasCutoffTie).toBe(true);

    // 순위 스냅샷 해시는 DB 안에서 계산돼야 재현 가능하다(IC-04).
    const selection = await prisma.selection.findUniqueOrThrow({
      where: { id: opened.selectionId },
      select: { rankingSnapshotHash: true, status: true },
    });
    expect(selection.status).toBe('RANKING_READY');
    expect(selection.rankingSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
