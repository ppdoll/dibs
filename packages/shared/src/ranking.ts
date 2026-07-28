/**
 * 입찰형(BID) 이벤트의 순위 규칙. — DECISIONS.md D-04
 *
 *   1순위: 신청 금액 내림차순
 *   2순위: 그 금액에 도달한 시각(lastBidAt) 오름차순
 *   3순위: applySeq 오름차순  ← 위 둘이 완전히 같을 때를 위한 결정적 tie-break
 *
 * 2순위가 "최초 신청시각"이 아니라 "그 금액에 도달한 시각"인 점이 핵심이다.
 * 같은 금액이면 그 금액을 먼저 부른 사람이 이긴다. 재입찰로 금액을 올리면
 * lastBidAt이 갱신되므로, 늦게 올린 사람은 같은 금액에서 뒤로 밀린다.
 *
 * ─── 권위는 SQL에 있다 ────────────────────────────────────────────────
 *
 * 확정 순위는 반드시 DB에서 계산한다. 이 파일의 함수는 미리보기·테스트용이다.
 *
 *   ORDER BY amount DESC, "lastBidAt" ASC, "applySeq" ASC
 *
 * 이유: Postgres의 lastBidAt은 Timestamptz(6)로 마이크로초 해상도인데
 * JS Date는 밀리초까지만 담는다. Prisma가 Date로 역직렬화하는 순간
 * 마이크로초가 잘리고, 잘린 값끼리는 동점이 되어 3차 키로 떨어진다.
 * 그러면 SQL과 JS의 정렬 결과가 갈린다. 실제로 갈리는 예:
 *
 *   A: lastBidAt=12:00:00.123456, applySeq=50
 *   B: lastBidAt=12:00:00.123999, applySeq=10
 *   SQL → A, B   (123456 < 123999)
 *   JS  → B, A   (둘 다 .123으로 잘려 동점 → applySeq에서 B가 앞)
 *
 * 그래서 이 모듈은 Date를 받지 않고 마이크로초 정수를 요구한다.
 * 타입이 강제하므로 실수로 Date를 흘려넣을 수 없다.
 *
 * 3순위가 id가 아니라 applySeq인 이유:
 * Prisma의 @default(cuid())는 cuid v1이고, 이건 앞부분이 base36 밀리초
 * 타임스탬프라 사실상 시간순으로 정렬된다. 즉 id로 tie-break하면 "우연히"
 * 공정하게 동작한다. cuid2로 바뀌면 정렬성이 사라져 조용히 깨진다.
 * Application.applySeq(BIGSERIAL)로 의도를 명시한다.
 */

/** 1초 = 1,000,000 마이크로초 */
const MICROS_PER_MS = 1_000n;

export interface RankableApplication {
  id: string;
  /** 신청 금액. 순위 기준은 실제 낸 디파짓이 아니라 이 값이다. (D-05) */
  amount: number;
  /**
   * 현재 금액에 도달한 시각. epoch 기준 마이크로초. 재입찰로 상향하면 갱신된다. (D-06)
   * DB의 Timestamptz(6)와 같은 해상도여야 SQL 정렬과 일치한다.
   */
  lastBidAtMicros: bigint;
  /** Application.applySeq (BIGSERIAL). 결정적 3차 tie-break. */
  applySeq: bigint;
}

export interface RankedApplication<T extends RankableApplication> {
  application: T;
  /** 1부터 시작하는 순위 */
  rank: number;
  /** 정원 안에 들어왔는지 (마감 전에는 잠정) */
  withinCapacity: boolean;
}

/**
 * Date를 마이크로초로 올린다.
 *
 * 주의: Date는 밀리초까지만 담으므로 이 값의 하위 3자리는 항상 0이다.
 * DB에서 읽은 값에는 쓰지 마라 — 마이크로초가 이미 잘린 뒤라 SQL 정렬과
 * 어긋난다. 테스트 픽스처나 애초에 밀리초 정밀도인 입력에만 쓴다.
 */
export function microsFromDate(date: Date): bigint {
  return BigInt(date.getTime()) * MICROS_PER_MS;
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 순위 비교 함수. Array.prototype.sort에 그대로 넘길 수 있다.
 * 음수면 a가 앞선다(= 더 높은 순위).
 */
export function compareByRank(a: RankableApplication, b: RankableApplication): number {
  if (a.amount !== b.amount) {
    return b.amount - a.amount; // 금액 내림차순
  }

  const byTime = compareBigInt(a.lastBidAtMicros, b.lastBidAtMicros);
  if (byTime !== 0) {
    return byTime; // 먼저 그 금액에 도달한 사람이 앞
  }

  return compareBigInt(a.applySeq, b.applySeq); // 결정적 tie-break
}

/**
 * 신청 목록에 순위를 매긴다.
 *
 * 입력은 이미 순위 대상만 걸러진 상태여야 한다.
 * BID는 status='VALID', INSTANT는 status='CONFIRMED'가 대상이다
 * (취소·만료·디파짓 미납은 제외). 원본 배열은 건드리지 않는다.
 */
export function rankApplications<T extends RankableApplication>(
  applications: readonly T[],
  capacity: number,
): RankedApplication<T>[] {
  return [...applications].sort(compareByRank).map((application, index) => ({
    application,
    rank: index + 1,
    withinCapacity: index < capacity,
  }));
}

/**
 * 순위 확정 시각 = 마감시각 + 디파짓 윈도우. (D-04)
 *
 * 마감 1분 전에 신청한 사람도 디파짓 10분을 온전히 쓸 수 있어야 하므로,
 * 마감 시점이 아니라 이 시각에 순위를 확정한다.
 */
export function rankingFinalizesAt(
  deadline: Date,
  depositWindowMinutes: number,
  depositRequired: boolean,
): Date {
  if (!depositRequired) return new Date(deadline.getTime());
  return new Date(deadline.getTime() + depositWindowMinutes * 60_000);
}

/**
 * 경쟁률. 기간 중 유저에게 공개되는 유일한 경쟁 정보다. (D-07)
 * 금액·개인 순위·커트라인은 절대 함께 내보내지 않는다.
 */
export interface CompetitionRatio {
  capacity: number;
  applicantCount: number;
  /** 정원 대비 배수. 정원이 0이면 null. */
  ratio: number | null;
  /** 표시용 문자열 예: "4.7:1" */
  display: string;
}

export function competitionRatio(capacity: number, applicantCount: number): CompetitionRatio {
  const ratio = capacity > 0 ? applicantCount / capacity : null;
  return {
    capacity,
    applicantCount,
    ratio,
    display: ratio === null ? '-' : `${ratio.toFixed(1)}:1`,
  };
}
