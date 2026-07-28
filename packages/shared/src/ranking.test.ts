import { describe, expect, it } from 'vitest';

import {
  competitionRatio,
  compareByRank,
  microsFromDate,
  rankApplications,
  rankingFinalizesAt,
  type RankableApplication,
} from './ranking';

const at = (iso: string) => new Date(iso);

/** applySeq는 신청 순서다. 명시하지 않으면 호출 순서대로 증가시킨다. */
let seq = 0n;
function app(
  id: string,
  amount: number,
  lastBidAt: string,
  applySeq?: bigint,
): RankableApplication {
  seq += 1n;
  return {
    id,
    amount,
    lastBidAtMicros: microsFromDate(at(lastBidAt)),
    applySeq: applySeq ?? seq,
  };
}

describe('compareByRank — 순위 규칙 (D-04)', () => {
  it('금액이 높은 쪽이 앞선다', () => {
    const high = app('a', 100_000, '2026-08-01T10:00:00Z');
    const low = app('b', 90_000, '2026-08-01T09:00:00Z');

    // 늦게 넣었어도 금액이 높으면 이긴다
    expect(compareByRank(high, low)).toBeLessThan(0);
  });

  it('금액이 같으면 그 금액에 먼저 도달한 쪽이 앞선다', () => {
    const early = app('a', 80_000, '2026-08-01T09:00:00Z');
    const late = app('b', 80_000, '2026-08-01T10:00:00Z');

    expect(compareByRank(early, late)).toBeLessThan(0);
  });

  it('금액과 시각이 완전히 같으면 applySeq로 결정적으로 갈린다', () => {
    const a = app('aaa', 80_000, '2026-08-01T09:00:00Z', 1n);
    const b = app('bbb', 80_000, '2026-08-01T09:00:00Z', 2n);

    expect(compareByRank(a, b)).toBeLessThan(0);
    expect(compareByRank(b, a)).toBeGreaterThan(0);
    expect(compareByRank(a, a)).toBe(0);
  });

  it('3차 키는 id가 아니라 applySeq다', () => {
    // id 사전순과 applySeq 순서를 일부러 반대로 둔다.
    // cuid v1은 사실상 시간순으로 정렬되기 때문에 id로 tie-break하면
    // "우연히" 맞아 보인다. 의도한 키가 무엇인지 여기서 못박는다.
    const later = app('aaa', 80_000, '2026-08-01T09:00:00Z', 99n);
    const earlier = app('zzz', 80_000, '2026-08-01T09:00:00Z', 1n);

    expect(compareByRank(earlier, later)).toBeLessThan(0);
    expect(rankApplications([later, earlier], 2).map((r) => r.application.id)).toEqual([
      'zzz',
      'aaa',
    ]);
  });

  it('마이크로초 차이는 밀리초로 잘리지 않고 그대로 반영된다', () => {
    // DB의 Timestamptz(6)와 해상도를 맞추기 위해 마이크로초를 직접 받는다.
    // Date를 썼다면 둘 다 .123으로 잘려 동점이 되고 applySeq로 떨어졌을 것이다.
    const base = microsFromDate(at('2026-08-01T12:00:00.123Z'));
    const a: RankableApplication = {
      id: 'a',
      amount: 80_000,
      lastBidAtMicros: base + 456n,
      applySeq: 50n,
    };
    const b: RankableApplication = {
      id: 'b',
      amount: 80_000,
      lastBidAtMicros: base + 999n,
      applySeq: 10n,
    };

    // applySeq는 b가 앞서지만, 시각이 a가 빠르므로 a가 이긴다
    expect(compareByRank(a, b)).toBeLessThan(0);
    expect(rankApplications([b, a], 2).map((r) => r.application.id)).toEqual(['a', 'b']);
  });

  it('같은 입력을 여러 번 정렬해도 순서가 흔들리지 않는다', () => {
    // 동일 금액 + 동일 시각이 섞여 있어도 결과가 결정적이어야 한다
    const items = [
      app('e', 80_000, '2026-08-01T09:00:00Z', 5n),
      app('c', 80_000, '2026-08-01T09:00:00Z', 3n),
      app('a', 80_000, '2026-08-01T09:00:00Z', 1n),
      app('d', 80_000, '2026-08-01T09:00:00Z', 4n),
      app('b', 80_000, '2026-08-01T09:00:00Z', 2n),
    ];

    const first = [...items].sort(compareByRank).map((i) => i.id);
    const second = [...items].reverse().sort(compareByRank).map((i) => i.id);

    expect(first).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(second).toEqual(first);
  });
});

describe('rankApplications', () => {
  it('금액 내림차순 → 시각 오름차순으로 순위를 매긴다', () => {
    const ranked = rankApplications(
      [
        app('c', 50_000, '2026-08-01T09:00:00Z'),
        app('a', 100_000, '2026-08-01T11:00:00Z'),
        app('b', 100_000, '2026-08-01T10:00:00Z'),
      ],
      3,
    );

    expect(ranked.map((r) => r.application.id)).toEqual(['b', 'a', 'c']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('정원까지만 withinCapacity가 true다', () => {
    const ranked = rankApplications(
      [
        app('a', 100_000, '2026-08-01T09:00:00Z'),
        app('b', 90_000, '2026-08-01T09:00:00Z'),
        app('c', 80_000, '2026-08-01T09:00:00Z'),
      ],
      2,
    );

    expect(ranked.map((r) => r.withinCapacity)).toEqual([true, true, false]);
  });

  it('정원 초과 신청을 그대로 받아 전원에게 순위를 준다 (D-03)', () => {
    const many = Array.from({ length: 47 }, (_, i) =>
      app(`app-${String(i).padStart(3, '0')}`, 10_000 + i, '2026-08-01T09:00:00Z'),
    );

    const ranked = rankApplications(many, 10);

    expect(ranked).toHaveLength(47);
    expect(ranked.filter((r) => r.withinCapacity)).toHaveLength(10);
  });

  it('원본 배열을 변형하지 않는다', () => {
    const input = [
      app('a', 50_000, '2026-08-01T09:00:00Z'),
      app('b', 90_000, '2026-08-01T09:00:00Z'),
    ];
    const snapshot = input.map((i) => i.id);

    rankApplications(input, 1);

    expect(input.map((i) => i.id)).toEqual(snapshot);
  });

  it('빈 목록도 안전하다', () => {
    expect(rankApplications([], 10)).toEqual([]);
  });

  describe('재입찰 시나리오 (D-06)', () => {
    it('상향하면 lastBidAt이 갱신되어 같은 금액 그룹에서 뒤로 밀린다', () => {
      // B가 09:00에 이미 80,000을 불렀고, A가 11:00에 70,000 → 80,000으로 올렸다.
      // 금액은 같지만 A는 그 금액에 늦게 도달했으므로 B에게 진다.
      const b = app('b', 80_000, '2026-08-01T09:00:00Z');
      const aAfterRaise = app('a', 80_000, '2026-08-01T11:00:00Z');

      const ranked = rankApplications([aAfterRaise, b], 2);

      expect(ranked.map((r) => r.application.id)).toEqual(['b', 'a']);
    });

    it('먼저 신청했더라도 상향이 늦으면 진다', () => {
      // A가 applySeq는 앞서지만(먼저 신청) 80,000에는 늦게 도달했다.
      // 3차 키까지 가지 않고 2차 키에서 갈려야 한다.
      const aAfterRaise: RankableApplication = {
        id: 'a',
        amount: 80_000,
        lastBidAtMicros: microsFromDate(at('2026-08-01T11:00:00Z')),
        applySeq: 1n,
      };
      const b: RankableApplication = {
        id: 'b',
        amount: 80_000,
        lastBidAtMicros: microsFromDate(at('2026-08-01T09:00:00Z')),
        applySeq: 999n,
      };

      expect(rankApplications([aAfterRaise, b], 2).map((r) => r.application.id)).toEqual(['b', 'a']);
    });

    it('상향 금액이 더 크면 도달이 늦어도 이긴다', () => {
      const b = app('b', 80_000, '2026-08-01T09:00:00Z');
      const aAfterRaise = app('a', 80_001, '2026-08-01T11:00:00Z');

      const ranked = rankApplications([aAfterRaise, b], 2);

      expect(ranked.map((r) => r.application.id)).toEqual(['a', 'b']);
    });
  });

  describe('고정 금액 이벤트', () => {
    it('금액이 모두 같으면 순수 신청 순서가 된다', () => {
      const ranked = rankApplications(
        [
          app('c', 30_000, '2026-08-01T09:00:02Z'),
          app('a', 30_000, '2026-08-01T09:00:00Z'),
          app('b', 30_000, '2026-08-01T09:00:01Z'),
        ],
        3,
      );

      expect(ranked.map((r) => r.application.id)).toEqual(['a', 'b', 'c']);
    });
  });
});

describe('microsFromDate', () => {
  it('밀리초를 마이크로초로 올린다', () => {
    expect(microsFromDate(at('1970-01-01T00:00:00.001Z'))).toBe(1_000n);
  });

  it('Date는 밀리초까지만 담으므로 하위 3자리는 항상 0이다', () => {
    // 이 손실이 바로 DB에서 순위를 계산해야 하는 이유다.
    expect(microsFromDate(at('2026-08-01T12:00:00.123Z')) % 1_000n).toBe(0n);
  });
});

describe('rankingFinalizesAt — 순위 확정 시점 (D-04)', () => {
  const deadline = at('2026-08-01T12:00:00Z');

  it('디파짓이 필요하면 마감 + 윈도우만큼 뒤로 민다', () => {
    // 마감 1분 전 신청자도 10분을 온전히 쓸 수 있어야 한다
    expect(rankingFinalizesAt(deadline, 10, true).toISOString()).toBe('2026-08-01T12:10:00.000Z');
  });

  it('디파짓이 없으면 마감 시각 그대로다', () => {
    expect(rankingFinalizesAt(deadline, 10, false).toISOString()).toBe('2026-08-01T12:00:00.000Z');
  });

  it('원본 Date를 변형하지 않는다', () => {
    rankingFinalizesAt(deadline, 10, true);
    expect(deadline.toISOString()).toBe('2026-08-01T12:00:00.000Z');
  });
});

describe('competitionRatio — 경쟁률 (D-07)', () => {
  it('정원 대비 신청 배수를 계산한다', () => {
    const r = competitionRatio(10, 47);

    expect(r.ratio).toBeCloseTo(4.7);
    expect(r.display).toBe('4.7:1');
  });

  it('정원이 0이면 나눗셈을 하지 않는다', () => {
    const r = competitionRatio(0, 5);

    expect(r.ratio).toBeNull();
    expect(r.display).toBe('-');
  });

  it('신청이 없으면 0:1이다', () => {
    expect(competitionRatio(10, 0).display).toBe('0.0:1');
  });

  it('금액이나 순위를 절대 노출하지 않는다', () => {
    // 경쟁률 응답에 금액/커트라인/순위가 새어나가면 D-07 위반이다.
    const r = competitionRatio(10, 47);

    expect(Object.keys(r).sort()).toEqual(['applicantCount', 'capacity', 'display', 'ratio']);
  });
});
