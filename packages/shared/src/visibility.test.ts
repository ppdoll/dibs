import { describe, expect, it } from 'vitest';

import {
  assertNoVisibilityLeak,
  findVisibilityLeaks,
  toPublicEventSummary,
} from './visibility';

const at = (iso: string) => new Date(iso);

const rawEvent = {
  id: 'evt_1',
  title: '강남점 오마카세 8월 예약',
  mode: 'BID',
  status: 'OPEN',
  minAmount: 50_000,
  maxAmount: 300_000,
  capacity: 10,
  applyStartAt: at('2026-08-01T00:00:00Z'),
  applyEndAt: at('2026-08-10T12:00:00Z'),
  serviceDate: at('2026-08-20T11:00:00Z'),
  applicantCount: 47,
};

describe('공개 이벤트 요약 (D-07)', () => {
  it('경쟁률만 경쟁 정보로 내보낸다', () => {
    const view = toPublicEventSummary(rawEvent);

    expect(view.competition.display).toBe('4.7:1');
    expect(view.competition.capacity).toBe(10);
    expect(view.competition.applicantCount).toBe(47);
  });

  it('내가 써낼 수 있는 범위는 공개한다', () => {
    // min/max는 "얼마를 쓸 수 있는가"지 "남이 얼마를 썼는가"가 아니다
    const view = toPublicEventSummary(rawEvent);

    expect(view.minAmount).toBe(50_000);
    expect(view.maxAmount).toBe(300_000);
  });

  it('화이트리스트라 원본에 뭐가 붙어 있어도 새지 않는다', () => {
    const contaminated = {
      ...rawEvent,
      cutoffAmount: 180_000,
      topBidAmount: 300_000,
      myRank: 12,
      internalNote: '유출되면 안 됨',
    };

    const view = toPublicEventSummary(contaminated);

    expect(view).not.toHaveProperty('cutoffAmount');
    expect(view).not.toHaveProperty('topBidAmount');
    expect(view).not.toHaveProperty('myRank');
    expect(view).not.toHaveProperty('internalNote');
  });

  it('serviceDate가 없으면 null로 정규화한다', () => {
    const { serviceDate, ...withoutDate } = rawEvent;
    expect(toPublicEventSummary(withoutDate).serviceDate).toBeNull();
  });
});

describe('누출 탐지기', () => {
  it('깨끗한 응답에서는 아무것도 못 찾는다', () => {
    expect(findVisibilityLeaks(toPublicEventSummary(rawEvent))).toEqual([]);
  });

  it('커트라인을 찾아낸다', () => {
    expect(findVisibilityLeaks({ cutoffAmount: 180_000 })).toEqual(['$.cutoffAmount']);
  });

  it('순위를 찾아낸다', () => {
    expect(findVisibilityLeaks({ myRank: 12 })).toEqual(['$.myRank']);
  });

  it('중첩된 곳에 숨어 있어도 찾아낸다', () => {
    const leaks = findVisibilityLeaks({
      event: { title: '안전', selection: { cutoffAmount: 1 } },
    });

    expect(leaks).toEqual(['$.event.selection.cutoffAmount']);
  });

  it('배열 안도 훑는다', () => {
    const leaks = findVisibilityLeaks({ items: [{ ok: 1 }, { bidAmount: 5 }] });
    expect(leaks).toEqual(['$.items[1].bidAmount']);
  });

  it('경쟁률의 허용 키는 오탐하지 않는다', () => {
    expect(findVisibilityLeaks({ capacity: 10, applicantCount: 47, ratio: 4.7, display: '4.7:1' })).toEqual(
      [],
    );
  });

  it('이벤트의 금액 규칙(min/max)은 오탐하지 않는다', () => {
    // "내가 얼마를 쓸 수 있는가"는 공개해야 신청 폼을 그린다
    expect(findVisibilityLeaks({ minAmount: 50_000, maxAmount: 300_000 })).toEqual([]);
  });

  it('맥락별 허용 키를 넘기면 통과시킨다', () => {
    // 내 신청 내역에서 내 금액은 내 정보다
    expect(findVisibilityLeaks({ myAmount: 80_000 }, { allow: ['myAmount'] })).toEqual([]);
  });

  it('허용 키를 안 넘기면 같은 값도 유출로 본다', () => {
    // 같은 myAmount라도 남의 목록에 실리면 유출이다
    expect(findVisibilityLeaks({ myAmount: 80_000 })).toEqual(['$.myAmount']);
  });

  it('Date를 파고들지 않는다', () => {
    expect(findVisibilityLeaks({ applyEndAt: at('2026-08-10T12:00:00Z') })).toEqual([]);
  });

  it('null과 원시값에 안전하다', () => {
    expect(findVisibilityLeaks(null)).toEqual([]);
    expect(findVisibilityLeaks(42)).toEqual([]);
    expect(findVisibilityLeaks('cutoffAmount')).toEqual([]);
  });
});

describe('알림 문구 검사 (IC-44)', () => {
  it('깨끗한 payload는 통과한다', () => {
    expect(() =>
      assertNoVisibilityLeak({ eventTitle: '강남점 오마카세', applicantName: '홍길동' }, '미선정 알림'),
    ).not.toThrow();
  });

  it('커트라인이 섞이면 던진다', () => {
    // "8만원에 밀리셨습니다"는 커트라인을 그대로 알려주는 것과 같다
    expect(() => assertNoVisibilityLeak({ cutoffAmount: 80_000 }, '미선정 알림')).toThrow(/D-07 위반/);
  });

  it('어느 필드가 문제인지 알려준다', () => {
    expect(() => assertNoVisibilityLeak({ payload: { myRank: 12 } }, '결과 알림')).toThrow(
      /\$\.payload\.myRank/,
    );
  });
});
