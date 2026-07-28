import { DepositType, type EventMode } from '@prisma/client';
import {
  DepositType as SharedDepositType,
  planRaise,
  requiredDeposit,
  type DepositConfig,
  type RaisePlan,
} from '@dibs/shared';

/**
 * 이벤트가 들고 있는 예약금 정책 한 벌. (D-05)
 *
 * 신청·상향·재신청·확정이 전부 이 값들을 읽는데, 이벤트 행에서 매번 골라 담으면
 * 어느 한 곳이 `depositRoundingUnit` 하나를 빠뜨리는 순간 그 경로만 다른 금액을 요구하게 된다.
 * 요구 금액이 경로마다 다르면 "냈는데 부족하다"는 상태가 만들어지고, 그건 CS 로만 발견된다.
 */
export interface EventDepositPolicy {
  depositRequired: boolean;
  depositType: DepositType | null;
  depositFixedAmount: number | null;
  depositPercentBp: number | null;
  depositRoundingUnit: number;
  depositMinAmount: number | null;
  depositMaxAmount: number | null;
  depositWindowMinutes: number;
}

/**
 * 신청 금액에 대해 실제로 요구할 예약금(원).
 *
 * 단위가 스키마와 shared 가 다르다: 스키마는 베이시스포인트(1000 = 10%), shared 는 퍼센트다.
 * bp 를 택한 이유가 2.5% 같은 비율을 부동소수 없이 담기 위해서라 나눗셈으로 왕복이 안 되고,
 * 게다가 스키마에는 shared 가 모르는 `depositRoundingUnit` / `depositMinAmount` / `depositMaxAmount`
 * 가 더 있다. 그래서 **원 단위 금액으로 접는 것은 여기서 한 번만** 하고,
 * shared 에는 그 결과를 FIXED 로 넘긴다(아래 `foldDepositConfig`).
 *
 * 내림(버림)으로 맞추는 이유: 예약금은 정산이 아니라 진지함을 확인하는 관문이므로
 * 1원 단위에서는 유저에게 유리한 쪽으로 둔다(shared/money.ts 와 같은 판단).
 */
export function requiredDepositFor(policy: EventDepositPolicy, amount: number): number {
  if (!policy.depositRequired || amount <= 0) return 0;

  const raw =
    policy.depositType === DepositType.PERCENT
      ? Math.floor((amount * (policy.depositPercentBp ?? 0)) / 10_000)
      : (policy.depositFixedAmount ?? 0);

  const unit = policy.depositRoundingUnit > 0 ? policy.depositRoundingUnit : 1;
  const rounded = Math.floor(raw / unit) * unit;

  // 하한을 라운딩 뒤에 거는 순서가 중요하다. 먼저 걸면 라운딩이 다시 0으로 깎아
  // "필수인데 요구액 0" 이 되고, 그 상태로 Deposit 행을 만들면 amountDue > 0 CHECK 에 걸려
  // 신청 트랜잭션 전체가 죽는다.
  const withMin = policy.depositMinAmount === null ? rounded : Math.max(rounded, policy.depositMinAmount);
  const withMax = policy.depositMaxAmount === null ? withMin : Math.min(withMin, policy.depositMaxAmount);

  // 예약금이 신청 금액을 넘을 수는 없다 — 낙찰가보다 보증금이 비싸지면 안 된다.
  return Math.max(0, Math.min(withMax, amount));
}

/**
 * shared 의 계산기에 넘길 설정. **항상 FIXED 로 접는다.**
 *
 * `requiredDeposit(FIXED, amount) = min(value, amount)` 인데 `value` 에 이미
 * `requiredDepositFor` 의 결과(= amount 이하로 clamp 된 값)를 넣으므로 두 계산이 정확히 일치한다.
 * 이렇게 해야 `planRaise` 가 내놓는 부족분·롤백 목표가 우리가 실제로 청구하는 금액과 어긋나지 않는다.
 * 어긋나면 "부족분을 다 냈는데도 롤백되는" 상태가 만들어진다.
 */
function foldDepositConfig(policy: EventDepositPolicy, amount: number): DepositConfig {
  return {
    required: policy.depositRequired,
    type: SharedDepositType.FIXED,
    value: requiredDepositFor(policy, amount),
    windowMinutes: policy.depositWindowMinutes,
  };
}

/** 지금까지 실효로 납부된 예약금. 환불된 금액은 더 이상 담보가 아니다. */
export function fundedAmount(application: {
  depositPaidAmount: number;
  depositRefundedAmount: number;
}): number {
  return Math.max(0, application.depositPaidAmount - application.depositRefundedAmount);
}

/**
 * 상향 시 무슨 일이 벌어지는가. (D-06)
 *
 * 부족분이 남는 상향은 `mayTriggerSoftClose = false` 다 — 아직 유효하지 않은 입찰이
 * 마감을 미룰 수 있으면 돈 한 푼 안 내고 마감을 계속 연장할 수 있다(D-08 의 의도가 아니다).
 * 계산은 shared 가 하고, 시각은 SQL 의 now() 가 만든다(IC-04) — 그래서 반환된
 * `depositDueAt` 은 "부족분이 있다"는 신호로만 쓰고 컬럼에는 넣지 않는다.
 */
export function planAmountRaise(args: {
  policy: EventDepositPolicy;
  currentAmount: number;
  nextAmount: number;
  paidSoFar: number;
  now: Date;
}): RaisePlan {
  return planRaise({
    config: foldDepositConfig(args.policy, args.nextAmount),
    currentAmount: args.currentAmount,
    nextAmount: args.nextAmount,
    paidSoFar: args.paidSoFar,
    now: args.now,
  });
}

/** 신규 신청·재신청의 예약금 게이트. 상향과 달리 "직전 금액"이라는 개념이 없다. */
export function planInitialDeposit(
  policy: EventDepositPolicy,
  amount: number,
  paidSoFar = 0,
): { required: number; shortfall: number } {
  const config = foldDepositConfig(policy, amount);
  const required = requiredDeposit(config, amount);

  return { required, shortfall: Math.max(0, required - paidSoFar) };
}

/**
 * 예약금 게이트를 통과한 신청의 종착 상태.
 *
 * 두 모드의 종착점이 다르다: INSTANT 는 즉시확정이라 CONFIRMED 에서 끝나고,
 * BID 는 VALID 에서 멈춰 파트너 심사를 기다린다(D-02). 이 분기를 각 서비스가 따로 쓰면
 * 한쪽이 VALID 로 통일하는 순간 INSTANT 이벤트의 파트너 최종명단 화면이 통째로 빈다(IC-32).
 */
export function settledStatusFor(mode: EventMode): 'CONFIRMED' | 'VALID' {
  return mode === 'INSTANT' ? 'CONFIRMED' : 'VALID';
}
