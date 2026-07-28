/**
 * 금액 규칙과 예약금 계산. — DECISIONS.md D-02, D-05
 *
 * 모든 금액은 원 단위 정수다. 소수점은 존재하지 않는다.
 * DB도 Int(0 ~ 2,147,483,647)이므로 이 범위를 벗어나면 저장 자체가 실패한다.
 */

import { AMOUNT_MAX, AMOUNT_MIN, EventMode } from './constants';
import { combine, invalid, valid, type ValidationResult } from './result';

/** 예약금 산정 방식 */
export const DepositType = {
  /** 정액 — 신청 금액과 무관하게 같은 금액 */
  FIXED: 'FIXED',
  /** 정률 — 신청 금액의 몇 % */
  PERCENT: 'PERCENT',
} as const;
export type DepositType = (typeof DepositType)[keyof typeof DepositType];

/** 이벤트의 금액 규칙. min === max 이면 고정 금액이다. */
export interface AmountRule {
  min: number;
  max: number;
}

/** 이벤트의 예약금 설정 */
export interface DepositConfig {
  required: boolean;
  type: DepositType;
  /** FIXED면 원 단위 금액, PERCENT면 1~100 사이의 퍼센트 */
  value: number;
  windowMinutes: number;
}

const isIntInRange = (n: number, lo: number, hi: number) =>
  Number.isInteger(n) && n >= lo && n <= hi;

// ─── 금액 규칙 ────────────────────────────────────────────────────────

export function isFixedAmount(rule: AmountRule): boolean {
  return rule.min === rule.max;
}

/**
 * 이벤트를 만들 때 금액 규칙이 성립하는지 본다.
 *
 * INSTANT는 고정 금액만 허용한다(D-02). 범위를 열어두면 "선착순인데 금액이
 * 제각각"이 되어 즉시확정의 의미가 사라진다 — 무엇을 기준으로 즉시 확정하나.
 */
export function validateAmountRule(rule: AmountRule, mode: EventMode): ValidationResult {
  const checks: ValidationResult[] = [];

  if (!isIntInRange(rule.min, AMOUNT_MIN, AMOUNT_MAX)) {
    checks.push(
      invalid({
        code: 'AMOUNT_MIN_OUT_OF_RANGE',
        field: 'minAmount',
        message: `최소 금액은 ${AMOUNT_MIN}원 이상 ${AMOUNT_MAX.toLocaleString('ko-KR')}원 이하의 정수여야 합니다.`,
      }),
    );
  }

  if (!isIntInRange(rule.max, AMOUNT_MIN, AMOUNT_MAX)) {
    checks.push(
      invalid({
        code: 'AMOUNT_MAX_OUT_OF_RANGE',
        field: 'maxAmount',
        message: `최대 금액은 ${AMOUNT_MIN}원 이상 ${AMOUNT_MAX.toLocaleString('ko-KR')}원 이하의 정수여야 합니다.`,
      }),
    );
  }

  if (Number.isInteger(rule.min) && Number.isInteger(rule.max) && rule.min > rule.max) {
    checks.push(
      invalid({
        code: 'AMOUNT_MIN_GREATER_THAN_MAX',
        field: 'minAmount',
        message: '최소 금액이 최대 금액보다 클 수 없습니다.',
      }),
    );
  }

  if (mode === EventMode.INSTANT && rule.min !== rule.max) {
    checks.push(
      invalid({
        code: 'INSTANT_REQUIRES_FIXED_AMOUNT',
        field: 'maxAmount',
        message: '선착순 즉시확정은 금액을 하나로 고정해야 합니다.',
      }),
    );
  }

  return combine(...checks);
}

/** 유저가 써낸 신청 금액이 규칙 안에 있는지 본다. */
export function validateBidAmount(rule: AmountRule, amount: number): ValidationResult {
  if (!isIntInRange(amount, AMOUNT_MIN, AMOUNT_MAX)) {
    return invalid({
      code: 'AMOUNT_NOT_INTEGER',
      field: 'amount',
      message: '금액은 원 단위 정수로 입력해 주세요.',
    });
  }

  if (amount < rule.min || amount > rule.max) {
    return invalid({
      code: 'AMOUNT_OUT_OF_RULE',
      field: 'amount',
      message: isFixedAmount(rule)
        ? `이 예약은 ${rule.min.toLocaleString('ko-KR')}원으로 고정되어 있습니다.`
        : `${rule.min.toLocaleString('ko-KR')}원 ~ ${rule.max.toLocaleString('ko-KR')}원 사이로 입력해 주세요.`,
    });
  }

  return valid();
}

// ─── 예약금 ───────────────────────────────────────────────────────────

export function validateDepositConfig(config: DepositConfig): ValidationResult {
  if (!config.required) return valid();

  const checks: ValidationResult[] = [];

  if (config.type === DepositType.PERCENT) {
    if (!isIntInRange(config.value, 1, 100)) {
      checks.push(
        invalid({
          code: 'DEPOSIT_PERCENT_OUT_OF_RANGE',
          field: 'depositValue',
          message: '예약금 비율은 1% ~ 100% 사이의 정수여야 합니다.',
        }),
      );
    }
  } else if (!isIntInRange(config.value, 1, AMOUNT_MAX)) {
    checks.push(
      invalid({
        code: 'DEPOSIT_FIXED_OUT_OF_RANGE',
        field: 'depositValue',
        message: '예약금은 1원 이상의 정수여야 합니다.',
      }),
    );
  }

  if (!isIntInRange(config.windowMinutes, 1, 1_440)) {
    checks.push(
      invalid({
        code: 'DEPOSIT_WINDOW_OUT_OF_RANGE',
        field: 'depositWindowMinutes',
        message: '예약금 입금 시간은 1분 ~ 1440분(24시간) 사이여야 합니다.',
      }),
    );
  }

  return combine(...checks);
}

/**
 * 신청 금액에 대해 내야 하는 예약금.
 *
 * 정률은 **버림**한다. 예약금은 진지함을 확인하는 관문이지 정산이 아니므로,
 * 1원 단위에서는 유저에게 유리한 쪽으로 둔다. (D-05)
 *
 * 예약금이 신청 금액을 넘을 수는 없다. 정액 5만원짜리 이벤트에 3만원을
 * 써냈다면 3만원까지만 요구한다 — 안 그러면 낙찰가보다 보증금이 비싸진다.
 */
export function requiredDeposit(config: DepositConfig, amount: number): number {
  if (!config.required) return 0;

  const raw =
    config.type === DepositType.PERCENT
      ? Math.floor((amount * config.value) / 100)
      : config.value;

  return Math.min(raw, amount);
}

/**
 * 금액을 올렸을 때 추가로 내야 하는 차액. (D-06)
 *
 * 정액 예약금이면 올려도 차액이 0이다. 이 경우 상향에 아무 비용이 없다는
 * 뜻이고, 그래서 소프트 클로즈 무한 연장 어뷰징이 가능해진다 —
 * 1인당 연장 횟수 상한이 필요한 이유다. (IMPLEMENTATION-CONSTRAINTS IC-17)
 */
export function depositShortfall(
  config: DepositConfig,
  newAmount: number,
  alreadyPaid: number,
): number {
  return Math.max(0, requiredDeposit(config, newAmount) - alreadyPaid);
}

/** 낸 예약금으로 이 금액이 유지되는가. */
export function isDepositSatisfied(
  config: DepositConfig,
  amount: number,
  paid: number,
): boolean {
  return paid >= requiredDeposit(config, amount);
}

/**
 * 차액을 안 냈을 때 되돌아갈 금액. (D-06)
 *
 * 낸 예약금으로 감당되는 가장 높은 금액이다. 신청 자체는 살아 있고 금액만
 * 내려간다. 정률이면 낸 돈으로 역산하고, 정액이면 이미 냈다는 사실만으로
 * 직전 금액이 유지된다.
 *
 * 주의: 이 함수는 "이론상 얼마까지 감당되는가"를 계산할 뿐이다. 실제
 * 롤백 목표는 BidHistory에 남은 **직전에 완납되었던 금액**이며, 그쪽이
 * 권위다. 이건 그 값이 타당한지 교차 검증하는 용도로 쓴다.
 */
export function maxAmountCoveredBy(
  config: DepositConfig,
  paid: number,
  rule: AmountRule,
): number {
  if (!config.required) return rule.max;

  if (config.type === DepositType.FIXED) {
    // 정액을 냈으면 규칙상 최대까지 감당된다. 못 냈으면 최소 금액조차 안 된다.
    return paid >= config.value ? rule.max : Math.min(paid, rule.max);
  }

  // 정률: floor(a * p / 100) <= paid 를 만족하는 최대 a.
  // floor 때문에 a = floor((paid + 1) * 100 / p) - 1 이 아니라 아래처럼 잡고 보정한다.
  const candidate = Math.floor(((paid + 1) * 100) / config.value);
  const covered = requiredDeposit(config, candidate) <= paid ? candidate : candidate - 1;

  return Math.max(rule.min, Math.min(covered, rule.max));
}
