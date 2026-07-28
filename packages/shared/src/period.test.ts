import { describe, expect, it } from 'vitest';

import {
  decideSoftClose,
  formatKst,
  toKstParts,
  validatePeriod,
  validateServiceDate,
  validateSoftCloseConfig,
  type ApplicationPeriod,
  type SoftCloseConfig,
} from './period';

const at = (iso: string) => new Date(iso);
const now = at('2026-08-01T00:00:00Z');

const period: ApplicationPeriod = {
  startAt: at('2026-08-02T00:00:00Z'),
  endAt: at('2026-08-10T12:00:00Z'),
};

const codes = (r: ReturnType<typeof validatePeriod>) => (r.ok ? [] : r.issues.map((i) => i.code));

const softClose = (over: Partial<SoftCloseConfig> = {}): SoftCloseConfig => ({
  enabled: true,
  windowMinutes: 10,
  extendMinutes: 10,
  hardEndAt: at('2026-08-10T14:00:00Z'),
  maxExtensionsPerUser: 2,
  ...over,
});

describe('신청 기간 검증', () => {
  it('정상 기간은 통과한다', () => {
    expect(validatePeriod(period, now).ok).toBe(true);
  });

  it('마감이 시작보다 앞서면 거부한다', () => {
    expect(
      codes(validatePeriod({ startAt: at('2026-08-10T00:00:00Z'), endAt: at('2026-08-02T00:00:00Z') }, now)),
    ).toContain('PERIOD_END_BEFORE_START');
  });

  it('이미 지난 마감은 거부한다', () => {
    expect(
      codes(validatePeriod({ startAt: at('2026-07-01T00:00:00Z'), endAt: at('2026-07-10T00:00:00Z') }, now)),
    ).toContain('PERIOD_ALREADY_ENDED');
  });

  it('잘못된 Date는 다른 검사로 넘어가지 않는다', () => {
    const bad = validatePeriod({ startAt: new Date('nope'), endAt: period.endAt }, now);
    expect(codes(bad)).toEqual(['PERIOD_START_INVALID']);
  });
});

describe('이용일 검증', () => {
  it('이용일이 없어도 된다', () => {
    expect(validateServiceDate(null, period).ok).toBe(true);
  });

  it('마감 이후면 통과한다', () => {
    expect(validateServiceDate(at('2026-08-20T00:00:00Z'), period).ok).toBe(true);
  });

  it('마감 전이면 거부한다 — 마감 전에 쓰는 예약은 말이 안 된다', () => {
    const r = validateServiceDate(at('2026-08-05T00:00:00Z'), period);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe('SERVICE_DATE_BEFORE_DEADLINE');
  });
});

describe('소프트 클로즈 설정 검증 (D-08)', () => {
  it('끄면 나머지를 안 본다', () => {
    expect(
      validateSoftCloseConfig(softClose({ enabled: false, windowMinutes: -1, hardEndAt: null }), period).ok,
    ).toBe(true);
  });

  it('정상 설정은 통과한다', () => {
    expect(validateSoftCloseConfig(softClose(), period).ok).toBe(true);
  });

  it('최종 마감 시각이 없으면 거부한다', () => {
    // LEAST(applyEndAt + n, NULL) = NULL 이라 마감이 통째로 사라진다
    const r = validateSoftCloseConfig(softClose({ hardEndAt: null }), period);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('SOFT_CLOSE_HARD_END_REQUIRED');
  });

  it('최종 마감이 신청 마감보다 앞서면 거부한다', () => {
    const r = validateSoftCloseConfig(softClose({ hardEndAt: at('2026-08-09T00:00:00Z') }), period);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('SOFT_CLOSE_HARD_END_BEFORE_END');
  });

  it('연장 폭이 0 이하면 거부한다', () => {
    const r = validateSoftCloseConfig(softClose({ extendMinutes: 0 }), period);
    expect(r.ok).toBe(false);
  });
});

describe('소프트 클로즈 판정 (D-08)', () => {
  const endAt = at('2026-08-10T12:00:00Z');

  it('마감 5분 전 입찰이면 연장한다', () => {
    const d = decideSoftClose({
      config: softClose(),
      currentEndAt: endAt,
      now: at('2026-08-10T11:55:00Z'),
      eligible: true,
      userExtensionCount: 0,
    });

    expect(d.extend).toBe(true);
    expect(d.reason).toBe('EXTENDED');
    expect(d.newEndAt.toISOString()).toBe('2026-08-10T12:10:00.000Z');
  });

  it('감지 시간 밖이면 연장하지 않는다', () => {
    const d = decideSoftClose({
      config: softClose(),
      currentEndAt: endAt,
      now: at('2026-08-10T11:00:00Z'),
      eligible: true,
      userExtensionCount: 0,
    });

    expect(d.extend).toBe(false);
    expect(d.reason).toBe('OUTSIDE_WINDOW');
  });

  it('차액이 남은 상향은 연장하지 못한다', () => {
    const d = decideSoftClose({
      config: softClose(),
      currentEndAt: endAt,
      now: at('2026-08-10T11:55:00Z'),
      eligible: false,
      userExtensionCount: 0,
    });

    expect(d.extend).toBe(false);
    expect(d.reason).toBe('NOT_ELIGIBLE');
  });

  it('1인당 연장 상한에 걸리면 멈춘다 — 정액 예약금 무한 연장 방지 (IC-17)', () => {
    const d = decideSoftClose({
      config: softClose({ maxExtensionsPerUser: 2 }),
      currentEndAt: endAt,
      now: at('2026-08-10T11:55:00Z'),
      eligible: true,
      userExtensionCount: 2,
    });

    expect(d.extend).toBe(false);
    expect(d.reason).toBe('USER_CAP_REACHED');
  });

  it('최종 마감을 넘기지 않는다', () => {
    const nearHardEnd = at('2026-08-10T13:57:00Z');
    const d = decideSoftClose({
      config: softClose({ hardEndAt: at('2026-08-10T14:00:00Z') }),
      currentEndAt: nearHardEnd,
      now: at('2026-08-10T13:55:00Z'),
      eligible: true,
      userExtensionCount: 0,
    });

    expect(d.extend).toBe(true);
    expect(d.newEndAt.toISOString()).toBe('2026-08-10T14:00:00.000Z');
  });

  it('이미 최종 마감이면 더 늘리지 않는다', () => {
    const hardEnd = at('2026-08-10T14:00:00Z');
    const d = decideSoftClose({
      config: softClose({ hardEndAt: hardEnd }),
      currentEndAt: hardEnd,
      now: at('2026-08-10T13:55:00Z'),
      eligible: true,
      userExtensionCount: 0,
    });

    expect(d.extend).toBe(false);
    expect(d.reason).toBe('HARD_END_REACHED');
  });

  it('마감이 이미 지났으면 되살리지 않는다', () => {
    const d = decideSoftClose({
      config: softClose(),
      currentEndAt: endAt,
      now: at('2026-08-10T12:00:01Z'),
      eligible: true,
      userExtensionCount: 0,
    });

    expect(d.extend).toBe(false);
    expect(d.reason).toBe('OUTSIDE_WINDOW');
  });

  it('원본 마감 Date를 변형하지 않는다', () => {
    const original = at('2026-08-10T12:00:00Z');
    decideSoftClose({
      config: softClose(),
      currentEndAt: original,
      now: at('2026-08-10T11:55:00Z'),
      eligible: true,
      userExtensionCount: 0,
    });

    expect(original.toISOString()).toBe('2026-08-10T12:00:00.000Z');
  });
});

describe('한국 시간 표시', () => {
  it('UTC에 9시간을 더한다', () => {
    expect(formatKst(at('2026-08-01T03:00:00Z'))).toBe('2026-08-01 12:00');
  });

  it('날짜가 넘어가는 경계를 제대로 처리한다', () => {
    // UTC 8/1 15:00 → KST 8/2 00:00
    expect(formatKst(at('2026-08-01T15:00:00Z'))).toBe('2026-08-02 00:00');
  });

  it('서버 로컬 타임존과 무관하게 같은 값을 준다', () => {
    // getUTC* 만 쓰므로 Vercel 리전이 어디든 결과가 같다
    const p = toKstParts(at('2026-12-31T15:30:00Z'));
    expect(p).toEqual({ year: 2027, month: 1, day: 1, hour: 0, minute: 30 });
  });
});
