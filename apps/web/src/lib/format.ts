/**
 * 화면에 글자를 만드는 곳. 전부 한국어, 전부 KST.
 *
 * 서버가 주는 날짜는 예외 없이 **ISO 문자열(UTC)** 이다. 사용자의 기기
 * 타임존을 믿으면 해외 로밍 중인 사람에게 마감이 다르게 보인다.
 * 그래서 표시는 @dibs/shared 의 KST 변환을 통해서만 만든다.
 *
 * ★ D-07 — 경쟁 관련 문구는 `formatCompetition` 하나로 모았다.
 *   금액·순위·커트라인이 섞인 문구를 만들 자리를 아예 두지 않기 위해서다.
 */

import { formatKst, toKstParts, type CompetitionRatio } from '@dibs/shared';

// ─── 날짜 기본 ────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** ISO 문자열이든 Date 든 Date 로. 못 읽으면 null — 화면이 "Invalid Date" 를 뱉지 않게. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** KST 벽시계 기준으로 요일 인덱스를 뽑는다. */
function kstWeekday(date: Date): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return WEEKDAYS_KO[shifted.getUTCDay()] ?? '';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ─── 금액 ─────────────────────────────────────────────────────────────

/** 80000 → "80,000원" */
export function formatWon(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '-';
  return `${Math.trunc(amount).toLocaleString('ko-KR')}원`;
}

/** 쉼표만. 입력창 옆에 "원" 을 따로 그릴 때. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return Math.trunc(value).toLocaleString('ko-KR');
}

/**
 * 카드처럼 좁은 자리용 축약. 80000 → "8만원", 1250000 → "125만원".
 * 만 단위로 떨어지지 않으면 축약하지 않는다 — "8.3만원" 은 금액을 흐린다.
 */
export function formatWonCompact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '-';

  const value = Math.trunc(amount);
  if (value >= 100_000_000 && value % 100_000_000 === 0) {
    return `${(value / 100_000_000).toLocaleString('ko-KR')}억원`;
  }
  if (value >= 10_000 && value % 10_000 === 0) {
    return `${(value / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return formatWon(value);
}

/**
 * 이벤트의 금액 규칙 표시. min === max 면 고정 금액이다(D-02).
 * "내가 써낼 수 있는 범위"이지 남이 쓴 금액이 아니다.
 */
export function formatAmountRule(min: number, max: number): string {
  if (min === max) return formatWon(min);
  return `${formatWon(min)} ~ ${formatWon(max)}`;
}

/** 입력창에 찍힌 문자열에서 숫자만 추출. "8만" 같은 건 안 받는다. */
export function parseWonInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

// ─── 경쟁률 (D-07) ────────────────────────────────────────────────────

/**
 * 기간 중 유저에게 보여줄 수 있는 **유일한** 경쟁 정보.
 *
 *   "정원 10명 · 신청 47명 (4.7:1)"
 *
 * ratio 가 null 이면 비공개다. 이때 신청자 수를 대신 보여주면 안 된다 —
 * 서버가 applicantCount 를 0 으로 눌러 보내므로 "0명" 이라는 거짓말이 된다.
 */
export function formatCompetition(competition: CompetitionRatio | null | undefined): string {
  if (!competition || competition.ratio === null) return '경쟁률 비공개';
  return `정원 ${competition.capacity}명 · 신청 ${competition.applicantCount}명 (${competition.display})`;
}

/** 배지처럼 아주 좁은 자리용. "4.7:1" */
export function formatCompetitionShort(competition: CompetitionRatio | null | undefined): string {
  if (!competition || competition.ratio === null) return '-';
  return competition.display;
}

/** "정원 10명" */
export function formatCapacity(capacity: number): string {
  return `정원 ${capacity.toLocaleString('ko-KR')}명`;
}

// ─── 날짜 · 시각 ──────────────────────────────────────────────────────

/** "2026-07-27 14:30" — 로그·표 같은 조밀한 자리. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? formatKst(date) : '-';
}

/** "2026년 7월 27일 (월)" */
export function formatDateKo(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '-';
  const p = toKstParts(date);
  return `${p.year}년 ${p.month}월 ${p.day}일 (${kstWeekday(date)})`;
}

/** "7월 27일 (월)" — 올해 안의 날짜라 연도가 군더더기일 때. */
export function formatMonthDayKo(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '-';
  const p = toKstParts(date);
  return `${p.month}월 ${p.day}일 (${kstWeekday(date)})`;
}

/** "14:30" */
export function formatTimeKo(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '-';
  const p = toKstParts(date);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "7월 27일 (월) 14:30" — 마감·이용일에 쓰는 기본형. */
export function formatDateTimeKo(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '-';
  return `${formatMonthDayKo(date)} ${formatTimeKo(date)}`;
}

/** "2026년 7월 27일 (월) 14:30" — 확인 화면처럼 오해가 없어야 하는 자리. */
export function formatFullDateTimeKo(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '-';
  return `${formatDateKo(date)} ${formatTimeKo(date)}`;
}

/** KST 기준 같은 날인가. "오늘/내일" 판정에 쓴다. */
function sameKstDay(a: Date, b: Date): boolean {
  const pa = toKstParts(a);
  const pb = toKstParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** "오늘 14:30" / "내일 14:30" / "7월 29일 (수) 14:30" */
export function formatRelativeDateTimeKo(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return '-';

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (sameKstDay(date, now)) return `오늘 ${formatTimeKo(date)}`;
  if (sameKstDay(date, tomorrow)) return `내일 ${formatTimeKo(date)}`;
  return formatDateTimeKo(date);
}

/** 알림·쪽지 목록용 상대 시간. "방금 전" / "3분 전" / "어제" / "7월 20일" */
export function formatTimeAgo(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return '';

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return '방금 전';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24 && sameKstDay(date, now)) return `${hours}시간 전`;

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (sameKstDay(date, yesterday)) return '어제';

  const p = toKstParts(date);
  const pNow = toKstParts(now);
  return p.year === pNow.year ? `${p.month}월 ${p.day}일` : `${p.year}. ${p.month}. ${p.day}.`;
}

// ─── 카운트다운 ───────────────────────────────────────────────────────

export interface CountdownParts {
  /** 남은 밀리초. 이미 지났으면 0. */
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** 마감이 지났는가 */
  expired: boolean;
  /** 1시간 미만 — 화면을 빨갛게 만들 기준 */
  urgent: boolean;
}

export function countdownParts(
  target: string | Date | null | undefined,
  now: Date = new Date(),
): CountdownParts {
  const date = toDate(target);
  const totalMs = date ? Math.max(0, date.getTime() - now.getTime()) : 0;

  const totalSeconds = Math.floor(totalMs / 1000);

  return {
    totalMs,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    expired: totalMs <= 0,
    urgent: totalMs > 0 && totalMs < 3_600_000,
  };
}

/**
 * "D-1 03:12:44" / "03:12:44" / "마감"
 *
 * 하루 이상 남았으면 D- 표기를 앞에 붙인다. 하루 미만이면 시:분:초만 —
 * "D-0" 은 사람이 읽을 때 오히려 헷갈린다.
 */
export function formatCountdown(
  target: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const p = countdownParts(target, now);
  if (p.expired) return '마감';

  const clock = `${pad2(p.hours)}:${pad2(p.minutes)}:${pad2(p.seconds)}`;
  return p.days > 0 ? `D-${p.days} ${clock}` : clock;
}

/** "마감까지 D-1 03:12:44" / "신청이 마감되었습니다" */
export function formatDeadlineLabel(
  target: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const p = countdownParts(target, now);
  if (p.expired) return '신청이 마감되었습니다';
  return `마감까지 ${formatCountdown(target, now)}`;
}

/**
 * 예약금 입금 남은 시간처럼 초 단위가 중요한 짧은 타이머. "9분 58초"
 * 카운트다운보다 부드럽게 읽혀서 재촉하는 느낌이 덜하다.
 */
export function formatRemainingKo(
  target: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const p = countdownParts(target, now);
  if (p.expired) return '시간 만료';

  if (p.days > 0) return `${p.days}일 ${p.hours}시간`;
  if (p.hours > 0) return `${p.hours}시간 ${p.minutes}분`;
  if (p.minutes > 0) return `${p.minutes}분 ${p.seconds}초`;
  return `${p.seconds}초`;
}

/** 카운트다운을 몇 ms 마다 다시 그릴지. 하루 이상 남았으면 초 단위로 돌 이유가 없다. */
export function countdownTickMs(parts: CountdownParts): number {
  if (parts.expired) return 60_000;
  return parts.days > 0 ? 30_000 : 1_000;
}

// ─── 도메인 라벨 (용어집) ─────────────────────────────────────────────

/**
 * 유저에게 보이는 말. 입찰·낙찰 같은 경매 용어는 쓰지 않는다.
 * 파트너·운영자 화면은 조금 더 정확한 말을 써도 되지만, 여기 값을
 * 임의로 바꾸면 화면마다 용어가 갈린다.
 */
export const EVENT_MODE_LABEL = {
  INSTANT: '선착순 즉시확정',
  BID: '금액 제안',
} as const;

export const EVENT_MODE_HINT = {
  INSTANT: '정해진 금액으로 신청하면 바로 확정돼요.',
  BID: '원하는 금액을 제안하고 마감 후 발표를 기다려요.',
} as const;

export const EVENT_STATUS_LABEL = {
  DRAFT: '작성 중',
  SCHEDULED: '오픈 예정',
  OPEN: '신청 중',
  CLOSED: '마감',
  FINALIZED: '발표 완료',
  CANCELED: '취소됨',
  SUSPENDED: '일시 중지',
} as const;

export const APPLICATION_STATUS_LABEL = {
  PENDING_DEPOSIT: '예약금 입금 대기',
  VALID: '신청 완료',
  CONFIRMED: '당첨',
  NOT_SELECTED: '미당첨',
  EXPIRED: '기한 만료',
  CANCELED: '취소함',
  REJECTED: '신청 불가',
  EVENT_CANCELED: '이벤트 취소',
} as const;

export const DEPOSIT_STATUS_LABEL = {
  NOT_REQUIRED: '예약금 없음',
  PENDING: '입금 대기',
  PAID: '입금 완료',
  SHORTFALL_PENDING: '차액 입금 대기',
  EXPIRED: '기한 만료',
  SUPERSEDED: '대체됨',
  CANCELED: '취소됨',
  VOIDED: '무효',
  REFUND_REQUESTED: '환불 처리 중',
  REFUNDED: '환불 완료',
  FORFEITED: '반환 불가',
} as const;

export const PARTNER_APPROVAL_LABEL = {
  DRAFT: '작성 중',
  PENDING: '심사 중',
  APPROVED: '승인 완료',
  REJECTED: '반려',
  RESUBMIT_REQUIRED: '보완 요청',
  SUSPENDED: '활동 정지',
  REVOKED: '승인 취소',
} as const;

export const VENUE_STATUS_LABEL = {
  DRAFT: '작성 중',
  PENDING_REVIEW: '검수 중',
  ACTIVE: '노출 중',
  HIDDEN: '노출 중단',
  SUSPENDED: '정지',
  ARCHIVED: '보관됨',
} as const;

/** 사전에 없는 값이 와도 화면이 비지 않게. 키를 그대로 보여주는 편이 공백보다 낫다. */
export function labelOf<T extends Record<string, string>>(
  dict: T,
  key: string | null | undefined,
  fallback = '-',
): string {
  if (!key) return fallback;
  return dict[key] ?? key;
}

/** 사람 이름을 마스킹한다. 파트너가 명단을 볼 때처럼 최소 노출이 필요한 자리. */
export function maskName(name: string | null | undefined): string {
  if (!name || name.length === 0) return '-';
  if (name.length === 1) return name;
  // charAt 을 쓰는 이유: noUncheckedIndexedAccess 에서 name[0] 은 string|undefined 다.
  if (name.length === 2) return `${name.charAt(0)}*`;
  return `${name.charAt(0)}${'*'.repeat(name.length - 2)}${name.charAt(name.length - 1)}`;
}
