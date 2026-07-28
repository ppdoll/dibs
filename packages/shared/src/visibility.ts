/**
 * 공개 범위 강제. — DECISIONS.md D-07
 *
 * 기간 중 유저가 볼 수 있는 경쟁 정보는 **경쟁률 하나뿐**이다.
 * 금액·개인 순위·커트라인은 전부 감춘다. 자기 순위도 못 본다.
 *
 * 이 규칙은 한 곳에서만 깨져도 끝난다. 응답 하나, 알림 문구 하나,
 * 에러 메시지 하나에 숫자가 새면 되돌릴 수 없다. 그래서 "빼는" 방식이
 * 아니라 **화이트리스트로 새로 만드는** 방식을 쓴다. 필드가 추가돼도
 * 기본이 비공개다.
 */

import { competitionRatio, type CompetitionRatio } from './ranking';

/**
 * 공개 응답에 절대 실리면 안 되는 키.
 * 이름이 조금씩 달라도 걸리도록 소문자 부분일치로 본다.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  'amount',
  'rank',
  'cutoff',
  'bid',
  'deposit',
  'lastbidat',
  'applyseq',
] as const;

/**
 * 부분일치에 걸리지만 실제로는 공개해도 되는 키.
 *
 * minAmount/maxAmount는 이벤트의 **규칙**이다 — "내가 얼마를 써낼 수 있는가"이지
 * "남이 얼마를 썼는가"가 아니다. 이걸 감추면 신청 폼조차 그릴 수 없다.
 * 반면 myAmount처럼 맥락에 따라 갈리는 키는 여기 두지 않고 호출부가 넘긴다.
 */
const DEFAULT_ALLOWED_KEYS: readonly string[] = [
  'capacity',
  'applicantCount',
  'ratio',
  'display',
  'minAmount',
  'maxAmount',
];

/**
 * 유저에게 나가는 이벤트 요약. 이 타입에 없는 건 안 나간다.
 * 금액 규칙(min/max)은 "얼마를 써낼 수 있는가"라 공개해야 하지만,
 * **남이 얼마를 썼는지**는 어디에도 없다.
 */
export interface PublicEventSummary {
  id: string;
  title: string;
  mode: string;
  status: string;
  /** 내가 써낼 수 있는 범위. 남의 입찰가가 아니다. */
  minAmount: number;
  maxAmount: number;
  capacity: number;
  applyStartAt: Date;
  applyEndAt: Date;
  serviceDate: Date | null;
  /** 유일하게 공개되는 경쟁 정보 */
  competition: CompetitionRatio;
}

export function toPublicEventSummary(event: {
  id: string;
  title: string;
  mode: string;
  status: string;
  minAmount: number;
  maxAmount: number;
  capacity: number;
  applyStartAt: Date;
  applyEndAt: Date;
  serviceDate?: Date | null;
  applicantCount: number;
}): PublicEventSummary {
  return {
    id: event.id,
    title: event.title,
    mode: event.mode,
    status: event.status,
    minAmount: event.minAmount,
    maxAmount: event.maxAmount,
    capacity: event.capacity,
    applyStartAt: event.applyStartAt,
    applyEndAt: event.applyEndAt,
    serviceDate: event.serviceDate ?? null,
    competition: competitionRatio(event.capacity, event.applicantCount),
  };
}

/**
 * 내 신청 내역. 내가 쓴 금액은 보여주되, 내 **순위**는 보여주지 않는다.
 *
 * 헷갈리기 쉬운 지점: 내 금액은 내 정보라 공개해도 되지만, 순위는
 * 남들의 금액을 알아야 나오는 값이라 공개하면 커트라인이 역산된다.
 */
export interface MyApplicationView {
  id: string;
  eventId: string;
  myAmount: number;
  status: string;
  appliedAt: Date;
  depositStatus: string;
  depositDueAt: Date | null;
}

export interface LeakScanOptions {
  /**
   * 이 맥락에서만 허용되는 키. 기본 허용 목록에 더해진다.
   *
   * 예: 내 신청 내역 응답은 `['myAmount']`를 넘긴다 — 내 금액은 내 정보라
   * 보여줘도 되지만, 같은 키가 남의 목록에 실리면 그건 유출이다.
   */
  allow?: readonly string[];
}

/**
 * 객체에 새면 안 되는 키가 있는지 재귀로 훑는다.
 *
 * 테스트와 응답 직렬화 경계에서 쓴다. 프로덕션 hot path에서 매번 돌릴
 * 물건은 아니다 — 화이트리스트로 만든 게 진짜 방어이고, 이건 그물이다.
 */
export function findVisibilityLeaks(value: unknown, options: LeakScanOptions = {}): string[] {
  const allowed = new Set([...DEFAULT_ALLOWED_KEYS, ...(options.allow ?? [])]);

  const walk = (node: unknown, path: string): string[] => {
    if (node === null || typeof node !== 'object') return [];
    if (node instanceof Date) return [];

    if (Array.isArray(node)) {
      return node.flatMap((child, i) => walk(child, `${path}[${i}]`));
    }

    const leaks: string[] = [];

    for (const [key, child] of Object.entries(node)) {
      const lower = key.toLowerCase();
      const forbidden =
        !allowed.has(key) && FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));

      if (forbidden) leaks.push(`${path}.${key}`);

      leaks.push(...walk(child, `${path}.${key}`));
    }

    return leaks;
  };

  return walk(value, '$');
}

/**
 * 알림·메일 문구에 숫자가 새는지 본다. (IC-44)
 *
 * "8만원에 밀리셨습니다" 같은 문구는 커트라인을 그대로 알려주는 것과 같다.
 * 템플릿에 넘기는 payload를 여기 통과시킨다.
 */
export function assertNoVisibilityLeak(
  value: unknown,
  context: string,
  options: LeakScanOptions = {},
): void {
  const leaks = findVisibilityLeaks(value, options);
  if (leaks.length > 0) {
    throw new Error(
      `[D-07 위반] ${context}: 공개하면 안 되는 필드가 응답에 있습니다 — ${leaks.join(', ')}`,
    );
  }
}
