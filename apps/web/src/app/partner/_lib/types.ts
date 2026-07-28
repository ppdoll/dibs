/**
 * 파트너 콘솔이 쓰는 응답·요청 타입.
 *
 * `@/types/api` 에 있는 것은 그대로 재사용하고, **파트너 전용 엔드포인트의 응답**만
 * 여기 둔다. 그쪽 파일은 여러 화면 담당이 공유하는 계약이라 파트너 콘솔에서만 쓰는
 * DTO 를 밀어 넣으면 유저 화면 코드가 커트라인·금액 타입을 import 할 수 있게 된다.
 * ★ D-07 의 방어선은 "유저 화면이 이 파일을 import 하지 않는다" 이다.
 *
 * 값은 전부 `apps/api` 의 DTO 에서 옮겨 왔다 (create-event.dto.ts, venue.dto.ts,
 * business.dto.ts, selection.dto.ts, message.dto.ts). 추측한 필드는 없다.
 */

import type {
  BusinessVerificationStatus,
  CursorPage,
  EventModeValue,
  EventStatus,
  PartnerApprovalStatus,
  PartnerEvent,
  VenueStatus,
  ApplicationStatus,
  DepositTypeValue,
  SelectionStatus,
} from '@/types/api';

// ─── 사업자 ───────────────────────────────────────────────────────────

export type BusinessType =
  | 'INDIVIDUAL'
  | 'CORPORATION'
  | 'SIMPLIFIED'
  | 'TAX_EXEMPT'
  | 'NONPROFIT';

/** GET /api/partner/businesses (배열 — 파트너당 몇 건뿐이라 커서가 없다) */
export interface PartnerBusinessResponse {
  id: string;
  name: string;
  legalName: string;
  /** 하이픈 없는 10자리로 정규화되어 돌아온다 */
  businessRegistrationNumber: string;
  businessType: BusinessType;
  representativeName: string;
  verificationStatus: BusinessVerificationStatus;
  verificationSubmittedAt: string | null;
  verifiedAt: string | null;
  verificationRejectionReason: string | null;
  /** 사본이 올라와 있는지. 경로·URL 자체는 내려오지 않는다. */
  hasRegistrationDoc: boolean;
  contactEmail: string;
  contactPhone: string;
  postalCode: string | null;
  roadAddress: string | null;
  detailAddress: string | null;
  venueCount: number;
  createdAt: string;
}

export interface CreateBusinessBody {
  name: string;
  legalName: string;
  businessRegistrationNumber: string;
  businessType: BusinessType;
  representativeName: string;
  contactEmail: string;
  contactPhone: string;
  postalCode?: string;
  roadAddress?: string;
  detailAddress?: string;
}

/** 등록번호·업종·대표자명은 심사 중/승인 후에는 서버가 거절한다. */
export type UpdateBusinessBody = Partial<CreateBusinessBody>;

/** POST …/registration-doc/upload-ticket */
export interface BlobUploadTicket {
  clientToken: string;
  pathname: string;
  expiresAt: string;
  maxBytes: number;
  allowedContentTypes: string[];
}

/** POST /api/partner/venues/:venueId/images/upload-ticket — imageId 가 함께 온다 */
export interface VenueImageUploadTicket extends BlobUploadTicket {
  imageId: string;
}

/** POST /api/partner/events/:eventId/images/upload-ticket */
export interface EventImageUploadTicket extends BlobUploadTicket {
  imageId: string;
}

export const BUSINESS_DOC_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

// ─── 시설 ─────────────────────────────────────────────────────────────

export interface PartnerVenueImage {
  id: string;
  venueId: string;
  blobUrl: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  status: 'PENDING' | 'READY' | 'QUARANTINED' | 'DELETING';
  quarantineReason: string | null;
  createdAt: string;
}

/** 시설 상세에 동봉되어 오는 축약형 */
export interface PartnerVenueImageBrief {
  id: string;
  blobUrl: string;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  status: string;
  quarantineReason: string | null;
}

export interface PartnerVenueSummary {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  status: VenueStatus;
  summary: string | null;
  sido: string;
  sigungu: string;
  imageCount: number;
  openEventCount: number;
  coverImageUrl: string | null;
  /** PATCH 의 If-Match 값 */
  version: number;
  createdAt: string;
}

export interface DayHours {
  day: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  closed: boolean;
  open?: string;
  close?: string;
  lastOrder?: string;
}

export interface PartnerVenueDetail extends PartnerVenueSummary {
  description: string | null;
  primaryCategoryId: string;
  secondaryCategoryIds: string[];
  regionCode: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  websiteUrl: string | null;
  instagramHandle: string | null;
  seatCount: number | null;
  reservationNotice: string | null;
  businessHours: DayHours[] | null;
  specialHours: unknown;
  submittedForReviewAt: string | null;
  publishedAt: string | null;
  hiddenAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  images: PartnerVenueImageBrief[];
}

export type PartnerVenuePage = CursorPage<PartnerVenueSummary>;

export interface CreateVenueBody {
  businessId: string;
  name: string;
  summary?: string;
  description?: string;
  slugBase?: string;
  primaryCategoryId: string;
  secondaryCategoryIds?: string[];
  /** 법정동코드 10자리. SIGUNGU 레벨만 받는다. */
  regionCode: string;
  postalCode: string;
  roadAddress: string;
  detailAddress?: string;
  latitude?: number;
  longitude?: number;
  phone: string;
  websiteUrl?: string;
  instagramHandle?: string;
  seatCount?: number;
  reservationNotice?: string;
  businessHours?: DayHours[] | null;
}

/** businessId·slug 는 바꿀 수 없다 (소유권 이동 / 링크 파손). */
export type UpdateVenueBody = Partial<Omit<CreateVenueBody, 'businessId' | 'slugBase'>>;

// ─── 이벤트 ───────────────────────────────────────────────────────────

export interface PartnerEventImage {
  id: string;
  blobUrl: string;
  pathname: string;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  blurDataUrl: string | null;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  createdAt: string;
}

/** GET /api/partner/events/:eventId — 목록 응답 + 이미지 */
export interface PartnerEventDetail extends PartnerEvent {
  images: PartnerEventImage[];
}

export type PartnerEventListPage = CursorPage<PartnerEvent>;

export type VisibilityLevel = 'HIDDEN' | 'AFTER_DEADLINE' | 'AFTER_FINALIZED' | 'ALWAYS';

/**
 * POST /api/partner/events
 *
 * INSTANT 는 `fixedAmount` 만, BID 는 `minAmount`/`maxAmount` 만 보낸다.
 * 두 벌이 함께 오면 서버가 거절한다 — 폼에서 미리 한쪽만 실어 보낸다.
 */
export interface CreateEventBody {
  venueId: string;
  categoryId?: string;
  title: string;
  slug?: string;
  description: string;
  tags?: string[];
  mode: EventModeValue;
  capacity: number;

  fixedAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  amountStep?: number;

  /** UTC ISO8601 */
  applyStartAt: string;
  applyEndAt: string;
  serviceStartAt?: string;
  serviceEndAt?: string;

  depositRequired?: boolean;
  depositType?: DepositTypeValue;
  depositFixedAmount?: number;
  /** 베이시스포인트. 1000 = 10% */
  depositPercentBp?: number;
  depositRoundingUnit?: number;
  depositMinAmount?: number;
  depositMaxAmount?: number;
  depositWindowMinutes?: number;
  depositRefundNote?: string;

  softCloseEnabled?: boolean;
  softCloseWindowMinutes?: number;
  softCloseExtendMinutes?: number;
  softCloseMaxExtensions?: number;
  softCloseMaxExtensionsPerUser?: number;
  softCloseHardEndAt?: string;

  showCompetitionRatio?: boolean;
  ratioMinApplicantsToShow?: number;
}

/** venueId·mode 는 수정할 수 없다. 모드는 다시 만들어야 하는 값이다. */
export type UpdateEventBody = Partial<Omit<CreateEventBody, 'venueId' | 'mode'>>;

export type EventCancelReason =
  | 'PARTNER_REQUEST'
  | 'VENUE_UNAVAILABLE'
  | 'INSUFFICIENT_APPLICANTS'
  | 'PRICING_ERROR'
  | 'POLICY_VIOLATION'
  | 'ADMIN_FORCED'
  | 'OTHER';

export interface CancelEventBody {
  reason: EventCancelReason;
  memo?: string;
}

export interface CloseEventBody {
  memo?: string;
}

// ─── 선정 (금액·순위·커트라인 — 파트너 전용) ─────────────────────────

/**
 * GET /api/partner/selections/by-event/:eventId
 *
 * ★ `cutoff` 가 붙는 유일한 응답이다. 이 타입이 유저 화면으로 새어 나가면 D-07 이 깨진다.
 */
export interface PartnerSelectionRound {
  id: string;
  eventId: string;
  roundNo: number;
  status: 'PENDING' | 'RANKING_READY' | 'DRAFT' | 'FINALIZED' | 'REOPENED' | 'CANCELED';
  capacitySnapshot: number;
  remainingSeats: number;
  eligibleCount: number;
  excludedCount: number;
  preselectedCount: number;
  selectedCount: number;
  rankingComputedAt: string | null;
  rankingSnapshotHash: string | null;
  finalizedAt: string | null;
  /** 조작 엔드포인트의 If-Match 값 */
  version: number;
  cutoff: { amount: number | null; lastBidAt: string | null; hasTie: boolean } | null;
}

export type SelectionEntrySource =
  | 'RANKING'
  | 'MANUAL_ADD'
  | 'PROMOTION'
  | 'ADMIN_ADJUST'
  | string;

export interface PartnerSelectionEntry {
  id: string;
  applicationId: string;
  userId: string;
  displayName: string;
  /** 제외된 후보는 null 이고 목록 맨 뒤에 온다. */
  rankNo: number | null;
  /** 신청 금액. 실제 납부한 예약금이 아니라 순위 기준 금액이다. */
  amount: number;
  /** 그 금액에 도달한 시각 (D-04 의 2순위 키) */
  lastBidAt: string;
  appliedAt: string;
  rebidCount: number;
  depositStatus: string;
  depositPaid: number;
  withinCapacity: boolean;
  isEligible: boolean;
  exclusionReason: string | null;
  status: SelectionStatus;
  source: SelectionEntrySource;
  isOverride: boolean;
  tieGroupKey: string | null;
  tieOrdinal: number | null;
  version: number;
}

export type PartnerSelectionEntryPage = CursorPage<PartnerSelectionEntry>;

export interface SelectionEntryQuery {
  status?: SelectionStatus;
  eligibleOnly?: boolean;
  cursor?: string;
  limit?: number;
}

// ─── 쪽지 발송 ────────────────────────────────────────────────────────

export type NotificationChannel = 'IN_APP' | 'EMAIL';

export interface SendEventMessageBody {
  titleKo: string;
  bodyKo: string;
  /** 비우면 전체 신청자 */
  applicationStatuses?: ApplicationStatus[];
  channels?: NotificationChannel[];
}

export interface SendEventMessageResult {
  id: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  moderationNote: string | null;
  titleKo: string;
  createdAt: string;
}

// ─── 파트너 프로필 ────────────────────────────────────────────────────

/** GET /api/partner/profile — `@/types/api` 의 PartnerProfile 보다 필드가 넓다. */
export interface PartnerProfileDetail {
  id: string;
  approvalStatus: PartnerApprovalStatus;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  submittedAt: string | null;
  slaDueAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionCode: string | null;
  rejectionReason: string | null;
  resubmitCount: number;
  suspendedAt: string | null;
  suspensionReason: string | null;
  revokedAt: string | null;
  partnerTermsVersion: string | null;
  partnerTermsAgreedAt: string | null;
  canOperate: boolean;
  businesses: {
    total: number;
    verified: number;
    pending: number;
    actionRequired: number;
  };
  venues: {
    total: number;
    draft: number;
    pendingReview: number;
    active: number;
    hidden: number;
    suspended: number;
    archived: number;
  };
  createdAt: string;
}

// ─── 카탈로그 ─────────────────────────────────────────────────────────

export interface CatalogCategory {
  id: string;
  code: string;
  nameKo: string;
  nameEn: string | null;
  iconKey: string | null;
  sortOrder: number;
  parentId: string | null;
  children: CatalogCategory[];
}

export interface CatalogRegion {
  code: string;
  level: 'SIDO' | 'SIGUNGU' | 'EUPMYEONDONG';
  displayName: string;
  sido: string;
  sigungu: string | null;
  sigunguCode: string | null;
  parentCode: string | null;
}

export type { EventStatus, EventModeValue, VenueStatus, ApplicationStatus };
