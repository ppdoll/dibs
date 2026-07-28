/**
 * 이벤트 상세 하위 세 화면(신청 현황 · 당첨자 확정 · 쪽지)만 쓰는 호출.
 *
 * 선정 라운드·이벤트 조회처럼 콘솔 전체가 쓰는 것은 `partner/_lib/api.ts` 에 이미 있고
 * 여기서 다시 만들지 않는다. 이 파일에는 **그 목록에 아직 없는 두 가지**만 둔다.
 *
 *  1. `listLiveApplicants` — 라운드가 열리기 전에도 "누가 얼마에 신청했는지"를 보는 새 경로.
 *  2. `sendEventBroadcast` — 쪽지 발송. 서버가 **본문에** `idempotencyKey` 를 필수로 받는다.
 *     헤더의 `Idempotency-Key` 가 아니라 body 필드다(SendEventMessageDto). 이걸 빼면 400 이고,
 *     같은 키로 다시 부르면 같은 발송이 돌아온다 — 발송 버튼이 두 번 눌려도 쪽지는 한 번이다.
 *
 * 경로는 `docs/API-ROUTES.md` 그대로 쓴다(`/api` 포함).
 */

import { apiGet, apiPost } from '@/lib/api-client';
import type { ApplicationStatus, DepositStatus, EventStatus } from '@/types/api';
import type { NotificationChannel, SendEventMessageResult } from '../../../_lib/types';

// ─── 진행 중 신청자 (잠정 순위) ───────────────────────────────────────

/** `RANKED` = 순위 집계 대상(VALID/CONFIRMED), `PENDING_DEPOSIT` = 예약금 미납. */
export type LiveApplicantBucket = 'RANKED' | 'PENDING_DEPOSIT';

/**
 * 신청자 한 줄.
 *
 * ★ `provisionalPosition` 은 **잠정 순위**다. 마감 전까지 상향 신청과 예약금 만료로 계속 바뀐다.
 * 확정 순위는 라운드가 얼린 `PartnerSelectionEntry.rankNo` 쪽이다. 이름이 다른 것이 방어선이라
 * 화면에서 두 값을 같은 변수에 담지 않는다.
 */
export interface LiveApplicant {
  applicationId: string;
  /** 서버가 마스킹해서 보낸다 (홍*동). 실명 전체는 확정 화면·CSV 에만 있다. */
  displayName: string;
  amount: number;
  appliedAt: string;
  lastBidAt: string;
  status: ApplicationStatus;
  depositStatus: DepositStatus;
  depositPaid: number;
  depositRequired: number;
  depositSettled: boolean;
  provisionalPosition: number | null;
}

export interface LiveApplicantSummary {
  capacity: number;
  validCount: number;
  pendingDepositCount: number;
  /** 경쟁률 ×10. 47명/10석이면 47. 정원이 0이면 null. */
  competitionRatioX10: number | null;
  eventStatus: EventStatus;
  applyEndAt: string;
  rankingLockAt: string | null;
  /** false 면 목록의 순위는 전부 잠정이다. 화면이 그렇게 말해야 한다. */
  rankingLocked: boolean;
}

export interface LiveApplicantPage {
  summary: LiveApplicantSummary;
  items: LiveApplicant[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface LiveApplicantQuery {
  bucket?: LiveApplicantBucket;
  cursor?: string;
  limit?: number;
}

export function listLiveApplicants(
  eventId: string,
  query: LiveApplicantQuery,
  signal?: AbortSignal,
): Promise<LiveApplicantPage> {
  return apiGet<LiveApplicantPage>(
    `/api/partner/selections/by-event/${eventId}/live-applicants`,
    // query 는 undefined/null/'' 를 알아서 빼 준다. 필터 객체를 통째로 넘겨도 안전하다.
    { query: { ...query }, ...(signal ? { signal } : {}) },
  );
}

// ─── 쪽지 발송 ────────────────────────────────────────────────────────

export interface SendEventBroadcastBody {
  titleKo: string;
  bodyKo: string;
  /** 비우면 전체 신청자 */
  applicationStatuses?: ApplicationStatus[];
  channels?: NotificationChannel[];
  /** ★ 본문 필수 필드. 재시도는 반드시 같은 키로 한다. */
  idempotencyKey: string;
}

export function sendEventBroadcast(
  eventId: string,
  body: SendEventBroadcastBody,
): Promise<SendEventMessageResult> {
  return apiPost<SendEventMessageResult>(`/api/partner/events/${eventId}/messages`, body);
}

// ─── 공통 ─────────────────────────────────────────────────────────────

/**
 * 아직 라운드가 없어서 404 인가.
 *
 * `GET /api/partner/selections/by-event/:eventId` 는 예약금 마감 전에는 404 다. 그건 오류가
 * 아니라 **정상적인 "아직"** 이라, 화면은 이걸 오류 배너가 아니라 안내 문구로 그려야 한다.
 */
export function isRoundNotReady(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 404
  );
}
