/**
 * 백엔드 응답 타입. `docs/API-ROUTES.md` 와 각 컨트롤러의 DTO 에서 옮겨 왔다.
 *
 * ★ D-07 — 이 파일에 **없는 것**이 규칙이다.
 * 유저용 타입 어디에도 `rank`, `cutoff`, 남의 `amount` 가 없다. 타입에 없으면
 * 화면이 그릴 수 없고, 그리려는 순간 컴파일이 막는다. 서버가 안 보내는 값을
 * 타입으로 만들어 두면 "언젠가 오겠지" 하는 UI 가 생긴다 — 그게 유출의 시작이다.
 *
 * 날짜는 전부 **ISO 문자열**이다. JSON 이므로 Date 가 아니다. 화면에 쓸 때는
 * `lib/format.ts` 의 헬퍼로 KST 로 바꾼다.
 */

// ─── 열거형 (Prisma enum 과 1:1) ───────────────────────────────────────

export type UserRole = 'USER' | 'PARTNER' | 'ADMIN';

export type AccountStatus =
  | 'PENDING_PROFILE'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DORMANT'
  | 'WITHDRAWAL_PENDING'
  | 'WITHDRAWN';

export type PartnerApprovalStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMIT_REQUIRED'
  | 'SUSPENDED'
  | 'REVOKED';

export type EventModeValue = 'INSTANT' | 'BID';

export type EventStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'OPEN'
  | 'CLOSED'
  | 'FINALIZED'
  | 'CANCELED'
  | 'SUSPENDED';

export type ApplicationStatus =
  | 'PENDING_DEPOSIT'
  | 'VALID'
  | 'CONFIRMED'
  | 'NOT_SELECTED'
  | 'EXPIRED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EVENT_CANCELED';

export type DepositStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'PAID'
  | 'SHORTFALL_PENDING'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'CANCELED'
  | 'VOIDED'
  | 'REFUND_REQUESTED'
  | 'REFUNDED'
  | 'FORFEITED';

export type DepositTypeValue = 'FIXED' | 'PERCENT';

export type DepositReason = 'INITIAL' | 'RAISE_SHORTFALL' | 'REAPPLY';

export type BidSource =
  | 'INITIAL_APPLY'
  | 'RAISE'
  | 'ROLLBACK'
  | 'REAPPLY'
  | 'CANCEL'
  | 'ADMIN_ADJUST';

export type VenueStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'HIDDEN'
  | 'SUSPENDED'
  | 'ARCHIVED';

export type BusinessVerificationStatus =
  | 'UNSUBMITTED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'REVOKED';

export type SelectionRoundStatus =
  | 'PENDING'
  | 'RANKING_READY'
  | 'DRAFT'
  | 'FINALIZED'
  | 'REOPENED'
  | 'CANCELED';

export type SelectionStatus =
  | 'CANDIDATE'
  | 'PRESELECTED'
  | 'SELECTED'
  | 'WAITING'
  | 'NOT_SELECTED'
  | 'REVOKED';

export type NotificationCategory =
  | 'APPLICATION'
  | 'DEPOSIT'
  | 'RESULT'
  | 'EVENT_CHANGE'
  | 'MESSAGE'
  | 'ACCOUNT'
  | 'PARTNER_OPS'
  | 'ANNOUNCEMENT'
  | 'MARKETING';

export type NotificationPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export type NotificationChannel = 'IN_APP' | 'EMAIL';

export type DigestMode = 'IMMEDIATE' | 'DAILY_DIGEST';

export type MessageKind = 'ADMIN_DIRECT' | 'ADMIN_BROADCAST' | 'PARTNER_EVENT';

export type RegionLevel = 'SIDO' | 'SIGUNGU' | 'EUPMYEONDONG';

export type BroadcastSegment =
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

export type BroadcastStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'PENDING_APPROVAL'
  | 'EXPANDING'
  | 'SENDING'
  | 'SENT'
  | 'CANCELED'
  | 'FAILED';

// ─── 공통 ─────────────────────────────────────────────────────────────

/** 커서 페이지. offset 이 아니라 커서인 이유는 목록이 계속 늘어나기 때문이다. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 백엔드 에러 봉투. DomainExceptionFilter 가 만든다. */
export interface ApiErrorBody {
  statusCode: number;
  error?: string;
  message?: string | string[];
  issues?: ApiValidationIssue[];
  path?: string;
  timestamp?: string;
}

export interface ApiValidationIssue {
  /** 문구가 바뀌어도 유지되는 분기용 코드 */
  code: string;
  /** 그대로 화면에 띄울 수 있는 한국어 문구 */
  message: string;
  /** 폼 필드명 */
  field?: string;
}

/**
 * 기간 중 공개되는 **유일한** 경쟁 정보. (D-07)
 *
 * `ratio === null` 이면 "비공개"다. 신청자 0명과 구분되지 않게 서버가
 * applicantCount 를 0 으로 눌러 보내므로, 화면은 반드시 ratio 로 판정한다.
 */
export interface CompetitionRatio {
  capacity: number;
  applicantCount: number;
  ratio: number | null;
  /** 예: "4.7:1" — 비공개면 "-" */
  display: string;
}

// ─── 인증 ─────────────────────────────────────────────────────────────

/** GET /api/auth/me */
export interface Me {
  id: string;
  email: string | null;
  displayName: string;
  roles: UserRole[];
  status: AccountStatus;
  /** 역할만 있고 승인 전이면 false. 활동 가능 여부는 이 값이 정한다. (D-09) */
  partnerApproved: boolean;
  partnerApprovalStatus: PartnerApprovalStatus | null;
  partnerProfileId: string | null;
}

/** POST /api/auth/partner-application 요청 */
export interface SubmitPartnerApplicationBody {
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  partnerTermsVersion: string;
}

/** POST /api/auth/partner-application 응답 */
export interface PartnerApplicationResult {
  id: string;
  approvalStatus: PartnerApprovalStatus;
  submittedAt: string | null;
  slaDueAt: string | null;
}

// ─── 이벤트 (공개) ────────────────────────────────────────────────────

/**
 * GET /api/events, GET /api/events/:key 의 응답.
 *
 * minAmount/maxAmount 는 **내가 써낼 수 있는 범위**(이벤트 규칙)다.
 * 남이 얼마를 썼는지는 어떤 공개 경로에도 실리지 않는다.
 */
export interface PublicEventSummary {
  id: string;
  title: string;
  mode: EventModeValue;
  status: EventStatus;
  minAmount: number;
  maxAmount: number;
  capacity: number;
  applyStartAt: string;
  applyEndAt: string;
  serviceDate: string | null;
  competition: CompetitionRatio;
}

/**
 * 검색·홈 피드의 카드. 목록용이라 이미지·지역·카테고리가 함께 온다.
 * `competition` 이 null 이면 파트너가 경쟁률 공개를 껐거나 표본 미달이다.
 */
export interface PublicEventCard {
  id: string;
  slug: string | null;
  title: string;
  mode: EventModeValue;
  status: EventStatus;
  minAmount: number;
  maxAmount: number;
  capacity: number;
  applyStartAt: string;
  applyEndAt: string;
  serviceDate: string | null;
  /** KST 벽시계 날짜(YYYY-MM-DD). 표시 전용. */
  serviceDateKst: string | null;
  competition: CompetitionRatio | null;
  /** INSTANT 정원이 찼는지. BID 는 정원 초과를 허용하므로 항상 false. (D-03) */
  soldOut: boolean;
  venueId: string;
  venueName: string;
  sido: string;
  sigungu: string;
  sigunguCode: string | null;
  categoryId: string | null;
  categoryNameKo: string | null;
  categoryIconKey: string | null;
  thumbnailUrl: string | null;
  thumbnailBlurDataUrl: string | null;
  tags: string[];
}

export type PublicEventPage = CursorPage<PublicEventCard>;

/** GET /api/events 질의 */
export interface PublicEventListQuery {
  mode?: EventModeValue;
  categoryId?: string;
  sigunguCode?: string;
  cursor?: string;
  limit?: number;
}

// ─── 탐색 · 검색 ──────────────────────────────────────────────────────

export type DiscoverySectionKey = 'DEADLINE_SOON' | 'NEWLY_OPENED' | 'POPULAR' | 'CATEGORY';

export interface DiscoverySection {
  key: DiscoverySectionKey;
  titleKo: string;
  /** CATEGORY 섹션일 때만 채워진다. "더보기" 링크를 만들 때 쓴다. */
  categoryId: string | null;
  events: PublicEventCard[];
}

export interface DiscoveryCategoryChip {
  id: string;
  code: string;
  nameKo: string;
  iconKey: string | null;
}

/** GET /api/discovery/home — 비어 있는 섹션은 응답에서 아예 빠진다. */
export interface DiscoveryHome {
  generatedAt: string;
  categories: DiscoveryCategoryChip[];
  sections: DiscoverySection[];
}

export type EventSort = 'newest' | 'ending-soon' | 'popular' | 'competition-ratio';

/** GET /api/search/events 질의 */
export interface SearchEventsQuery {
  keyword?: string;
  fuzzy?: boolean;
  sigunguCode?: string;
  categoryId?: string;
  mode?: EventModeValue;
  status?: EventStatus;
  /** 이 금액 이상을 써낼 수 있는 이벤트만 (이벤트 규칙 필터, 남의 금액과 무관) */
  amountFrom?: number;
  amountTo?: number;
  deadlineWithinHours?: number;
  sort?: EventSort;
  cursor?: string;
  limit?: number;
}

export interface PublicVenueCard {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  sido: string;
  sigungu: string;
  roadAddress: string;
  latitude: number | null;
  longitude: number | null;
  categoryId: string;
  categoryNameKo: string;
  categoryIconKey: string | null;
  coverImageUrl: string | null;
  seatCount: number | null;
  openEventCount: number;
  score: number;
}

export type PublicVenuePage = CursorPage<PublicVenueCard>;

/** GET /api/search/venues 질의 */
export interface SearchVenuesQuery {
  keyword?: string;
  fuzzy?: boolean;
  sigunguCode?: string;
  categoryId?: string;
  cursor?: string;
  limit?: number;
}

// ─── 카탈로그 ─────────────────────────────────────────────────────────

export interface Category {
  id: string;
  code: string;
  nameKo: string;
  nameEn: string | null;
  iconKey: string | null;
  sortOrder: number;
  parentId: string | null;
  children: Category[];
}

export interface Region {
  code: string;
  level: RegionLevel;
  displayName: string;
  sido: string;
  sigungu: string | null;
  /** 행정표준코드 5자리. code(법정동 10자리)와 값 공간이 다르다. */
  sigunguCode: string | null;
  parentCode: string | null;
}

// ─── 내 신청 (D-07 의 최전선) ─────────────────────────────────────────

/**
 * 내 신청 1건.
 *
 * `myAmount` 는 **내가 적어낸 금액**이라 보여준다. 순위는 없다 —
 * 내 순위는 남의 금액을 알아야 나오는 값이고, 그걸 알려주면 커트라인이 역산된다.
 * 서버도 안 보내고 이 타입에도 자리가 없다.
 */
export interface MyApplication {
  id: string;
  status: ApplicationStatus;
  /** 내가 적어낸 금액 */
  myAmount: number;
  appliedAt: string;
  canceledAt: string | null;
  confirmedAt: string | null;
  rebidCount: number;
  reapplyCount: number;
  /** INSTANT 에서 자리를 붙들고 있는가. BID 는 항상 false. */
  slotHeld: boolean;
  version: number;
  deposit: {
    status: DepositStatus;
    dueAt: string | null;
    requiredAmount: number;
    paidAmount: number;
    refundedAmount: number;
  };
  event: {
    id: string;
    title: string;
    slug: string | null;
    mode: EventModeValue;
    status: EventStatus;
    venue: { id: string; name: string } | null;
    minAmount: number;
    maxAmount: number;
    capacity: number;
    applyStartAt: string;
    applyEndAt: string;
    serviceStartAt: string | null;
    depositRequired: boolean;
    competition: CompetitionRatio;
  };
}

/** 내가 불렀던 금액의 이력. 남의 금액은 한 줄도 없다. (D-06) */
export interface MyBidHistoryEntry {
  seq: number;
  source: BidSource;
  previousAmount: number | null;
  newAmount: number;
  deltaAmount: number | null;
  bidAt: string;
  restoredLastBidAt: string | null;
  triggeredSoftClose: boolean;
}

/** 지금 열려 있는 예약금 홀드. 없으면 null. (D-05) */
export interface OpenDepositHold {
  id: string;
  reason: DepositReason;
  amountDue: number;
  dueAt: string;
  windowMinutes: number;
}

/** GET /api/applications/:applicationId */
export interface MyApplicationDetail extends MyApplication {
  myBidHistory: MyBidHistoryEntry[];
  openDepositHold: OpenDepositHold | null;
}

export type MyApplicationPage = CursorPage<MyApplication>;

/** GET /api/applications/me 질의 */
export interface MyApplicationListQuery {
  status?: ApplicationStatus;
  cursor?: string;
  limit?: number;
}

/** POST /api/applications 요청 — INSTANT 는 amount 를 서버가 정한다. */
export interface CreateApplicationBody {
  eventId: string;
  /** BID 전용. INSTANT 에서는 무시되고 이벤트 고정 금액이 쓰인다. */
  amount?: number;
  agreedTermsVersion?: string;
}

/** POST /api/applications/:id/raise — 올리기만 가능하다. (D-06) */
export interface RaiseBidBody {
  amount: number;
}

export interface CancelApplicationBody {
  memo?: string;
}

export interface ReapplyBody {
  amount: number;
}

export interface ConfirmDepositBody {
  paymentReference?: string;
}

// ─── 알림 · 쪽지 ──────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  titleKo: string;
  bodyKo: string;
  /** Next.js 내부 상대경로 */
  deepLinkPath: string | null;
  eventId: string | null;
  applicationId: string | null;
  readAt: string | null;
  createdAt: string;
}

export type NotificationPage = CursorPage<NotificationItem>;

export interface UnreadCount {
  notifications: number;
  messages: number;
  /** 배지에 찍을 합계 */
  total: number;
}

export interface MarkAllReadResult {
  updated: number;
}

export interface MessageItem {
  id: string;
  kind: MessageKind;
  eventId: string | null;
  senderDisplayName: string | null;
  titleKo: string;
  bodyKo: string;
  readAt: string | null;
  createdAt: string;
}

export type MessagePage = CursorPage<MessageItem>;

export interface CategoryPreference {
  category: NotificationCategory;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  /** 필수 범주(예약금·결과·계정)는 끌 수 없다. */
  mandatory: boolean;
}

export interface NotificationPreferences {
  categories: CategoryPreference[];
  emailGloballyEnabled: boolean;
  digestMode: DigestMode;
  marketingConsent: boolean;
  nightMarketingConsent: boolean;
  notificationEmail: string | null;
}

export interface UpdateNotificationPreferencesBody {
  categories?: Array<Pick<CategoryPreference, 'category' | 'inAppEnabled' | 'emailEnabled'>>;
  emailGloballyEnabled?: boolean;
  digestMode?: DigestMode;
  marketingConsent?: boolean;
  nightMarketingConsent?: boolean;
}

// ─── 파트너 ───────────────────────────────────────────────────────────

export interface PartnerBusinessCounts {
  total: number;
  verified: number;
  pending: number;
  actionRequired: number;
}

export interface PartnerVenueCounts {
  total: number;
  active: number;
  pendingReview: number;
  draft: number;
}

/** GET /api/partner/profile */
export interface PartnerProfile {
  id: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  approvalStatus: PartnerApprovalStatus;
  rejectionCode: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  slaDueAt: string | null;
  resubmitCount: number;
  /** 승인 상태가 활동 가능 여부를 정한다. 역할이 아니다. (D-09) */
  canOperate: boolean;
  businesses: PartnerBusinessCounts;
  venues: PartnerVenueCounts;
}

/**
 * 파트너가 보는 자기 이벤트. 금액·집계가 전부 보인다 —
 * D-07 이 감추는 상대는 유저이지 이벤트 주인이 아니다.
 */
export interface PartnerEvent {
  id: string;
  venueId: string;
  partnerId: string;
  categoryId: string | null;
  regionId: string | null;
  sigunguCode: string | null;
  title: string;
  slug: string | null;
  description: string | null;
  tags: string[];
  mode: EventModeValue;
  status: EventStatus;
  statusBeforeSuspend: EventStatus | null;
  capacity: number;
  claimedCount: number;
  soldOutAt: string | null;
  fixedAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  amountStep: number;
  currency: string;
  applyStartAt: string;
  applyEndAt: string;
  originalApplyEndAt: string | null;
  rankingLockAt: string | null;
  serviceStartAt: string | null;
  serviceEndAt: string | null;
  serviceDateKst: string | null;
  depositRequired: boolean;
  depositType: DepositTypeValue | null;
  depositFixedAmount: number | null;
  depositPercentBp: number | null;
  depositRoundingUnit: number;
  depositMinAmount: number | null;
  depositMaxAmount: number | null;
  depositWindowMinutes: number;
  depositRefundNote: string | null;
  softCloseEnabled: boolean;
  softCloseWindowMinutes: number | null;
  softCloseExtendMinutes: number | null;
  softCloseMaxExtensions: number;
  softCloseMaxExtensionsPerUser: number;
  softCloseHardEndAt: string | null;
  softCloseExtensionCount: number;
  showCompetitionRatio: boolean;
  ratioMinApplicantsToShow: number;
  liveApplicantCount: number;
  totalApplicationCount: number;
  expiredCount: number;
  canceledCount: number;
  competitionRatioX10: number | null;
  statsRefreshedAt: string | null;
  closeReason: string | null;
  cancelReason: string | null;
  cancelMemo: string | null;
  openedAt: string | null;
  closedAt: string | null;
  finalizedAt: string | null;
  canceledAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  policyVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type PartnerEventPage = CursorPage<PartnerEvent>;

export interface PartnerVenue {
  id: string;
  partnerProfileId: string;
  businessId: string | null;
  categoryId: string;
  regionCode: string | null;
  sigunguCode: string | null;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  status: VenueStatus;
  postalCode: string | null;
  roadAddress: string | null;
  detailAddress: string | null;
  sido: string | null;
  sigungu: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  seatCount: number | null;
  coverImageUrl: string | null;
  openEventCount: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PartnerVenuePage = CursorPage<PartnerVenue>;

export interface PartnerBusiness {
  id: string;
  partnerProfileId: string;
  legalName: string;
  representativeName: string | null;
  businessRegistrationNumber: string;
  businessType: string;
  verificationStatus: BusinessVerificationStatus;
  rejectionCode: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VenueImage {
  id: string;
  venueId: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isCover: boolean;
  status: 'PENDING' | 'READY' | 'QUARANTINED' | 'DELETING';
  createdAt: string;
}

export interface EventImage {
  id: string;
  eventId: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isCover: boolean;
  createdAt: string;
}

/** 업로드 티켓 (60초 유효) */
export interface UploadTicket {
  uploadUrl: string;
  blobPath: string;
  expiresAt: string;
  token?: string;
}

// ─── 선정 (파트너 · 운영자 전용) ──────────────────────────────────────

/**
 * 선정 라운드. **파트너/운영자 화면 전용**이다.
 * 유저 화면에서는 이 타입을 import 하지 않는다 — 커트라인이 들어 있다.
 */
export interface SelectionRound {
  id: string;
  eventId: string;
  roundNo: number;
  status: SelectionRoundStatus;
  capacity: number;
  candidateCount: number;
  selectedCount: number;
  /** 커트라인. 파트너·운영자만 본다. (D-07) */
  cutoffAmount: number | null;
  cutoffRank: number | null;
  rankingLockedAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
}

/** 순위순 신청자 1건. 금액이 들어 있으므로 파트너·운영자 화면에서만 쓴다. */
export interface SelectionEntry {
  id: string;
  applicationId: string;
  userId: string;
  displayName: string;
  rank: number;
  amount: number;
  lastBidAt: string;
  status: SelectionStatus;
  source: string;
  exclusionReason: string | null;
  depositStatus: DepositStatus;
  withinCapacity: boolean;
}

export type SelectionEntryPage = CursorPage<SelectionEntry>;

// ─── 운영자 ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/dashboard/stats
 *
 * 전부 "지금 사람이 개입해야 하는가" 를 답하는 숫자다. 누적 지표(총 가입자 등)를
 * 섞지 않는 게 이 화면의 규칙이라, 여기 없는 값은 서버도 보내지 않는다.
 */
export interface AdminDashboardStats {
  pendingPartners: number;
  /** 심사 SLA 를 이미 넘긴 건 */
  overduePartners: number;
  pendingBusinesses: number;
  pendingVenues: number;
  openEvents: number;
  /** 24시간 내 마감 예정 */
  closingSoonEvents: number;
  /** KST 자정 기준 오늘 들어온 신청 */
  applicationsToday: number;
  /** 30분 내 만료 예정 예약금 홀드 */
  expiringHolds: number;
  /** 만료 시각이 이미 지났는데 아직 스위퍼가 못 치운 홀드 */
  overdueHolds: number;
  suspendedUsers: number;
  sendingBroadcasts: number;
  quarantinedImages: number;
  generatedAt: string;
}

/**
 * GET /api/admin/dashboard/expiring-holds
 *
 * **금액이 없다.** 운영자는 권한상 볼 수 있지만(D-07), 이 화면의 목적은
 * "스위퍼가 제때 도는가" 이지 개별 금액이 아니다. 필요 없는 곳에 금액을
 * 실어두면 그 응답이 언젠가 다른 화면에 재사용된다.
 */
export interface AdminExpiringHold {
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

/** GET /api/admin/dashboard/overdue-partners */
export interface AdminOverduePartner {
  id: string;
  contactName: string;
  contactEmail: string;
  submittedAt: string | null;
  slaDueAt: string | null;
  resubmitCount: number;
}

/** 대시보드 하위 목록은 커서 없이 `{ items }` 만 온다. */
export interface AdminItemList<T> {
  items: T[];
}

export interface AdminPartnerQueueItem {
  id: string;
  userId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  approvalStatus: PartnerApprovalStatus;
  submittedAt: string | null;
  slaDueAt: string | null;
  resubmitCount: number;
}

export interface AdminUserSummary {
  id: string;
  /** 마스킹되어 나간다. */
  email: string | null;
  displayName: string;
  roles: UserRole[];
  status: AccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminAuditLog {
  id: string;
  seq: number;
  actorId: string | null;
  actorRole: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  createdAt: string;
}

export interface AdminSetting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export interface BroadcastSummary {
  id: string;
  segment: BroadcastSegment;
  status: BroadcastStatus;
  titleKo: string;
  eventId: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  moderationNote: string | null;
  createdAt: string;
}
