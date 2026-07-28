/**
 * INSTANT 동시 신청 — 정원을 넘겨 팔지 않는다. (D-02 / IC-15)
 *
 * 여기서 무너지면 무슨 일이 벌어지나:
 *   자리 점유가 "읽고 → 검사하고 → 쓰기"면 마감 직전 동시 요청 여러 개가 같은 빈자리를 본다.
 *   정원 5석에 7명이 확정되고, 그 사실은 **당일 매장에서** 발견된다.
 *   반대로 카운터만 올리고 신청 쪽 가드가 없으면 재시도 하나가 좌석을 영구 소멸시킨다(IC-15 의 대칭).
 *
 * D-03 이 "정원 초과를 허용한다"고 정한 것은 **BID** 이야기다. INSTANT 는 신청 즉시 확정이라
 * 허용 초과가 0이고, 그 0을 지키는 것이 `claimedCount < capacity` 를 WHERE 에 담은
 * 단일 원자적 조건부 UPDATE 하나다.
 */
import { ConflictException } from '@nestjs/common';
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

/** 정원. 이 숫자를 넘는 순간 테스트는 실패해야 한다. */
const CAPACITY = 3;
/** 동시에 쏘는 신청 수. 정원보다 넉넉히 많아야 경합이 실제로 일어난다. */
const CONCURRENCY = 8;

describeIntegration('INSTANT 동시 신청 (IC-15)', () => {
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

  it(`정원 ${CAPACITY}석에 ${CONCURRENCY}명이 동시에 신청해도 정확히 ${CAPACITY}명만 자리를 잡는다`, async () => {
    const users = await createUsers(world, CONCURRENCY);
    const eventId = await createEvent(world, {
      mode: EventMode.INSTANT,
      capacity: CAPACITY,
      fixedAmount: 30_000,
      // 예약금을 끄면 신청 즉시 CONFIRMED 로 끝난다 — 자리 점유 경합만 남는다.
    });

    const applyService = new ApplicationApplyService(
      asPrismaService(prisma),
      new IdempotencyService(asPrismaService(prisma)),
      testConfig(),
    );

    // Promise.all 이 아니라 allSettled 다. 정원을 못 잡은 신청이 거절되는 것이 정상 동작이고,
    // 그 거절을 실패로 취급하면 테스트가 검증하려는 바로 그 성질을 못 본다.
    const results = await Promise.allSettled(
      users.map((user, index) =>
        applyService.apply(
          user,
          { eventId },
          { idempotencyKey: `it-apply-${world.tag}-${index}`, ip: `10.0.0.${index}` },
        ),
      ),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled',
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    // (1) 성공한 신청 수가 정확히 정원이다. INSTANT 의 허용 초과는 0이다.
    expect(fulfilled).toHaveLength(CAPACITY);

    // (2) 거절은 전부 "정원이 찼다"여야 한다. 데드락(P2034)이나 커넥션 고갈(P2024)이 섞여 있으면
    //     그건 가드가 동작한 게 아니라 인프라가 넘어진 것이므로 구분해서 실패시킨다.
    for (const failure of rejected) {
      const reason: unknown = failure.reason;
      expect(reason).toBeInstanceOf(ConflictException);
      expect(JSON.stringify((reason as ConflictException).getResponse())).toContain(
        'EVENT_SOLD_OUT',
      );
    }
    expect(rejected).toHaveLength(CONCURRENCY - CAPACITY);

    // (3) 카운터와 실측이 일치한다. IC-16 이 크론으로 대사하려는 그 drift 가 0이어야 한다.
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { claimedCount: true, capacity: true, soldOutAt: true },
    });
    const claimedRows = await prisma.application.count({
      where: { eventId, slotClaimed: true },
    });

    expect(event.claimedCount).toBe(CAPACITY);
    expect(event.claimedCount).toBeLessThanOrEqual(event.capacity);
    expect(claimedRows).toBe(CAPACITY);

    // (4) 실패한 트랜잭션은 흔적을 남기지 않는다. Application INSERT 는 자리 점유 **앞**에서
    //     일어나므로, 롤백이 제대로 되지 않으면 여기 CONCURRENCY 개가 남는다.
    const totalRows = await prisma.application.count({ where: { eventId } });
    expect(totalRows).toBe(CAPACITY);

    // (5) 정원이 찼으므로 soldOutAt 이 같은 문장 안에서 찍혔어야 한다(IC-15).
    expect(event.soldOutAt).not.toBeNull();
  });
});
