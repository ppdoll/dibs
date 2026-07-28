/**
 * 신청 기간과 소프트 클로즈. — DECISIONS.md D-04, D-08
 *
 * 저장은 전부 UTC(Timestamptz)다. 한국 시간은 표시할 때만 만든다.
 * 서버가 Vercel의 어느 리전에서 뜨든 결과가 같아야 하므로, 로컬 타임존에
 * 의존하는 Date 메서드(getHours 등)는 도메인 로직에서 쓰지 않는다.
 */

import { invalid, valid, combine, type ValidationResult } from './result';

export const KST_OFFSET_MINUTES = 9 * 60;

/** 신청 기간 */
export interface ApplicationPeriod {
  startAt: Date;
  endAt: Date;
}

/** 소프트 클로즈 설정 (D-08) */
export interface SoftCloseConfig {
  enabled: boolean;
  /** 마감 몇 분 전에 들어온 입찰이 연장을 유발하는가 */
  windowMinutes: number;
  /** 유발되면 몇 분 미루는가 */
  extendMinutes: number;
  /** 아무리 연장해도 이 시각은 넘지 않는다 */
  hardEndAt: Date | null;
  /** 1인이 유발할 수 있는 연장 횟수 상한 (IC-17) */
  maxExtensionsPerUser: number;
}

export function validatePeriod(period: ApplicationPeriod, now: Date): ValidationResult {
  const checks: ValidationResult[] = [];

  if (!(period.startAt instanceof Date) || Number.isNaN(period.startAt.getTime())) {
    checks.push(
      invalid({ code: 'PERIOD_START_INVALID', field: 'applyStartAt', message: '신청 시작 일시가 올바르지 않습니다.' }),
    );
  }

  if (!(period.endAt instanceof Date) || Number.isNaN(period.endAt.getTime())) {
    checks.push(
      invalid({ code: 'PERIOD_END_INVALID', field: 'applyEndAt', message: '신청 마감 일시가 올바르지 않습니다.' }),
    );
  }

  if (checks.length > 0) return combine(...checks);

  if (period.endAt.getTime() <= period.startAt.getTime()) {
    checks.push(
      invalid({
        code: 'PERIOD_END_BEFORE_START',
        field: 'applyEndAt',
        message: '마감이 시작보다 앞설 수 없습니다.',
      }),
    );
  }

  if (period.endAt.getTime() <= now.getTime()) {
    checks.push(
      invalid({
        code: 'PERIOD_ALREADY_ENDED',
        field: 'applyEndAt',
        message: '마감 일시가 이미 지났습니다.',
      }),
    );
  }

  return combine(...checks);
}

/** 이용일은 신청 마감 이후여야 한다. 마감 전에 쓰는 예약은 말이 안 된다. */
export function validateServiceDate(
  serviceDate: Date | null,
  period: ApplicationPeriod,
): ValidationResult {
  if (serviceDate === null) return valid();

  if (serviceDate.getTime() < period.endAt.getTime()) {
    return invalid({
      code: 'SERVICE_DATE_BEFORE_DEADLINE',
      field: 'serviceDate',
      message: '이용일은 신청 마감 이후여야 합니다.',
    });
  }

  return valid();
}

export function validateSoftCloseConfig(
  config: SoftCloseConfig,
  period: ApplicationPeriod,
): ValidationResult {
  if (!config.enabled) return valid();

  const checks: ValidationResult[] = [];

  if (!Number.isInteger(config.windowMinutes) || config.windowMinutes <= 0) {
    checks.push(
      invalid({
        code: 'SOFT_CLOSE_WINDOW_INVALID',
        field: 'softCloseWindowMinutes',
        message: '자동 연장 감지 시간은 1분 이상이어야 합니다.',
      }),
    );
  }

  if (!Number.isInteger(config.extendMinutes) || config.extendMinutes <= 0) {
    checks.push(
      invalid({
        code: 'SOFT_CLOSE_EXTEND_INVALID',
        field: 'softCloseExtendMinutes',
        message: '자동 연장 폭은 1분 이상이어야 합니다.',
      }),
    );
  }

  // hardEndAt이 없으면 LEAST(applyEndAt + n, NULL) = NULL 이 되어 마감이 통째로
  // 사라진다. 연장을 켤 거면 상한은 필수다.
  if (config.hardEndAt === null) {
    checks.push(
      invalid({
        code: 'SOFT_CLOSE_HARD_END_REQUIRED',
        field: 'softCloseHardEndAt',
        message: '자동 연장을 켜면 최종 마감 시각을 반드시 정해야 합니다.',
      }),
    );
  } else if (config.hardEndAt.getTime() < period.endAt.getTime()) {
    checks.push(
      invalid({
        code: 'SOFT_CLOSE_HARD_END_BEFORE_END',
        field: 'softCloseHardEndAt',
        message: '최종 마감 시각이 신청 마감보다 앞설 수 없습니다.',
      }),
    );
  }

  if (!Number.isInteger(config.maxExtensionsPerUser) || config.maxExtensionsPerUser < 0) {
    checks.push(
      invalid({
        code: 'SOFT_CLOSE_USER_CAP_INVALID',
        field: 'softCloseMaxExtensionsPerUser',
        message: '1인당 연장 횟수 상한은 0 이상의 정수여야 합니다.',
      }),
    );
  }

  return combine(...checks);
}

/** 소프트 클로즈 판정 결과 */
export interface SoftCloseDecision {
  extend: boolean;
  /** 연장한다면 새 마감 시각. 아니면 기존 값 그대로. */
  newEndAt: Date;
  reason:
    | 'DISABLED'
    | 'OUTSIDE_WINDOW'
    | 'USER_CAP_REACHED'
    | 'HARD_END_REACHED'
    | 'NOT_ELIGIBLE'
    | 'EXTENDED';
}

/**
 * 지금 들어온 입찰이 마감을 미루는가. (D-08)
 *
 * 금액이 1순위라 다들 마지막 순간에 넣으려 한다. 막판 입찰이 들어오면
 * 마감을 미뤄서, 남들이 대응할 시간을 주고 스나이핑의 이득을 없앤다.
 *
 * 세 가지가 막는다:
 *   1. 차액이 남은 상향은 자격이 없다(eligible=false). 안 그러면 공짜로 미룬다.
 *   2. 1인당 연장 횟수 상한. 정액 예약금이면 상향 비용이 0이라 무한 연장이 된다.
 *   3. hardEndAt. 아무리 미뤄도 이 선을 넘지 않는다.
 */
export function decideSoftClose(args: {
  config: SoftCloseConfig;
  currentEndAt: Date;
  now: Date;
  /** 이 입찰이 연장을 유발할 자격이 있는가 (RaisePlan.mayTriggerSoftClose) */
  eligible: boolean;
  /** 이 유저가 이미 유발한 연장 횟수 */
  userExtensionCount: number;
}): SoftCloseDecision {
  const { config, currentEndAt, now, eligible, userExtensionCount } = args;
  const unchanged = new Date(currentEndAt.getTime());

  if (!config.enabled || config.hardEndAt === null) {
    return { extend: false, newEndAt: unchanged, reason: 'DISABLED' };
  }

  if (!eligible) {
    return { extend: false, newEndAt: unchanged, reason: 'NOT_ELIGIBLE' };
  }

  const msLeft = currentEndAt.getTime() - now.getTime();
  if (msLeft < 0 || msLeft > config.windowMinutes * 60_000) {
    return { extend: false, newEndAt: unchanged, reason: 'OUTSIDE_WINDOW' };
  }

  if (userExtensionCount >= config.maxExtensionsPerUser) {
    return { extend: false, newEndAt: unchanged, reason: 'USER_CAP_REACHED' };
  }

  const proposed = currentEndAt.getTime() + config.extendMinutes * 60_000;
  const capped = Math.min(proposed, config.hardEndAt.getTime());

  if (capped <= currentEndAt.getTime()) {
    return { extend: false, newEndAt: unchanged, reason: 'HARD_END_REACHED' };
  }

  return { extend: true, newEndAt: new Date(capped), reason: 'EXTENDED' };
}

/** 화면 표시용 한국 시간 문자열. 저장에는 절대 쓰지 않는다. */
export function toKstParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const shifted = new Date(date.getTime() + KST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function formatKst(date: Date): string {
  const p = toKstParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
