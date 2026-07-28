/**
 * D-07 — 기간 중 유저가 보는 경쟁 정보는 경쟁률 하나뿐이다.
 *
 * 감춰야 하는 것: 타인의 금액, 개인 순위(**자기 순위 포함**), 커트라인.
 * 커트라인 하나가 새면 그 이벤트의 모든 참가자가 최소 낙찰가를 알게 되고, 밀봉입찰이
 * 공개입찰로 바뀐다 — 되돌릴 수 없는 종류의 유출이다.
 *
 * 이 테스트는 **실제 DB 행**을 통과시킨다. 순수 단위 테스트로 가짜 객체를 넣으면
 * `select` 화이트리스트에 필드가 하나 늘어난 순간을 못 잡는다. 여기서는 진짜 select 로 읽고
 * 진짜 매퍼로 옮긴 뒤, `findVisibilityLeaks` 로 스캔한다.
 *
 * 그물이 두 겹인 이유:
 *   (1) findVisibilityLeaks — 키 이름 부분일치. 이름이 조금 달라도 걸린다.
 *   (2) 아래 FORBIDDEN_EXACT — "이 컬럼만은 절대"인 목록. 부분일치를 허용 목록으로 뚫었을 때
 *       그 구멍으로 진짜 위험한 컬럼이 같이 나가는 것을 막는다.
 */
import { EventMode, EventStatus } from '@prisma/client';
import { findVisibilityLeaks } from '@dibs/shared';

import {
  MY_APPLICATION_SELECT,
  OWN_DATA_KEYS,
  toMyApplicationView,
} from '../src/applications/internal/application-view';
import { EVENT_CARD_SELECT, toPublicEventCard } from '../src/search/public-event.mapper';
import { describeIntegration, disconnectPrisma, getPrisma } from './helpers/integration-db';
import {
  createEvent,
  createUsers,
  createWorld,
  destroyWorld,
  days,
  insertApplication,
  microStamp,
  minutes,
  type TestWorld,
} from './helpers/fixtures';

/**
 * 이름이 무엇이든 이 값들은 유저 응답 어디에도 있으면 안 된다.
 * `rank`/`cutoff` 는 부분일치로 본다 — `finalRank`, `myRank`, `cutoffAmount` 를 전부 덮는다.
 */
const FORBIDDEN_PATTERNS = [/rank/i, /cutoff/i];
const FORBIDDEN_EXACT = [
  'lastBidAt',
  'settledAmount',
  'settledLastBidAt',
  'highestAmountEver',
  'applySeq',
  'partnerNote',
  'amountSnapshot',
];

/** 객체 트리의 모든 키를 경로와 함께 모은다. */
function collectKeys(node: unknown, path = '$', out: string[] = []): string[] {
  if (node === null || typeof node !== 'object' || node instanceof Date) return out;

  if (Array.isArray(node)) {
    node.forEach((child, i) => collectKeys(child, `${path}[${i}]`, out));
    return out;
  }

  for (const [key, child] of Object.entries(node)) {
    out.push(`${path}.${key}`);
    collectKeys(child, `${path}.${key}`, out);
  }

  return out;
}

function assertNoForbiddenKeys(payload: unknown, label: string): void {
  const keys = collectKeys(payload);

  const hits = keys.filter((path) => {
    const key = path.slice(path.lastIndexOf('.') + 1);
    return FORBIDDEN_PATTERNS.some((p) => p.test(key)) || FORBIDDEN_EXACT.includes(key);
  });

  // label 을 같이 비교에 넣어야 실패 diff 에 "어느 응답에서 샜는지"가 보인다.
  expect({ label, hits }).toEqual({ label, hits: [] });
  // 빈 객체는 "아무것도 안 샜다"가 아니라 "아무것도 안 봤다"이다.
  expect(keys.length).toBeGreaterThan(0);
}

describeIntegration('D-07 공개 범위', () => {
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

  it('공개 이벤트 카드에는 경쟁률만 있고 타인 금액·순위·커트라인이 없다', async () => {
    const users = await createUsers(world, 3);

    const eventId = await createEvent(world, {
      mode: EventMode.BID,
      status: EventStatus.OPEN,
      capacity: 2,
      minAmount: 50_000,
      maxAmount: 300_000,
      applyStartAt: days(-1),
      applyEndAt: days(2),
    });

    for (const [index, user] of users.entries()) {
      await insertApplication(prisma, {
        id: `it-app-${world.tag}-${index}`,
        eventId,
        userId: user.id,
        eventMode: EventMode.BID,
        status: 'VALID',
        amount: 100_000 + index * 50_000,
        lastBidAt: microStamp(minutes(-100 + index), '000000'),
      });
    }

    // 경쟁률은 신청 hot path 가 아니라 크론/지연 갱신이 채우는 비정규화 카운터에서 온다(IC-53).
    await prisma.event.update({
      where: { id: eventId },
      data: { liveApplicantCount: users.length, competitionRatioX10: 15 },
    });

    const row = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: EVENT_CARD_SELECT,
    });
    const card = toPublicEventCard(row);

    // 공개되는 경쟁 정보는 경쟁률 하나뿐이고, 그건 정원과 신청 인원만으로 만들어진다.
    expect(card.competition).not.toBeNull();
    expect(card.competition?.capacity).toBe(2);
    expect(card.competition?.applicantCount).toBe(3);

    // minAmount/maxAmount 는 "내가 써낼 수 있는 범위"라 공개다. 남이 써낸 금액이 아니다.
    expect(card.minAmount).toBe(50_000);
    expect(card.maxAmount).toBe(300_000);

    expect(findVisibilityLeaks(card)).toEqual([]);
    assertNoForbiddenKeys(card, '공개 이벤트 카드');
  });

  it('"내 신청" 응답에는 내 금액만 있고 내 순위는 없다', async () => {
    const [user, rival] = await createUsers(world, 2);
    if (!user || !rival) throw new Error('테스트 사용자 생성 실패');

    const eventId = await createEvent(world, {
      mode: EventMode.BID,
      status: EventStatus.OPEN,
      capacity: 1,
      minAmount: 50_000,
      maxAmount: 300_000,
      applyStartAt: days(-1),
      applyEndAt: days(2),
    });

    const myApplicationId = await insertApplication(prisma, {
      id: `it-app-${world.tag}-mine`,
      eventId,
      userId: user.id,
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: 120_000,
      lastBidAt: microStamp(minutes(-90), '000000'),
    });

    // 나보다 높은 금액을 쓴 사람이 있다 — 그 사실도, 그 금액도 내 응답에 나타나면 안 된다.
    await insertApplication(prisma, {
      id: `it-app-${world.tag}-rival`,
      eventId,
      userId: rival.id,
      eventMode: EventMode.BID,
      status: 'VALID',
      amount: 250_000,
      lastBidAt: microStamp(minutes(-80), '000000'),
    });

    const row = await prisma.application.findUniqueOrThrow({
      where: { id: myApplicationId },
      select: MY_APPLICATION_SELECT,
    });
    const view = toMyApplicationView(row);

    expect(view.myAmount).toBe(120_000);

    // 허용 목록은 **본인 정보**만이다.
    //   OWN_DATA_KEYS  — 내가 낼 예약금 계열
    //   rebidCount     — 내가 몇 번 올렸는가. 'bid' 부분일치에 걸리지만 남의 정보가 아니다.
    //   reapplyCount   — 같은 이유
    const allow = [...OWN_DATA_KEYS, 'rebidCount', 'reapplyCount'];
    expect(findVisibilityLeaks(view, { allow })).toEqual([]);

    // 허용 목록으로 뚫은 구멍에 진짜 위험한 컬럼이 섞여 나가지 않았는지 다시 본다.
    assertNoForbiddenKeys(view, '내 신청 상세');

    // 직렬화된 형태에서도 남의 금액이 문자열로 새지 않는다.
    expect(JSON.stringify(view)).not.toContain('250000');
  });
});
