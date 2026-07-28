/** 이벤트 진행 방식 (D-02) */
export const EventMode = {
  /** 선착순 즉시확정 — 고정 금액, 신청 즉시 당락 확정 */
  INSTANT: 'INSTANT',
  /** 금액 입찰형 — 마감 후 순위로 선정 */
  BID: 'BID',
} as const;
export type EventMode = (typeof EventMode)[keyof typeof EventMode];

/** 신청 금액의 허용 범위 (0 ~ Int max) */
export const AMOUNT_MIN = 0;
export const AMOUNT_MAX = 2_147_483_647;

/** 디파짓 기본 윈도우 (D-05) */
export const DEFAULT_DEPOSIT_WINDOW_MINUTES = 10;

/** 소프트 클로즈 기본 연장 폭 (D-08) */
export const DEFAULT_SOFT_CLOSE_MINUTES = 10;

/**
 * 순위 집계에 포함되는 신청 상태.
 * 디파짓은 자격 요건이므로, 미납(PENDING_DEPOSIT) 상태는 순위에 들어가지 않는다. (D-05)
 */
export const RANKABLE_STATUSES = ['VALID', 'CONFIRMED'] as const;
