/**
 * 멱등성 — 같은 Idempotency-Key 로 두 번 신청해도 신청은 하나다. (IC-03)
 *
 * 이 규칙이 없을 때의 실패 경로는 돈이 나가는 쪽이다:
 *   마감 직전 요청이 네트워크에서 유실 → 클라이언트 재시도 → 첫 시도는 이미 커밋됨 →
 *   재시도는 `WHERE version=$expected` 에서 밀려 409 → 화면은 "실패"로 보여줌 →
 *   사용자가 더 높은 금액으로 다시 넣음.
 *
 * 그래서 저장소가 Postgres 여야 한다. KV 로 빼면 `claimedCount` 를 올리는 트랜잭션에 참여할 수
 * 없어서 "KV 에는 기록됐는데 DB 는 롤백된" 영구 유령 성공이 만들어진다.
 * 이 테스트는 그 트랜잭션 결합을 **행 개수 1** 과 **응답 재생**으로 확인한다.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { EventMode } from '@prisma/client';

import { ApplicationApplyService } from '../src/applications/application-apply.service';
import { IdempotencyService } from '../src/applications/internal/idempotency.service';
import { describeIntegration, disconnectPrisma, getPrisma } from './helpers/integration-db';
import {
  asPrismaService,
  createEvent,
  createUsers,
  createWorld,
  destroyWorld,
  testConfig,
  type TestWorld,
} from './helpers/fixtures';

describeIntegration('신청 멱등성 (IC-03)', () => {
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

  it('같은 키로 두 번 부르면 Application 은 1행이고 두 번째는 첫 응답을 그대로 재생한다', async () => {
    const [user] = await createUsers(world, 1);
    if (!user) throw new Error('테스트 사용자 생성 실패');

    const eventId = await createEvent(world, {
      mode: EventMode.INSTANT,
      capacity: 5,
      fixedAmount: 30_000,
    });

    const applyService = new ApplicationApplyService(
      asPrismaService(prisma),
      new IdempotencyService(asPrismaService(prisma)),
      testConfig(),
    );

    const key = `it-idem-${world.tag}`;
    const first = await applyService.apply(user, { eventId }, { idempotencyKey: key, ip: '10.0.0.9' });
    const second = await applyService.apply(user, { eventId }, { idempotencyKey: key, ip: '10.0.0.9' });

    // (1) 신청은 정확히 하나다.
    const applications = await prisma.application.findMany({
      where: { eventId },
      select: { id: true, status: true, slotClaimed: true },
    });
    expect(applications).toHaveLength(1);
    expect(applications[0]?.status).toBe('CONFIRMED');

    // (2) 자리도 한 번만 잡혔다. 재생이 카운터를 두 번 올리면 그 좌석은 영구 소멸한다(IC-15).
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { claimedCount: true },
    });
    expect(event.claimedCount).toBe(1);

    // (3) 두 번째 응답은 저장된 첫 응답의 재생이다.
    //     JSONB 왕복이라 Date 는 ISO 문자열이 된다 — HTTP 로 나갈 때도 어차피 문자열이라
    //     클라이언트가 보는 모양은 같다. 그래서 비교도 JSON 왕복 뒤에 한다.
    expect(second).toEqual(JSON.parse(JSON.stringify(first)));

    // (4) 멱등 레코드는 도메인 쓰기와 같은 트랜잭션에서 봉인됐다.
    const record = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        userId_endpoint_key: { userId: user.id, endpoint: 'POST /applications', key },
      },
      select: { completedAt: true, responseStatus: true },
    });
    expect(record.completedAt).not.toBeNull();
    expect(record.responseStatus).toBe(HttpStatus.CREATED);
  });

  it('같은 키에 다른 본문이 오면 재생이 아니라 키 재사용이다 — 422', async () => {
    const [user] = await createUsers(world, 1);
    if (!user) throw new Error('테스트 사용자 생성 실패');

    const eventId = await createEvent(world, {
      mode: EventMode.BID,
      capacity: 5,
      minAmount: 10_000,
      maxAmount: 100_000,
    });

    const applyService = new ApplicationApplyService(
      asPrismaService(prisma),
      new IdempotencyService(asPrismaService(prisma)),
      testConfig(),
    );

    const key = `it-idem-conflict-${world.tag}`;
    await applyService.apply(
      user,
      { eventId, amount: 20_000 },
      { idempotencyKey: key, ip: '10.0.0.9' },
    );

    // 409(재시도하면 풀림)가 아니라 422 여야 한다. 클라이언트가 키를 새로 만들어야 하는 상황이다.
    let caught: unknown;
    try {
      await applyService.apply(
        user,
        { eventId, amount: 30_000 },
        { idempotencyKey: key, ip: '10.0.0.9' },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);

    const applications = await prisma.application.count({ where: { eventId } });
    expect(applications).toBe(1);
  });
});
