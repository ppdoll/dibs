import { ApplicationStatus, DepositType, EventMode, EventStatus } from '@prisma/client';
import {
  combine,
  invalid,
  orThrow,
  rankingFinalizesAt,
  toKstParts,
  valid,
  validateAmountRule,
  validateDepositConfig,
  validatePeriod,
  validateServiceDate,
  validateSoftCloseConfig,
  type AmountRule,
  type DepositConfig,
  type ValidationResult,
} from '@dibs/shared';

/**
 * 순위 확정 시각에 붙이는 유예. (D-04 / event_ranking_lock_after_end_chk)
 *
 * 예약금이 필요 없는 이벤트는 rankingFinalizesAt() 이 마감시각을 그대로 돌려주는데,
 * CHECK 는 `rankingLockAt > applyEndAt` 을 요구한다. 1분을 더해야 두 경우가 모두 성립하고,
 * 마감 직전에 커밋된 트랜잭션이 확정 크론과 같은 초에 부딪히는 것도 함께 피한다.
 */
export const FINALIZE_GRACE_MINUTES = 1;

/**
 * 이벤트가 "진행 중"인 상태들.
 *
 * 이 구간에서는 금액 규칙이 잠기고(IC-64) 예약금 윈도우를 줄일 수 없다(IC-26).
 * IC-64 의 조문은 OPEN/CLOSED 만 말하지만 SCHEDULED 를 포함시킨 이유가 있다:
 * SCHEDULED 는 이미 공개 목록에 노출되는 상태라(IC-51) 유저가 그 금액을 보고 일정을 잡는다.
 * 신청이 0건이어도 "공개된 조건이 조용히 바뀌는" 것은 같은 종류의 소급 적용이다.
 */
export const LIVE_EVENT_STATUSES: readonly EventStatus[] = [
  EventStatus.SCHEDULED,
  EventStatus.OPEN,
  EventStatus.CLOSED,
];

/** 파트너가 내용을 고칠 수 있는 상태. FINALIZED/CANCELED/SUSPENDED 는 편집 대상이 아니다. */
export const EDITABLE_EVENT_STATUSES: readonly EventStatus[] = [
  EventStatus.DRAFT,
  ...LIVE_EVENT_STATUSES,
];

/**
 * 아직 종결되지 않은 신청 상태. (IC-64 의 술어와 같은 집합의 여집합)
 * 이 상태의 신청이 하나라도 있으면 금액 규칙 변경은 "돈이 걸린 소급 적용"이 된다.
 */
export const TERMINAL_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.CANCELED,
  ApplicationStatus.EXPIRED,
  ApplicationStatus.NOT_SELECTED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.EVENT_CANCELED,
];

/**
 * validatePeriod 의 "이미 지난 마감" 검사를 끄기 위한 기준 시각.
 *
 * 마감이 지난 이벤트에도 합법적인 수정이 있다 — IC-26 이 허용하는 **예약금 윈도우 연장**이 그렇다.
 * 그때 마감이 과거인 것은 오류가 아니라 정상이므로, 검사를 통째로 빼는 대신
 * "시작 < 마감" 같은 나머지 정합성은 그대로 돌리도록 기준 시각만 epoch 로 내린다.
 */
const EPOCH = new Date(0);

export interface PolicyValidationOptions {
  /** 마감이 미래여야 하는가. 생성·공개 경로는 true, 이미 진행/종료된 이벤트 수정은 false. */
  enforceFuturePeriod: boolean;
}

/** 검증에 필요한 이벤트 정책 값 한 벌. 생성 DTO 와 기존 행이 같은 모양으로 들어온다. */
export interface EventPolicyInput {
  mode: EventMode;
  capacity: number;
  fixedAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  amountStep: number;
  applyStartAt: Date;
  applyEndAt: Date;
  serviceStartAt: Date | null;
  serviceEndAt: Date | null;
  depositRequired: boolean;
  depositType: DepositType | null;
  depositFixedAmount: number | null;
  depositPercentBp: number | null;
  depositRoundingUnit: number;
  depositMinAmount: number | null;
  depositMaxAmount: number | null;
  depositWindowMinutes: number;
  softCloseEnabled: boolean;
  softCloseWindowMinutes: number | null;
  softCloseExtendMinutes: number | null;
  softCloseHardEndAt: Date | null;
  softCloseMaxExtensions: number;
  softCloseMaxExtensionsPerUser: number;
}

/**
 * 모드별 금액 규칙을 하나의 AmountRule 로 접는다.
 *
 * INSTANT 는 fixedAmount 한 칸, BID 는 min/max 두 칸을 쓰고 두 벌이 **배타적**이다
 * (event_mode_amount_chk). 두 벌이 다 채워지면 "신청 시 어느 컬럼을 읽는가"가 코드마다 갈리므로,
 * 읽는 쪽은 반드시 이 함수 하나를 통과한다.
 */
export function amountRuleOf(input: {
  mode: EventMode;
  fixedAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
}): AmountRule | null {
  if (input.mode === EventMode.INSTANT) {
    return input.fixedAmount === null ? null : { min: input.fixedAmount, max: input.fixedAmount };
  }

  return input.minAmount === null || input.maxAmount === null
    ? null
    : { min: input.minAmount, max: input.maxAmount };
}

/**
 * shared 의 DepositConfig 로 옮긴다.
 *
 * 단위가 다르다: shared 는 퍼센트(1~100), 스키마는 베이시스포인트(1~10000)다.
 * bp 를 택한 건 2.5% 같은 소수점 비율을 부동소수 없이 담기 위해서라 나눗셈으로 왕복이 안 된다.
 * 그래서 shared 에는 반올림한 퍼센트를 넘겨 "말이 되는 비율인가"만 보게 하고,
 * bp 자체의 정확한 범위는 아래 validateEventPolicy 가 따로 본다.
 *
 * 종류를 아직 안 골랐으면 `null` 을 돌려 이 검사를 통째로 건너뛴다. FIXED 로 가정하고 넘기면
 * shared 가 "예약금은 1원 이상"(field: depositValue)이라고 답하는데, 그건 DTO 에 없는 칸이라
 * 화면이 어디에도 표시하지 못한다. 그 경우의 진짜 오류는 checkDepositBounds 가 낸다.
 */
function toDepositConfig(input: EventPolicyInput): DepositConfig | null {
  const type = input.depositType;

  if (input.depositRequired && type === null) return null;

  return {
    required: input.depositRequired,
    type: type ?? DepositType.FIXED,
    value:
      type === DepositType.PERCENT
        ? Math.max(1, Math.round((input.depositPercentBp ?? 0) / 100))
        : (input.depositFixedAmount ?? 0),
    windowMinutes: input.depositWindowMinutes,
  };
}

/**
 * 순위 확정 시각. = 마감 + (예약금 윈도우) + 유예 1분. (D-04)
 *
 * applyEndAt 에서 파생하는 계산이라 JS 로 만들어도 결정적이다 — IC-04 가 금지하는 건
 * **"지금"을 JS 로 만들어 순위 컬럼에 넣는 것**이지 확정된 시각의 산술이 아니다.
 * 소프트 클로즈 연장은 마감 자체를 DB 안에서 옮기므로, 그쪽은 SQL 이 같은 식을 다시 계산한다(IC-17).
 */
export function computeRankingLockAt(input: {
  applyEndAt: Date;
  depositRequired: boolean;
  depositWindowMinutes: number;
}): Date {
  const base = rankingFinalizesAt(
    input.applyEndAt,
    input.depositWindowMinutes,
    input.depositRequired,
  );

  return new Date(base.getTime() + FINALIZE_GRACE_MINUTES * 60_000);
}

/**
 * 이용일의 KST 날짜 문자열. event_service_date_format_chk 가 'YYYY-MM-DD' 를 요구한다.
 * 저장은 UTC 이고 이 컬럼은 **검색 필터 전용 파생값**이라, 벽시계 변환을 여기 한 곳에서만 한다.
 */
export function toServiceDateKst(serviceStartAt: Date | null): string | null {
  if (serviceStartAt === null) return null;

  const p = toKstParts(serviceStartAt);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * 이벤트 정책 전체 검증. 실패하면 DomainValidationError 를 던진다
 * (DomainExceptionFilter 가 issues 배열째로 400 에 실어 화면이 필드별로 표시한다).
 *
 * 여기서 거르는 것들은 대부분 001_constraints.sql 의 CHECK 로도 막히지만,
 * CHECK 위반은 P2004 → "요청을 처리할 수 없는 상태입니다" 라는 무의미한 문구로 나간다.
 * 파트너가 어느 칸을 고쳐야 하는지 알 수 있어야 하므로 코드에서 먼저 본다.
 */
export function validateEventPolicy(
  input: EventPolicyInput,
  now: Date,
  options: PolicyValidationOptions = { enforceFuturePeriod: true },
): void {
  const period = { startAt: input.applyStartAt, endAt: input.applyEndAt };
  const rule = amountRuleOf(input);
  const deposit = toDepositConfig(input);

  const checks: ValidationResult[] = [
    rule === null
      ? invalid({
          code: 'AMOUNT_RULE_MISSING',
          field: input.mode === EventMode.INSTANT ? 'fixedAmount' : 'minAmount',
          message:
            input.mode === EventMode.INSTANT
              ? '선착순 즉시확정은 고정 금액을 입력해야 합니다.'
              : '입찰형은 최소·최대 금액을 모두 입력해야 합니다.',
        })
      : validateAmountRule(rule, input.mode),
    validatePeriod(period, options.enforceFuturePeriod ? now : EPOCH),
    validateServiceDate(input.serviceStartAt, period),
    deposit === null ? valid() : validateDepositConfig(deposit),
    checkExclusiveAmountColumns(input),
    checkAmountStep(input, rule),
    checkCapacity(input),
    checkDepositBounds(input),
    checkServiceRange(input),
    checkSoftClose(input, period),
  ];

  orThrow(combine(...checks));
}

/** event_mode_amount_chk 의 배타성. 두 벌이 다 채워지면 읽는 쪽이 갈린다. */
function checkExclusiveAmountColumns(input: EventPolicyInput): ValidationResult {
  if (input.mode === EventMode.INSTANT && (input.minAmount !== null || input.maxAmount !== null)) {
    return invalid({
      code: 'INSTANT_AMOUNT_RANGE_NOT_ALLOWED',
      field: 'minAmount',
      message: '선착순 즉시확정에는 금액 범위를 쓸 수 없습니다. 고정 금액만 입력해 주세요.',
    });
  }

  if (input.mode === EventMode.BID && input.fixedAmount !== null) {
    return invalid({
      code: 'BID_FIXED_AMOUNT_NOT_ALLOWED',
      field: 'fixedAmount',
      message: '입찰형에는 고정 금액 칸을 쓸 수 없습니다. 최소·최대 금액으로 입력해 주세요(같게 두면 고정가).',
    });
  }

  return valid();
}

/**
 * amountStep 은 신청 검증식 `(amount - minAmount) % amountStep` 의 제수다.
 * 0 이면 모든 신청에서 0 나누기가 되므로 DB CHECK 가 막지만, 범위가 step 의 배수가
 * 아니면 **최대 금액을 아무도 못 부른다** — 그건 CHECK 가 잡아주지 않는다.
 */
function checkAmountStep(input: EventPolicyInput, rule: AmountRule | null): ValidationResult {
  if (!Number.isInteger(input.amountStep) || input.amountStep < 1) {
    return invalid({
      code: 'AMOUNT_STEP_INVALID',
      field: 'amountStep',
      message: '금액 단위는 1원 이상의 정수여야 합니다.',
    });
  }

  if (rule === null || input.mode !== EventMode.BID) return valid();

  if ((rule.max - rule.min) % input.amountStep !== 0) {
    return invalid({
      code: 'AMOUNT_STEP_NOT_ALIGNED',
      field: 'amountStep',
      message: '최대 금액이 금액 단위에 맞지 않습니다. 아무도 최대 금액을 부를 수 없게 됩니다.',
    });
  }

  return valid();
}

function checkCapacity(input: EventPolicyInput): ValidationResult {
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return invalid({
      code: 'CAPACITY_INVALID',
      field: 'capacity',
      message: '정원은 1명 이상의 정수여야 합니다.',
    });
  }

  return valid();
}

/** event_deposit_policy_chk 중 코드가 먼저 말해줘야 하는 것들(종류 선택·bp 범위·상하한 순서·반올림 단위). */
function checkDepositBounds(input: EventPolicyInput): ValidationResult {
  if (!input.depositRequired) return valid();

  const checks: ValidationResult[] = [];

  // 종류를 먼저 본다. toDepositConfig 는 NULL 이면 FIXED 로 가정하고 넘기므로,
  // 이 검사가 없으면 "종류를 안 골랐다"가 shared 쪽에서 "예약금이 0원이다"(field: depositValue)로
  // 둔갑한다 — 존재하지도 않는 칸을 가리키는 오류가 되고, 파트너는 뭘 고쳐야 할지 알 수 없다.
  if (input.depositType === null) {
    checks.push(
      invalid({
        code: 'DEPOSIT_TYPE_REQUIRED',
        field: 'depositType',
        message: '예약금을 받으려면 정액(FIXED)인지 정률(PERCENT)인지 골라 주세요.',
      }),
    );
  }

  if (input.depositType === DepositType.FIXED && input.depositFixedAmount === null) {
    checks.push(
      invalid({
        code: 'DEPOSIT_FIXED_AMOUNT_REQUIRED',
        field: 'depositFixedAmount',
        message: '정액 예약금을 선택했으면 금액을 입력해 주세요.',
      }),
    );
  }

  if (input.depositType === DepositType.PERCENT) {
    const bp = input.depositPercentBp;
    if (bp === null || !Number.isInteger(bp) || bp < 1 || bp > 10_000) {
      checks.push(
        invalid({
          code: 'DEPOSIT_PERCENT_BP_OUT_OF_RANGE',
          field: 'depositPercentBp',
          message: '예약금 비율은 1 ~ 10000 베이시스포인트(0.01% ~ 100%) 사이의 정수여야 합니다.',
        }),
      );
    }
  }

  if (!Number.isInteger(input.depositRoundingUnit) || input.depositRoundingUnit < 1) {
    checks.push(
      invalid({
        code: 'DEPOSIT_ROUNDING_UNIT_INVALID',
        field: 'depositRoundingUnit',
        message: '예약금 절사 단위는 1원 이상이어야 합니다.',
      }),
    );
  }

  if (
    input.depositMinAmount !== null &&
    input.depositMaxAmount !== null &&
    input.depositMaxAmount < input.depositMinAmount
  ) {
    checks.push(
      invalid({
        code: 'DEPOSIT_BOUNDS_INVERTED',
        field: 'depositMaxAmount',
        message: '예약금 상한이 하한보다 작을 수 없습니다.',
      }),
    );
  }

  return combine(...checks);
}

function checkServiceRange(input: EventPolicyInput): ValidationResult {
  if (input.serviceStartAt === null || input.serviceEndAt === null) return valid();

  if (input.serviceEndAt.getTime() < input.serviceStartAt.getTime()) {
    return invalid({
      code: 'SERVICE_RANGE_INVERTED',
      field: 'serviceEndAt',
      message: '이용 종료 일시가 시작 일시보다 앞설 수 없습니다.',
    });
  }

  return valid();
}

/**
 * 소프트 클로즈. (D-08 / IC-17)
 *
 * BID 전용인 이유: 금액 경쟁이 없는 INSTANT 에는 스나이핑이라는 개념 자체가 없다.
 * hardEndAt 필수인 이유는 shared 쪽 주석대로 LEAST 의 NULL 전파다.
 */
function checkSoftClose(
  input: EventPolicyInput,
  period: { startAt: Date; endAt: Date },
): ValidationResult {
  if (!input.softCloseEnabled) return valid();

  const checks: ValidationResult[] = [];

  if (input.mode !== EventMode.BID) {
    checks.push(
      invalid({
        code: 'SOFT_CLOSE_BID_ONLY',
        field: 'softCloseEnabled',
        message: '자동 연장은 입찰형에서만 켤 수 있습니다.',
      }),
    );
  }

  if (!Number.isInteger(input.softCloseMaxExtensions) || input.softCloseMaxExtensions < 0) {
    checks.push(
      invalid({
        code: 'SOFT_CLOSE_MAX_EXTENSIONS_INVALID',
        field: 'softCloseMaxExtensions',
        message: '전체 연장 횟수 상한은 0 이상의 정수여야 합니다.',
      }),
    );
  }

  checks.push(
    validateSoftCloseConfig(
      {
        enabled: input.softCloseEnabled,
        windowMinutes: input.softCloseWindowMinutes ?? 0,
        extendMinutes: input.softCloseExtendMinutes ?? 0,
        hardEndAt: input.softCloseHardEndAt,
        maxExtensionsPerUser: input.softCloseMaxExtensionsPerUser,
      },
      period,
    ),
  );

  return combine(...checks);
}
