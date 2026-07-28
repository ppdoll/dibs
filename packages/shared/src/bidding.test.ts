import { describe, expect, it } from 'vitest';

import {
  REAPPLY_COOLDOWN_MINUTES,
  canReapply,
  planRaise,
  reapplyLastBidAt,
  validateRaise,
  validateRollback,
} from './bidding';
import { DepositType, type AmountRule, type DepositConfig } from './money';

const rule: AmountRule = { min: 10_000, max: 1_000_000 };

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

const codes = (r: ReturnType<typeof validateRaise>) => (r.ok ? [] : r.issues.map((i) => i.code));

const now = new Date('2026-08-01T12:00:00Z');

describe('상향 전용 규칙 (D-06)', () => {
  it('올리면 통과한다', () => {
    expect(validateRaise(rule, 50_000, 60_000).ok).toBe(true);
  });

  it('내리면 거부한다', () => {
    expect(codes(validateRaise(rule, 50_000, 40_000))).toContain('RAISE_ONLY');
  });

  it('같은 금액도 거부한다', () => {
    expect(codes(validateRaise(rule, 50_000, 50_000))).toContain('RAISE_NOT_CHANGED');
  });

  it('올리더라도 규칙 최대를 넘으면 거부한다', () => {
    expect(codes(validateRaise(rule, 50_000, 1_000_001))).toContain('AMOUNT_OUT_OF_RULE');
  });
});

describe('상향 계획 (D-06)', () => {
  it('정률: 차액이 생기고 새 윈도우가 열린다', () => {
    const plan = planRaise({
      config: percent(10),
      currentAmount: 80_000,
      nextAmount: 100_000,
      paidSoFar: 8_000,
      now,
    });

    expect(plan.shortfall).toBe(2_000);
    expect(plan.depositDueAt?.toISOString()).toBe('2026-08-01T12:10:00.000Z');
    expect(plan.rollbackTo).toBe(80_000);
  });

  it('차액이 남으면 소프트 클로즈를 유발하지 못한다', () => {
    // 돈 한 푼 안 내고 마감을 미루는 걸 막는다 (D-08)
    const plan = planRaise({
      config: percent(10),
      currentAmount: 80_000,
      nextAmount: 100_000,
      paidSoFar: 8_000,
      now,
    });

    expect(plan.mayTriggerSoftClose).toBe(false);
  });

  it('차액이 0이면 즉시 확정되고 연장 자격이 생긴다', () => {
    const plan = planRaise({
      config: fixed(5_000),
      currentAmount: 80_000,
      nextAmount: 100_000,
      paidSoFar: 5_000,
      now,
    });

    expect(plan.shortfall).toBe(0);
    expect(plan.depositDueAt).toBeNull();
    expect(plan.rollbackTo).toBeNull();
    expect(plan.mayTriggerSoftClose).toBe(true);
  });

  it('예약금을 안 받는 이벤트는 상향이 곧바로 확정된다', () => {
    const plan = planRaise({
      config: none,
      currentAmount: 80_000,
      nextAmount: 100_000,
      paidSoFar: 0,
      now,
    });

    expect(plan.shortfall).toBe(0);
    expect(plan.mayTriggerSoftClose).toBe(true);
  });

  it('이미 넉넉히 냈으면 추가 납부 없이 올라간다', () => {
    const plan = planRaise({
      config: percent(10),
      currentAmount: 50_000,
      nextAmount: 60_000,
      paidSoFar: 30_000,
      now,
    });

    expect(plan.shortfall).toBe(0);
  });
});

describe('롤백 교차검증 (D-06)', () => {
  it('낸 돈으로 감당되는 금액이면 통과한다', () => {
    expect(validateRollback(percent(10), 80_000, 8_000).ok).toBe(true);
  });

  it('감당 안 되는 금액으로 되돌리려 하면 거부한다', () => {
    // "예약금 미달인데 유효한 신청"이라는 상태를 만들면 안 된다
    const r = validateRollback(percent(10), 90_000, 8_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe('ROLLBACK_TARGET_UNDERFUNDED');
  });

  it('예약금을 안 받으면 어디로든 되돌릴 수 있다', () => {
    expect(validateRollback(none, 999_999, 0).ok).toBe(true);
  });
});

describe('취소 후 재신청 (IC-14)', () => {
  it('재신청은 새 시각을 받는다 — 취소 전 순번을 물려받지 않는다', () => {
    // 이걸 물려주면 취소·재신청 반복으로 동점 순번을 세탁할 수 있다
    const t = new Date('2026-08-01T15:30:00Z');
    expect(reapplyLastBidAt(t).toISOString()).toBe('2026-08-01T15:30:00.000Z');
  });

  it('취소한 적이 없으면 바로 신청할 수 있다', () => {
    expect(canReapply(null, now).ok).toBe(true);
  });

  it('쿨다운이 지나면 재신청할 수 있다', () => {
    const canceled = new Date(now.getTime() - REAPPLY_COOLDOWN_MINUTES * 60_000);
    expect(canReapply(canceled, now).ok).toBe(true);
  });

  it('쿨다운 안이면 남은 시간을 알려주며 거부한다', () => {
    const canceled = new Date(now.getTime() - 3 * 60_000);
    const r = canReapply(canceled, now);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.code).toBe('REAPPLY_TOO_SOON');
      expect(r.issues[0]?.message).toContain('7분');
    }
  });
});
