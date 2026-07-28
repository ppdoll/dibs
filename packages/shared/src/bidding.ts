/**
 * 재입찰(금액 상향) 규칙. — DECISIONS.md D-06
 *
 * 상향만 가능하다. 내리기도, 취소 후 더 낮게 재신청하기도 막는다.
 * 상향하면 lastBidAt이 그 시각으로 갱신되므로, 같은 금액 그룹에서는
 * 뒤로 밀린다. 이게 "그 금액에 먼저 도달한 사람이 이긴다"의 실제 구현이다.
 *
 * 정률 예약금이면 상향은 차액을 만든다. 차액을 새 윈도우 안에 안 내면
 * 금액만 직전 값으로 되돌리고 신청 자체는 살려둔다 — 올리기만 하고
 * 안 내는 어뷰징을 막으면서, 실수한 사람의 자리는 뺏지 않는다.
 *
 * ★ 여기 함수들은 "무엇을 해야 하는가"를 계산할 뿐이다. 실제 강제는
 *   WHERE 절에서 한다. IMPLEMENTATION-CONSTRAINTS IC-12를 보라.
 */

import {
  depositShortfall,
  requiredDeposit,
  validateBidAmount,
  type AmountRule,
  type DepositConfig,
} from './money';
import { combine, invalid, valid, type ValidationResult } from './result';

/** 상향이 가능한지 본다. */
export function validateRaise(
  rule: AmountRule,
  currentAmount: number,
  nextAmount: number,
): ValidationResult {
  const withinRule = validateBidAmount(rule, nextAmount);

  if (nextAmount === currentAmount) {
    return combine(
      withinRule,
      invalid({
        code: 'RAISE_NOT_CHANGED',
        field: 'amount',
        message: '지금 신청한 금액과 같습니다.',
      }),
    );
  }

  if (nextAmount < currentAmount) {
    return combine(
      withinRule,
      invalid({
        code: 'RAISE_ONLY',
        field: 'amount',
        message: `금액은 올릴 수만 있습니다. 현재 ${currentAmount.toLocaleString('ko-KR')}원보다 높게 입력해 주세요.`,
      }),
    );
  }

  return withinRule;
}

/** 상향 요청을 처리하면 무슨 일이 벌어지는가. */
export interface RaisePlan {
  newAmount: number;
  /** 추가로 내야 할 예약금. 0이면 즉시 확정된다. */
  shortfall: number;
  /** 차액을 내야 하는 마감 시각. shortfall이 0이면 null. */
  depositDueAt: Date | null;
  /** 차액 미납 시 되돌아갈 금액. shortfall이 0이면 null. */
  rollbackTo: number | null;
  /**
   * 이 상향이 소프트 클로즈 연장을 유발할 자격이 있는가.
   *
   * 차액이 남아 있는 상향은 아직 유효하지 않으므로 마감을 늘리지 못한다.
   * 안 그러면 돈 한 푼 안 내고 마감을 계속 미룰 수 있다. (D-08)
   */
  mayTriggerSoftClose: boolean;
}

export function planRaise(args: {
  config: DepositConfig;
  currentAmount: number;
  nextAmount: number;
  /** 지금까지 낸 예약금 누계 */
  paidSoFar: number;
  now: Date;
}): RaisePlan {
  const { config, currentAmount, nextAmount, paidSoFar, now } = args;

  const shortfall = depositShortfall(config, nextAmount, paidSoFar);

  if (shortfall === 0) {
    return {
      newAmount: nextAmount,
      shortfall: 0,
      depositDueAt: null,
      rollbackTo: null,
      mayTriggerSoftClose: true,
    };
  }

  return {
    newAmount: nextAmount,
    shortfall,
    depositDueAt: new Date(now.getTime() + config.windowMinutes * 60_000),
    rollbackTo: currentAmount,
    mayTriggerSoftClose: false,
  };
}

/**
 * 롤백이 타당한지 교차 검증한다.
 *
 * 되돌아갈 금액은 낸 예약금으로 감당되어야 한다. 감당되지 않는 값으로
 * 되돌리면 "예약금 미달인데 유효한 신청"이라는 있을 수 없는 상태가 된다.
 */
export function validateRollback(
  config: DepositConfig,
  rollbackTo: number,
  paidSoFar: number,
): ValidationResult {
  const need = requiredDeposit(config, rollbackTo);

  if (paidSoFar < need) {
    return invalid({
      code: 'ROLLBACK_TARGET_UNDERFUNDED',
      field: 'rollbackTo',
      message: `되돌릴 금액 ${rollbackTo.toLocaleString('ko-KR')}원에는 예약금 ${need.toLocaleString('ko-KR')}원이 필요한데 ${paidSoFar.toLocaleString('ko-KR')}원만 납부되었습니다.`,
    });
  }

  return valid();
}

/**
 * 취소 후 재신청의 시계 처리. (D-06 / IC-14)
 *
 * 재신청은 **새 시각**을 받는다. 취소 전 시각을 물려주면 취소·재신청을
 * 반복해 동점 순번을 세탁할 수 있다. 늦게 다시 들어온 사람은 늦은
 * 사람으로 취급하는 게 원래 규칙과도 맞는다.
 */
export function reapplyLastBidAt(now: Date): Date {
  return new Date(now.getTime());
}

/** 재신청 도배를 막는 최소 간격 */
export const REAPPLY_COOLDOWN_MINUTES = 10;

export function canReapply(lastCanceledAt: Date | null, now: Date): ValidationResult {
  if (lastCanceledAt === null) return valid();

  const elapsedMs = now.getTime() - lastCanceledAt.getTime();
  const cooldownMs = REAPPLY_COOLDOWN_MINUTES * 60_000;

  if (elapsedMs < cooldownMs) {
    const waitMinutes = Math.ceil((cooldownMs - elapsedMs) / 60_000);
    return invalid({
      code: 'REAPPLY_TOO_SOON',
      field: 'amount',
      message: `취소 후 ${REAPPLY_COOLDOWN_MINUTES}분이 지나야 다시 신청할 수 있습니다. ${waitMinutes}분 남았습니다.`,
    });
  }

  return valid();
}
