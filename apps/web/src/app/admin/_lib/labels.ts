/**
 * 운영자 콘솔의 한국어 사전.
 *
 * 이용자 화면과 달리 여기서는 **정확한 말**을 쓴다 — "심사 대기"를 "기다리는 중"으로
 * 부드럽게 바꾸면 운영자가 상태 전이표를 머릿속에서 다시 매핑해야 한다.
 * 다만 이용자와 겹치는 용어(정원·경쟁률·예약금·신청)는 `@/lib/format` 의 사전을
 * 그대로 재수출해서 화면마다 말이 갈리지 않게 한다.
 *
 * 값은 전부 `Record<string, string>` 으로 선언한다. 서버가 사전에 없는 새 enum 값을
 * 보내도 `labelOf` 가 키를 그대로 보여주고 화면이 비지 않는다.
 */

import type { BadgeProps } from '@/components/ui';

export {
  APPLICATION_STATUS_LABEL,
  DEPOSIT_STATUS_LABEL,
  EVENT_MODE_LABEL,
  EVENT_STATUS_LABEL,
  PARTNER_APPROVAL_LABEL,
  VENUE_STATUS_LABEL,
  labelOf,
} from '@/lib/format';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

// ─── 계정 ─────────────────────────────────────────────────────────────

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  PENDING_PROFILE: '가입 진행 중',
  ACTIVE: '정상',
  SUSPENDED: '정지',
  DORMANT: '휴면',
  WITHDRAWAL_PENDING: '탈퇴 신청',
  WITHDRAWN: '탈퇴 완료',
};

export const ACCOUNT_STATUS_TONE: Record<string, BadgeVariant> = {
  PENDING_PROFILE: 'muted',
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  DORMANT: 'muted',
  WITHDRAWAL_PENDING: 'warning',
  WITHDRAWN: 'muted',
};

export const USER_ROLE_LABEL: Record<string, string> = {
  USER: '이용자',
  PARTNER: '파트너',
  ADMIN: '운영자',
};

// ─── 파트너 ───────────────────────────────────────────────────────────

export const PARTNER_APPROVAL_TONE: Record<string, BadgeVariant> = {
  DRAFT: 'muted',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  RESUBMIT_REQUIRED: 'warning',
  SUSPENDED: 'destructive',
  REVOKED: 'destructive',
};

/** 반려 코드. 화면은 문구가 아니라 이 값으로 분기한다. */
export const PARTNER_REJECTION_LABEL: Record<string, string> = {
  INVALID_BRN: '사업자등록번호가 유효하지 않음',
  BRN_ALREADY_CLAIMED: '이미 등록된 사업자등록번호',
  DOCUMENT_UNREADABLE: '제출 서류를 알아볼 수 없음',
  INFO_MISMATCH: '신청 정보와 서류가 불일치',
  PROHIBITED_CATEGORY: '취급 불가 업종',
  INCOMPLETE_CONTACT: '연락처 정보 미비',
  OTHER: '기타 (사유를 직접 적기)',
};

// ─── 사업자 ───────────────────────────────────────────────────────────

export const BUSINESS_STATUS_LABEL: Record<string, string> = {
  UNSUBMITTED: '미제출',
  PENDING: '확인 대기',
  VERIFIED: '확인 완료',
  REJECTED: '반려',
  REVOKED: '확인 취소',
};

export const BUSINESS_STATUS_TONE: Record<string, BadgeVariant> = {
  UNSUBMITTED: 'muted',
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'destructive',
  REVOKED: 'destructive',
};

export const BUSINESS_TYPE_LABEL: Record<string, string> = {
  INDIVIDUAL: '개인사업자',
  CORPORATION: '법인사업자',
  SIMPLIFIED: '간이과세자',
  TAX_EXEMPT: '면세사업자',
  NONPROFIT: '비영리단체',
};

// ─── 시설 ─────────────────────────────────────────────────────────────

export const VENUE_STATUS_TONE: Record<string, BadgeVariant> = {
  DRAFT: 'muted',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  HIDDEN: 'secondary',
  SUSPENDED: 'destructive',
  ARCHIVED: 'muted',
};

export const VENUE_IMAGE_STATUS_LABEL: Record<string, string> = {
  PENDING: '업로드 중',
  READY: '노출 중',
  QUARANTINED: '격리됨',
  DELETING: '삭제 대기',
};

// ─── 이벤트 ───────────────────────────────────────────────────────────

export const EVENT_STATUS_TONE: Record<string, BadgeVariant> = {
  DRAFT: 'muted',
  SCHEDULED: 'secondary',
  OPEN: 'success',
  CLOSED: 'default',
  FINALIZED: 'default',
  CANCELED: 'destructive',
  SUSPENDED: 'destructive',
};

export const EVENT_CLOSE_REASON_LABEL: Record<string, string> = {
  PERIOD_ENDED: '기간 종료',
  PARTNER_EARLY_CLOSE: '파트너 조기 마감',
  ADMIN_FORCED: '운영자 강제 마감',
  VENUE_SUSPENDED: '시설 정지로 마감',
};

export const EVENT_CANCEL_REASON_LABEL: Record<string, string> = {
  PARTNER_REQUEST: '파트너 요청',
  VENUE_UNAVAILABLE: '시설 이용 불가',
  INSUFFICIENT_APPLICANTS: '신청자 부족',
  PRICING_ERROR: '금액 설정 오류',
  POLICY_VIOLATION: '정책 위반',
  ADMIN_FORCED: '운영자 판단',
  OTHER: '기타',
};

// ─── 예약금 ───────────────────────────────────────────────────────────

export const DEPOSIT_REASON_LABEL: Record<string, string> = {
  INITIAL: '최초 신청',
  RAISE_SHORTFALL: '금액 올리기 차액',
  REAPPLY: '재신청',
};

// ─── 공지 ─────────────────────────────────────────────────────────────

export const BROADCAST_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성 중',
  PENDING_APPROVAL: '승인 대기',
  SCHEDULED: '발송 예약',
  EXPANDING: '대상 확장 중',
  SENDING: '발송 중',
  SENT: '발송 완료',
  PARTIALLY_FAILED: '일부 실패',
  CANCELED: '취소됨',
  BLOCKED: '발송 차단',
};

export const BROADCAST_STATUS_TONE: Record<string, BadgeVariant> = {
  DRAFT: 'muted',
  PENDING_APPROVAL: 'warning',
  SCHEDULED: 'secondary',
  EXPANDING: 'warning',
  SENDING: 'warning',
  SENT: 'success',
  PARTIALLY_FAILED: 'destructive',
  CANCELED: 'muted',
  BLOCKED: 'destructive',
};

export const BROADCAST_SEGMENT_LABEL: Record<string, string> = {
  ALL_USERS: '전체 이용자',
  ALL_PARTNERS: '전체 파트너',
  APPROVED_PARTNERS: '승인된 파트너',
  PENDING_PARTNER_APPLICANTS: '심사 대기 중인 파트너 신청자',
  EVENT_APPLICANTS: '특정 이벤트 신청자 전체',
  EVENT_APPLICANTS_BY_STATUS: '특정 이벤트 신청자 (상태별)',
  EVENT_SELECTED: '특정 이벤트 당첨자',
  EVENT_NOT_SELECTED: '특정 이벤트 미당첨자',
  REGION: '특정 지역 관심 이용자',
  CATEGORY_INTEREST: '특정 업종 관심 이용자',
  INACTIVE_USERS: '오래 접속하지 않은 이용자',
  EXPLICIT_USER_LIST: '지정한 계정 목록',
};

/** 세그먼트별로 무엇을 더 입력해야 하는지. 폼이 이 값으로 분기한다. */
export const BROADCAST_SEGMENT_HINT: Record<string, string> = {
  EVENT_APPLICANTS: '이벤트를 지정해야 합니다.',
  EVENT_APPLICANTS_BY_STATUS: '이벤트와 신청 상태를 지정해야 합니다.',
  EVENT_SELECTED: '이벤트를 지정해야 합니다.',
  EVENT_NOT_SELECTED: '이벤트를 지정해야 합니다.',
  REGION: '지역 코드를 지정해야 합니다.',
  CATEGORY_INTEREST: '업종 ID 를 지정해야 합니다.',
  INACTIVE_USERS: '마지막 로그인 기준 일수를 지정해야 합니다.',
  EXPLICIT_USER_LIST: '계정 ID 를 한 줄에 하나씩, 최대 500개까지 붙여넣으세요.',
};

export const NOTIFICATION_CATEGORY_LABEL: Record<string, string> = {
  APPLICATION: '신청',
  DEPOSIT: '예약금',
  RESULT: '결과 발표',
  EVENT_CHANGE: '이벤트 변경',
  MESSAGE: '쪽지',
  ACCOUNT: '계정',
  PARTNER_OPS: '파트너 운영',
  ANNOUNCEMENT: '공지',
  MARKETING: '마케팅',
};

export const NOTIFICATION_CHANNEL_LABEL: Record<string, string> = {
  IN_APP: '앱 내 알림',
  EMAIL: '이메일',
};

// ─── 감사 로그 ────────────────────────────────────────────────────────

export const AUDIT_ACTOR_ROLE_LABEL: Record<string, string> = {
  USER: '이용자',
  PARTNER: '파트너',
  ADMIN: '운영자',
  SYSTEM: '시스템',
};

export const AUDIT_TARGET_TYPE_LABEL: Record<string, string> = {
  USER: '계정',
  PARTNER_PROFILE: '파트너 신청서',
  BUSINESS: '사업자',
  VENUE: '시설',
  VENUE_IMAGE: '시설 이미지',
  EVENT: '이벤트',
  APPLICATION: '신청',
  BID_HISTORY: '금액 이력',
  DEPOSIT: '예약금',
  SELECTION: '선정 라운드',
  SELECTION_ENTRY: '선정 명단',
  NOTIFICATION: '알림',
  MESSAGE: '쪽지',
  BROADCAST: '공지',
  CATEGORY: '업종',
  REGION: '지역',
  SETTING: '설정',
  PLATFORM_FEE: '수수료 정책',
  SETTLEMENT: '정산',
  SYSTEM: '시스템',
};

/**
 * 감사 액션. 서버 enum 전부를 옮겨 왔다.
 *
 * 목록에 없는 액션이 오면 `labelOf` 가 원본 키를 그대로 보여준다 — 감사 화면에서는
 * 알 수 없는 값을 숨기는 것보다 날것으로 보여주는 편이 안전하다.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  ADMIN_INVITED: '운영자 초대',
  ADMIN_ACTIVATED: '운영자 활성화',
  ADMIN_DEACTIVATED: '운영자 비활성화',
  ADMIN_PERMISSION_CHANGED: '운영자 권한 변경',
  ADMIN_LOGIN: '운영자 로그인',

  PARTNER_APPLIED: '파트너 신청 제출',
  PARTNER_APPLICATION_CLAIMED: '파트너 신청 담당 지정',
  PARTNER_APPLICATION_APPROVED: '파트너 신청 승인',
  PARTNER_APPLICATION_REJECTED: '파트너 신청 반려',
  PARTNER_APPLICATION_MORE_INFO: '파트너 신청 보완 요청',
  PARTNER_APPROVED: '파트너 승인',
  PARTNER_REJECTED: '파트너 반려',
  PARTNER_SUSPENDED: '파트너 활동 정지',
  PARTNER_REVOKED: '파트너 자격 박탈',
  PARTNER_REINSTATED: '파트너 정지 해제',

  BUSINESS_SUBMITTED: '사업자 심사 제출',
  BUSINESS_VERIFIED: '사업자 확인 완료',
  BUSINESS_REJECTED: '사업자 확인 반려',
  BUSINESS_REVOKED: '사업자 확인 취소',

  VENUE_SUBMITTED: '시설 검수 요청',
  VENUE_PUBLISHED: '시설 공개',
  VENUE_HIDDEN: '시설 비공개',
  VENUE_SUSPENDED: '시설 정지',
  VENUE_ARCHIVED: '시설 보관',
  VENUE_IMAGE_QUARANTINED: '시설 이미지 격리',

  ACCOUNT_SUSPENDED: '계정 정지',
  ACCOUNT_SUSPENSION_LIFTED: '계정 정지 해제',
  ACCOUNT_ROLE_CHANGED: '계정 역할 변경',
  ACCOUNT_ANONYMIZED: '계정 익명화',

  PII_ACCESSED: '개인정보 열람',
  REGISTRATION_DOC_VIEWED: '사업자등록증 열람',
  CONTENT_HIDDEN: '콘텐츠 비공개',
  CONTENT_RESTORED: '콘텐츠 복구',

  EVENT_FORCE_CLOSED: '이벤트 강제 마감',
  EVENT_FORCE_CANCELED: '이벤트 강제 취소',
  EVENT_UNPUBLISHED: '이벤트 정지',
  EVENT_RESTORED: '이벤트 정지 해제',
  EVENT_DEADLINE_EXTENDED: '이벤트 마감 연장',
  EVENT_CAPACITY_EDITED: '이벤트 정원 수정',
  EVENT_FINAL_LIST_RESET: '최종 명단 초기화',

  PARTNER_FINAL_LIST_EDITED: '파트너 최종 명단 수정',
  PARTNER_SELECTION_OVERRIDE: '파트너 선정 수동 조정',
  PARTNER_APPLICANT_REMOVED: '파트너 신청자 제외',
  PARTNER_DEADLINE_EXTENDED: '파트너 마감 연장',
  PARTNER_EVENT_CANCELED: '파트너 이벤트 취소',
  PARTNER_USER_BLOCKED: '파트너 이용자 차단',
  PARTNER_USER_UNBLOCKED: '파트너 이용자 차단 해제',

  BROADCAST_CREATED: '공지 작성',
  BROADCAST_APPROVED: '공지 승인',
  BROADCAST_SENT: '공지 발송',
  BROADCAST_CANCELED: '공지 취소',
  BROADCAST_MODERATION_BLOCKED: '공지 발송 차단',

  EMAIL_SUPPRESSION_RELEASED: '이메일 차단 해제',
  EMAIL_DELIVERY_RESENT: '이메일 재발송',

  CATEGORY_CREATED: '업종 생성',
  CATEGORY_UPDATED: '업종 수정',
  CATEGORY_MERGED: '업종 병합',
  CATEGORY_DEACTIVATED: '업종 비활성화',
  REGION_UPDATED: '지역 수정',

  SETTING_CHANGED: '설정 변경',
  FEATURE_FLAG_TOGGLED: '피처 플래그 변경',

  FEE_POLICY_CREATED: '수수료 정책 생성',
  FEE_POLICY_ENDED: '수수료 정책 종료',
  SETTLEMENT_COMPUTED: '정산 계산',
  SETTLEMENT_STATUS_CHANGED: '정산 상태 변경',

  AUDIT_EXPORTED: '감사 로그 내보내기',
  SYSTEM_SWEEP_EXPIRED_HOLDS: '만료 예약금 스윕',
  SYSTEM_REBID_ROLLED_BACK: '금액 올리기 롤백',
  SYSTEM_RANKING_FINALIZED: '순위 확정',
  SYSTEM_AUDIT_CHAIN_VERIFIED: '감사 체인 검증',
};

/** 되돌릴 수 없거나 사람에게 통보가 나가는 액션 — 감사 목록에서 눈에 띄어야 한다. */
export const AUDIT_ACTION_TONE: Record<string, BadgeVariant> = {
  ACCOUNT_SUSPENDED: 'destructive',
  ACCOUNT_ANONYMIZED: 'destructive',
  PARTNER_REVOKED: 'destructive',
  PARTNER_SUSPENDED: 'destructive',
  VENUE_SUSPENDED: 'destructive',
  EVENT_FORCE_CANCELED: 'destructive',
  EVENT_FORCE_CLOSED: 'warning',
  EVENT_DEADLINE_EXTENDED: 'warning',
  FEATURE_FLAG_TOGGLED: 'warning',
  SETTING_CHANGED: 'warning',
  PII_ACCESSED: 'secondary',
  REGISTRATION_DOC_VIEWED: 'secondary',
  AUDIT_EXPORTED: 'secondary',
  BROADCAST_SENT: 'success',
  PARTNER_APPROVED: 'success',
  BUSINESS_VERIFIED: 'success',
  VENUE_PUBLISHED: 'success',
};

// ─── 선택지 배열 (select 용) ──────────────────────────────────────────

/**
 * `{ value, label }` 로 바꿔 준다. Select 의 options 에 그대로 넘긴다.
 *
 * 인자를 `Readonly<Record<string, string>>` 으로 받는 이유: `@/lib/format` 의 사전들이
 * `as const` 로 선언되어 있어 읽기 전용 속성이다. 가변 Record 로 받으면 그 사전들을
 * 여기 넘길 때 타입이 어긋난다.
 */
export function toOptions(
  dict: Readonly<Record<string, string>>,
  keys?: readonly string[],
): Array<{ value: string; label: string }> {
  const entries = keys ? keys.map((key) => [key, dict[key] ?? key] as const) : Object.entries(dict);
  return entries.map(([value, label]) => ({ value, label }));
}
