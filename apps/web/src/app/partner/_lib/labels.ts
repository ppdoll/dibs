/**
 * 파트너 콘솔 전용 한국어 라벨.
 *
 * 유저 화면과 공유하는 라벨은 `@/lib/format` 에 이미 있다(EVENT_STATUS_LABEL 등).
 * 여기에는 **파트너만 보는 개념**만 둔다 — 선정 라운드 상태, 커트라인, 사업자 업종처럼
 * 유저 화면에 등장해서는 안 되는 말들이다. 두 사전을 섞으면 그 말이 유저 화면으로
 * 흘러갈 통로가 생긴다.
 *
 * 파트너는 "입찰·순위" 같은 정확한 말을 봐도 된다(용어집 규칙). 다만 여기서 만든 문구가
 * 그대로 신청자에게 발송되는 자리(쪽지 화면)에서는 쓰지 않는다.
 */

import type {
  BusinessType,
  EventCancelReason,
  PartnerSelectionRound,
} from './types';
import type { BusinessVerificationStatus, SelectionStatus } from '@/types/api';

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  INDIVIDUAL: '개인사업자',
  CORPORATION: '법인사업자',
  SIMPLIFIED: '간이과세자',
  TAX_EXEMPT: '면세사업자',
  NONPROFIT: '비영리단체',
};

export const BUSINESS_VERIFICATION_LABEL: Record<BusinessVerificationStatus, string> = {
  UNSUBMITTED: '미제출',
  PENDING: '심사 중',
  VERIFIED: '확인 완료',
  REJECTED: '반려',
  REVOKED: '승인 취소',
};

/** 배지 색. 색만으로 뜻을 전하지 않으므로 항상 글자와 함께 쓴다. */
export const BUSINESS_VERIFICATION_VARIANT: Record<
  BusinessVerificationStatus,
  'muted' | 'warning' | 'success' | 'destructive'
> = {
  UNSUBMITTED: 'muted',
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'destructive',
  REVOKED: 'destructive',
};

export const VENUE_STATUS_VARIANT: Record<
  string,
  'muted' | 'warning' | 'success' | 'destructive' | 'secondary'
> = {
  DRAFT: 'muted',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  HIDDEN: 'secondary',
  SUSPENDED: 'destructive',
  ARCHIVED: 'muted',
};

export const EVENT_STATUS_VARIANT: Record<
  string,
  'muted' | 'warning' | 'success' | 'destructive' | 'secondary' | 'default'
> = {
  DRAFT: 'muted',
  SCHEDULED: 'secondary',
  OPEN: 'success',
  CLOSED: 'warning',
  FINALIZED: 'default',
  CANCELED: 'destructive',
  SUSPENDED: 'destructive',
};

export const SELECTION_ROUND_STATUS_LABEL: Record<PartnerSelectionRound['status'], string> = {
  PENDING: '순위 집계 준비 중',
  RANKING_READY: '순위 확정됨',
  DRAFT: '명단 작성 중',
  FINALIZED: '발표 완료',
  REOPENED: '보충 라운드',
  CANCELED: '취소됨',
};

export const SELECTION_STATUS_LABEL: Record<SelectionStatus, string> = {
  CANDIDATE: '후보',
  PRESELECTED: '명단에 포함',
  SELECTED: '당첨 확정',
  WAITING: '예비',
  NOT_SELECTED: '미당첨',
  REVOKED: '취소됨',
};

export const SELECTION_STATUS_VARIANT: Record<
  SelectionStatus,
  'muted' | 'warning' | 'success' | 'destructive' | 'secondary' | 'default'
> = {
  CANDIDATE: 'muted',
  PRESELECTED: 'default',
  SELECTED: 'success',
  WAITING: 'secondary',
  NOT_SELECTED: 'muted',
  REVOKED: 'destructive',
};

export const EVENT_CANCEL_REASON_LABEL: Record<EventCancelReason, string> = {
  PARTNER_REQUEST: '사정상 진행이 어려워짐',
  VENUE_UNAVAILABLE: '시설 사용 불가',
  INSUFFICIENT_APPLICANTS: '신청 인원 부족',
  PRICING_ERROR: '금액을 잘못 등록함',
  POLICY_VIOLATION: '정책 위반',
  ADMIN_FORCED: '운영자 조치',
  OTHER: '기타',
};

/** 파트너가 직접 고를 수 있는 취소 사유. 운영자 전용 값은 뺀다. */
export const PARTNER_CANCEL_REASONS: EventCancelReason[] = [
  'PARTNER_REQUEST',
  'VENUE_UNAVAILABLE',
  'INSUFFICIENT_APPLICANTS',
  'PRICING_ERROR',
  'OTHER',
];

export const WEEKDAY_LABEL: Record<string, string> = {
  MON: '월',
  TUE: '화',
  WED: '수',
  THU: '목',
  FRI: '금',
  SAT: '토',
  SUN: '일',
};
