/**
 * 운영자 콘솔이 실제로 받는 응답 모양.
 *
 * `@/types/api` 의 Admin* 타입은 요약본이라 콘솔 화면이 쓰는 필드가 빠져 있다.
 * (예: 파트너 큐의 `rejectionCode`, 이벤트 운영 목록의 `version` — 낙관적 락에 필수다.)
 * 그 파일은 공용이라 이 화면 사정으로 늘리지 않고, **여기에 콘솔 전용으로 둔다.**
 * 값의 출처는 apps/api 의 각 서비스 SELECT 상수다 — 추측으로 넣은 필드는 없다.
 *
 * ★ D-07 — 여기에도 유저용 rank/cutoff 는 없다. 운영자는 권한상 금액을 볼 수 있지만,
 *   그 값이 필요한 화면은 선정 라운드뿐이고 이 콘솔의 어떤 응답도 금액을 싣지 않는다.
 *   실제로 대시보드의 만료 임박 홀드조차 서버가 금액을 빼고 보낸다.
 */

import type {
  AccountStatus,
  ApplicationStatus,
  BusinessVerificationStatus,
  CursorPage,
  DepositReason,
  EventModeValue,
  EventStatus,
  NotificationCategory,
  NotificationChannel,
  PartnerApprovalStatus,
  UserRole,
  VenueStatus,
} from '@/types/api';

// ─── Prisma enum 중 공용 타입 파일에 아직 없는 것 ─────────────────────

export type PartnerRejectionCode =
  | 'INVALID_BRN'
  | 'BRN_ALREADY_CLAIMED'
  | 'DOCUMENT_UNREADABLE'
  | 'INFO_MISMATCH'
  | 'PROHIBITED_CATEGORY'
  | 'INCOMPLETE_CONTACT'
  | 'OTHER';

export type BusinessTypeValue =
  | 'INDIVIDUAL'
  | 'CORPORATION'
  | 'SIMPLIFIED'
  | 'TAX_EXEMPT'
  | 'NONPROFIT';

export type VenueImageStatus = 'PENDING' | 'READY' | 'QUARANTINED' | 'DELETING';

export type EventCloseReason =
  | 'PERIOD_ENDED'
  | 'PARTNER_EARLY_CLOSE'
  | 'ADMIN_FORCED'
  | 'VENUE_SUSPENDED';

export type EventCancelReason =
  | 'PARTNER_REQUEST'
  | 'VENUE_UNAVAILABLE'
  | 'INSUFFICIENT_APPLICANTS'
  | 'PRICING_ERROR'
  | 'POLICY_VIOLATION'
  | 'ADMIN_FORCED'
  | 'OTHER';

/**
 * 공용 타입 파일의 BroadcastStatus 와 값이 다르다 — 실제 Prisma enum 에는
 * `PARTIALLY_FAILED` / `BLOCKED` 이 있고 `FAILED` / `EXPANDING` 표기가 다르다.
 * 콘솔은 서버가 실제로 보내는 값을 그리므로 이쪽을 쓴다.
 */
export type AdminBroadcastStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'SCHEDULED'
  | 'EXPANDING'
  | 'SENDING'
  | 'SENT'
  | 'PARTIALLY_FAILED'
  | 'CANCELED'
  | 'BLOCKED';

export type AdminBroadcastSegment =
  | 'ALL_USERS'
  | 'ALL_PARTNERS'
  | 'APPROVED_PARTNERS'
  | 'PENDING_PARTNER_APPLICANTS'
  | 'EVENT_APPLICANTS'
  | 'EVENT_APPLICANTS_BY_STATUS'
  | 'EVENT_SELECTED'
  | 'EVENT_NOT_SELECTED'
  | 'REGION'
  | 'CATEGORY_INTEREST'
  | 'INACTIVE_USERS'
  | 'EXPLICIT_USER_LIST';

export type AuditActorRole = 'USER' | 'PARTNER' | 'ADMIN' | 'SYSTEM';

export type AuditTargetType =
  | 'USER'
  | 'PARTNER_PROFILE'
  | 'BUSINESS'
  | 'VENUE'
  | 'VENUE_IMAGE'
  | 'EVENT'
  | 'APPLICATION'
  | 'BID_HISTORY'
  | 'DEPOSIT'
  | 'SELECTION'
  | 'SELECTION_ENTRY'
  | 'NOTIFICATION'
  | 'MESSAGE'
  | 'BROADCAST'
  | 'CATEGORY'
  | 'REGION'
  | 'SETTING'
  | 'PLATFORM_FEE'
  | 'SETTLEMENT'
  | 'SYSTEM';

// ─── 대시보드 ─────────────────────────────────────────────────────────

export interface AdminDashboardCounts {
  pendingPartners: number;
  overduePartners: number;
  pendingBusinesses: number;
  pendingVenues: number;
  openEvents: number;
  closingSoonEvents: number;
  applicationsToday: number;
  expiringHolds: number;
  overdueHolds: number;
  suspendedUsers: number;
  sendingBroadcasts: number;
  quarantinedImages: number;
  generatedAt: string;
}

export interface AdminExpiringHoldRow {
  id: string;
  applicationId: string;
  eventId: string;
  userId: string;
  reason: DepositReason;
  openedAt: string;
  dueAt: string;
  reminderSentAt: string | null;
  event: { title: string; status: EventStatus } | null;
}

export interface AdminOverduePartnerRow {
  id: string;
  contactName: string;
  contactEmail: string;
  submittedAt: string | null;
  slaDueAt: string | null;
  resubmitCount: number;
}

/** 대시보드 하위 목록은 커서 없이 `{ items }` 만 온다. */
export interface AdminList<T> {
  items: T[];
}

// ─── 파트너 심사 ──────────────────────────────────────────────────────

export interface AdminPartnerRow {
  id: string;
  userId: string;
  contactName: string;
  contactEmail: string;
  approvalStatus: PartnerApprovalStatus;
  submittedAt: string | null;
  slaDueAt: string | null;
  resubmitCount: number;
  rejectionCode: PartnerRejectionCode | null;
  createdAt: string;
}

export interface AdminPartnerDetail extends AdminPartnerRow {
  contactPhone: string | null;
  rejectionReason: string | null;
  rejectedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  revokedAt: string | null;
  partnerTermsVersion: string | null;
  partnerTermsAgreedAt: string | null;
  user: {
    id: string;
    email: string | null;
    displayName: string;
    status: AccountStatus;
    roles: UserRole[];
  };
  businesses: Array<{
    id: string;
    name: string;
    legalName: string;
    businessType: BusinessTypeValue;
    verificationStatus: BusinessVerificationStatus;
    verificationSubmittedAt: string | null;
  }>;
}

export type AdminPartnerPage = CursorPage<AdminPartnerRow>;

// ─── 사업자 확인 ──────────────────────────────────────────────────────

export interface AdminBusinessRow {
  id: string;
  partnerProfileId: string;
  name: string;
  legalName: string;
  businessType: BusinessTypeValue;
  verificationStatus: BusinessVerificationStatus;
  verificationSubmittedAt: string | null;
  createdAt: string;
}

export interface AdminBusinessDetail extends AdminBusinessRow {
  businessRegistrationNumber: string;
  representativeName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  postalCode: string | null;
  roadAddress: string | null;
  detailAddress: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  verificationRejectionReason: string | null;
  /** 등록증 원본 경로는 응답에서 지워지고 있고/없고만 온다. */
  hasRegistrationDoc: boolean;
  partner: {
    id: string;
    userId: string;
    contactName: string;
    approvalStatus: PartnerApprovalStatus;
  };
}

export type AdminBusinessPage = CursorPage<AdminBusinessRow>;

// ─── 계정 ─────────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: string;
  /** 목록에서는 마스킹된 값이 온다. */
  email: string | null;
  displayName: string;
  roles: UserRole[];
  status: AccountStatus;
  statusReason: string | null;
  suspendedUntil: string | null;
  phoneVerifiedAt: string | null;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserRow {
  phone: string | null;
  realName: string | null;
  notificationEmail: string | null;
  preferredRegionCode: string | null;
  withdrawalRequestedAt: string | null;
  anonymizedAt: string | null;
  partnerProfile: {
    id: string;
    approvalStatus: PartnerApprovalStatus;
    contactName: string;
  } | null;
  _count: { applications: number; notifications: number };
}

export type AdminUserPage = CursorPage<AdminUserRow>;

// ─── 시설 검수 ────────────────────────────────────────────────────────

export interface AdminVenueRow {
  id: string;
  name: string;
  slug: string;
  status: VenueStatus;
  sido: string | null;
  sigungu: string | null;
  imageCount: number;
  openEventCount: number;
  submittedForReviewAt: string | null;
  publishedAt: string | null;
  hiddenAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  version: number;
  createdAt: string;
}

export interface AdminVenueImage {
  id: string;
  blobUrl: string;
  status: VenueImageStatus;
  sortOrder: number;
  isCover: boolean;
  altText: string | null;
  quarantineReason: string | null;
}

export interface AdminVenueDetail extends AdminVenueRow {
  summary: string | null;
  description: string | null;
  roadAddress: string | null;
  detailAddress: string | null;
  postalCode: string | null;
  phone: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  seatCount: number | null;
  reservationNotice: string | null;
  businessHours: unknown;
  primaryCategoryId: string | null;
  regionCode: string | null;
  business: {
    id: string;
    name: string;
    verificationStatus: BusinessVerificationStatus;
    partner: { id: string; userId: string; contactName: string };
  } | null;
  images: AdminVenueImage[];
}

export type AdminVenuePage = CursorPage<AdminVenueRow>;

// ─── 이벤트 운영 ──────────────────────────────────────────────────────

export interface AdminEventRow {
  id: string;
  title: string;
  mode: EventModeValue;
  status: EventStatus;
  statusBeforeSuspend: EventStatus | null;
  capacity: number;
  claimedCount: number;
  liveApplicantCount: number;
  applyStartAt: string;
  applyEndAt: string;
  originalApplyEndAt: string | null;
  rankingLockAt: string | null;
  closedAt: string | null;
  closeReason: EventCloseReason | null;
  canceledAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  /** 낙관적 락 토큰. 강제 마감·연장·취소에 그대로 실어 보낸다. (IC-63) */
  version: number;
  policyVersion: number;
  partnerId: string;
  venueId: string;
  createdAt: string;
}

export interface AdminEventDetail extends AdminEventRow {
  description: string | null;
  depositRequired: boolean;
  depositWindowMinutes: number;
  softCloseEnabled: boolean;
  softCloseExtensionCount: number;
  softCloseHardEndAt: string | null;
  partner: { id: string; userId: string; contactName: string };
  venue: { id: string; name: string; status: VenueStatus } | null;
}

export type AdminEventPage = CursorPage<AdminEventRow>;

// ─── 공지 ─────────────────────────────────────────────────────────────

export interface AdminBroadcast {
  id: string;
  segment: AdminBroadcastSegment;
  segmentFilter: Record<string, unknown> | null;
  applicationStatuses: ApplicationStatus[];
  eventId: string | null;
  titleKo: string;
  bodyKo: string;
  channels: NotificationChannel[];
  category: NotificationCategory;
  status: AdminBroadcastStatus;
  scheduledAt: string | null;
  audienceSnapshotAt: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  requiresApproval: boolean;
  approvedByUserId: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

export type AdminBroadcastPage = CursorPage<AdminBroadcast>;

/** POST …/send 의 응답. 배치가 남으면 hasMore 가 true 로 온다. */
export interface AdminBroadcastSendResult {
  status: AdminBroadcastStatus;
  deliveredThisCall: number;
  hasMore: boolean;
  totalRecipients?: number;
  sentCount?: number;
}

export interface CreateBroadcastBody {
  segment: AdminBroadcastSegment;
  titleKo: string;
  bodyKo: string;
  channels?: NotificationChannel[];
  category?: NotificationCategory;
  eventId?: string;
  applicationStatuses?: ApplicationStatus[];
  regionCode?: string;
  categoryId?: string;
  inactiveDays?: number;
  userIds?: string[];
  scheduledAt?: string;
  /** 전역 유니크. 재시도가 공지를 두 번 만들지 않게 한다. */
  idempotencyKey: string;
}

// ─── 설정 ─────────────────────────────────────────────────────────────

export type SettingKind = 'boolean' | 'number' | 'string';

export interface AdminSettingRow {
  key: string;
  kind: SettingKind;
  isFeatureFlag: boolean;
  value: unknown;
  /** 저장된 행이 없어 기본값을 쓰는 중 */
  isDefault: boolean;
  description: string | null;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

// ─── 감사 로그 ────────────────────────────────────────────────────────

export interface AdminAuditRow {
  id: string;
  /** BigInt 라 항상 문자열로 온다. */
  seq: string;
  actorUserId: string | null;
  actorRole: AuditActorRole;
  actorLabel: string | null;
  action: string;
  targetType: AuditTargetType | null;
  targetId: string | null;
  targetOwnerUserId: string | null;
  summary: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  reasonCode: string | null;
  reasonMemo: string | null;
  correlationId: string | null;
  chainKey: string;
  prevHash: string | null;
  rowHash: string;
  createdAt: string;
}

/** 감사 로그의 커서는 id 가 아니라 seq 다. */
export interface AdminAuditPage {
  items: AdminAuditRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AdminAuditVerifyResult {
  chainKey: string;
  checked: number;
  intact: boolean;
  breaks: Array<{
    seq: string;
    expectedPrevHash: string | null;
    actualPrevHash: string | null;
  }>;
  firstSeq: string | null;
  lastSeq: string | null;
}
