import { describe, expect, it } from 'vitest';

import { AMOUNT_MAX, EventMode } from './constants';
import {
  DepositType,
  depositShortfall,
  isDepositSatisfied,
  isFixedAmount,
  maxAmountCoveredBy,
  requiredDeposit,
  validateAmountRule,
  validateBidAmount,
  validateDepositConfig,
  type AmountRule,
  type DepositConfig,
} from './money';

const codes = (r: ReturnType<typeof validateAmountRule>) => (r.ok ? [] : r.issues.map((i) => i.code));

const percent = (value: number, windowMinutes = 10): DepositConfig => ({
  required: true,
  type: DepositType.PERCENT,
  value,
  windowMinutes,
});

const fixed = (value: number, windowMinutes = 10): DepositConfig => ({
  required: true,
  type: DepositType.FIXED,
  value,
  windowMinutes,
});

const none: DepositConfig = {
  required: false,
  type: DepositType.FIXED,
  value: 0,
  windowMinutes: 10,
};

describe('금액 규칙 (D-02)', () => {
  const range: AmountRule = { min: 10_000, max: 100_000 };
  const flat: AmountRule = { min: 30_000, max: 30_000 };

  it('min === max 이면 고정 금액이다', () => {
    expect(isFixedAmount(flat)).toBe(true);
    expect(isFixedAmount(range)).toBe(false);
  });

  it('0원부터 Int max까지 허용한다', () => {
    expect(validateAmountRule({ min: 0, max: AMOUNT_MAX }, EventMode.BID).ok).toBe(true);
  });

  it('Int max를 넘으면 거부한다 — DB가 Int라 저장 자체가 실패한다', () => {
    expect(codes(validateAmountRule({ min: 0, max: AMOUNT_MAX + 1 }, EventMode.BID))).toContain(
      'AMOUNT_MAX_OUT_OF_RANGE',
    );
  });

  it('음수를 거부한다', () => {
    expect(codes(validateAmountRule({ min: -1, max: 100 }, EventMode.BID))).toContain(
      'AMOUNT_MIN_OUT_OF_RANGE',
    );
  });

  it('소수점을 거부한다', () => {
    expect(codes(validateAmountRule({ min: 1.5, max: 100 }, EventMode.BID))).toContain(
      'AMOUNT_MIN_OUT_OF_RANGE',
    );
  });

  it('min > max 를 거부한다', () => {
    expect(codes(validateAmountRule({ min: 100, max: 10 }, EventMode.BID))).toContain(
      'AMOUNT_MIN_GREATER_THAN_MAX',
    );
  });

  it('INSTANT는 고정 금액만 허용한다', () => {
    expect(codes(validateAmountRule(range, EventMode.INSTANT))).toContain(
      'INSTANT_REQUIRES_FIXED_AMOUNT',
    );
    expect(validateAmountRule(flat, EventMode.INSTANT).ok).toBe(true);
  });

  it('BID는 범위도 고정도 된다', () => {
    expect(validateAmountRule(range, EventMode.BID).ok).toBe(true);
    expect(validateAmountRule(flat, EventMode.BID).ok).toBe(true);
  });

  it('여러 문제를 한 번에 모아서 알려준다', () => {
    // 화면에서 빨간 글씨를 한꺼번에 띄우려면 하나만 던져선 안 된다
    const result = validateAmountRule({ min: -5, max: -1 }, EventMode.INSTANT);
    expect(codes(result).length).toBeGreaterThan(1);
  });
});

describe('신청 금액 검증', () => {
  const range: AmountRule = { min: 10_000, max: 100_000 };

  it('범위 안이면 통과한다', () => {
    expect(validateBidAmount(range, 10_000).ok).toBe(true);
    expect(validateBidAmount(range, 100_000).ok).toBe(true);
  });

  it('범위 밖이면 거부한다', () => {
    expect(validateBidAmount(range, 9_999).ok).toBe(false);
    expect(validateBidAmount(range, 100_001).ok).toBe(false);
  });

  it('고정 금액이면 안내 문구가 달라진다', () => {
    const r = validateBidAmount({ min: 30_000, max: 30_000 }, 25_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toContain('고정');
  });
});

describe('예약금 설정 검증 (D-05)', () => {
  it('예약금을 안 받으면 나머지는 안 본다', () => {
    expect(validateDepositConfig({ ...none, value: -999, windowMinutes: 0 }).ok).toBe(true);
  });

  it('정률은 1~100%만 허용한다', () => {
    expect(validateDepositConfig(percent(10)).ok).toBe(true);
    expect(validateDepositConfig(percent(0)).ok).toBe(false);
    expect(validateDepositConfig(percent(101)).ok).toBe(false);
  });

  it('윈도우는 1분 ~ 24시간이다', () => {
    expect(validateDepositConfig(percent(10, 10)).ok).toBe(true);
    expect(validateDepositConfig(percent(10, 0)).ok).toBe(false);
    expect(validateDepositConfig(percent(10, 1_441)).ok).toBe(false);
  });
});

describe('예약금 계산 (D-05)', () => {
  it('예약금을 안 받으면 0이다', () => {
    expect(requiredDeposit(none, 100_000)).toBe(0);
  });

  it('정액은 금액과 무관하게 같다', () => {
    expect(requiredDeposit(fixed(5_000), 100_000)).toBe(5_000);
    expect(requiredDeposit(fixed(5_000), 20_000)).toBe(5_000);
  });

  it('정률은 버림한다 — 1원 단위는 유저에게 유리하게', () => {
    expect(requiredDeposit(percent(10), 83_333)).toBe(8_333); // 8333.3 → 8333
    expect(requiredDeposit(percent(3), 1_000)).toBe(30);
  });

  it('예약금이 신청 금액을 넘지 않는다', () => {
    // 정액 5만원인데 3만원을 써냈다면 보증금이 낙찰가보다 비싸진다
    expect(requiredDeposit(fixed(50_000), 30_000)).toBe(30_000);
  });

  it('100%면 신청 금액 전액이다', () => {
    expect(requiredDeposit(percent(100), 70_000)).toBe(70_000);
  });

  it('0원 신청이면 예약금도 0이다', () => {
    expect(requiredDeposit(percent(10), 0)).toBe(0);
    expect(requiredDeposit(fixed(5_000), 0)).toBe(0);
  });
});

describe('상향 차액 (D-06)', () => {
  it('정률은 올린 만큼 차액이 생긴다', () => {
    // 80,000의 10% = 8,000을 냈고 100,000으로 올리면 10,000 필요 → 2,000 부족
    expect(depositShortfall(percent(10), 100_000, 8_000)).toBe(2_000);
  });

  it('정액은 올려도 차액이 0이다 — 그래서 연장 어뷰징이 가능하다', () => {
    // 이게 1인당 소프트 클로즈 연장 상한이 필요한 이유다 (IC-17)
    expect(depositShortfall(fixed(5_000), 100_000, 5_000)).toBe(0);
  });

  it('이미 넉넉히 냈으면 차액이 0이다', () => {
    expect(depositShortfall(percent(10), 100_000, 50_000)).toBe(0);
  });

  it('차액은 음수가 되지 않는다', () => {
    expect(depositShortfall(percent(10), 10_000, 99_999)).toBe(0);
  });
});

describe('예약금 충족 판정', () => {
  it('필요액 이상이면 충족이다', () => {
    expect(isDepositSatisfied(percent(10), 100_000, 10_000)).toBe(true);
    expect(isDepositSatisfied(percent(10), 100_000, 9_999)).toBe(false);
  });

  it('예약금을 안 받는 이벤트는 항상 충족이다', () => {
    expect(isDepositSatisfied(none, 100_000, 0)).toBe(true);
  });
});

describe('낸 예약금으로 감당되는 최대 금액 (롤백 교차검증)', () => {
  const rule: AmountRule = { min: 0, max: 1_000_000 };

  it('정률: 낸 돈에서 역산한다', () => {
    // 8,000원을 냈고 10%면 80,000까지 감당된다.
    // 버림 때문에 80,009까지도 8,000이지만, 규칙상 딱 떨어지는 선을 넘지 않게 본다.
    const covered = maxAmountCoveredBy(percent(10), 8_000, rule);
    expect(requiredDeposit(percent(10), covered)).toBeLessThanOrEqual(8_000);
    expect(covered).toBeGreaterThanOrEqual(80_000);
  });

  it('정률: 감당 금액 + 1은 반드시 초과한다', () => {
    const covered = maxAmountCoveredBy(percent(10), 8_000, rule);
    expect(requiredDeposit(percent(10), covered + 1)).toBeGreaterThan(8_000);
  });

  it('정액: 냈으면 규칙상 최대까지 감당된다', () => {
    expect(maxAmountCoveredBy(fixed(5_000), 5_000, rule)).toBe(rule.max);
  });

  it('정액: 못 냈으면 낸 만큼만', () => {
    expect(maxAmountCoveredBy(fixed(5_000), 3_000, rule)).toBe(3_000);
  });

  it('예약금을 안 받으면 규칙상 최대다', () => {
    expect(maxAmountCoveredBy(none, 0, rule)).toBe(rule.max);
  });

  it('규칙의 최대를 넘지 않는다', () => {
    const narrow: AmountRule = { min: 0, max: 50_000 };
    expect(maxAmountCoveredBy(percent(1), 100_000, narrow)).toBe(50_000);
  });
});
