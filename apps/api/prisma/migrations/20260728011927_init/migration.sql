-- 확장 먼저. 아래 GIN trgm 인덱스와 감사 로그의 digest() 가 이걸 전제한다.
-- 이 두 줄이 없으면 확장이 없는 새 DB(=migrate dev 의 섀도 DB, 신규 운영 DB)에서
-- 마이그레이션이 통째로 실패한다.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'PARTNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_PROFILE', 'ACTIVE', 'SUSPENDED', 'DORMANT', 'WITHDRAWAL_PENDING', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PartnerApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'RESUBMIT_REQUIRED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VenueStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'HIDDEN', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('INDIVIDUAL', 'CORPORATION', 'SIMPLIFIED', 'TAX_EXEMPT', 'NONPROFIT');

-- CreateEnum
CREATE TYPE "BusinessVerificationStatus" AS ENUM ('UNSUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PartnerRejectionCode" AS ENUM ('INVALID_BRN', 'BRN_ALREADY_CLAIMED', 'DOCUMENT_UNREADABLE', 'INFO_MISMATCH', 'PROHIBITED_CATEGORY', 'INCOMPLETE_CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "VenueImageStatus" AS ENUM ('PENDING', 'READY', 'QUARANTINED', 'DELETING');

-- CreateEnum
CREATE TYPE "RegionLevel" AS ENUM ('SIDO', 'SIGUNGU', 'EUPMYEONDONG');

-- CreateEnum
CREATE TYPE "IdentitySignal" AS ENUM ('IP_HASH_CLUSTER', 'PHONE_MATCH', 'DEVICE_MATCH', 'PAYMENT_MATCH', 'ADMIN_MANUAL');

-- CreateEnum
CREATE TYPE "EventMode" AS ENUM ('INSTANT', 'BID');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'FINALIZED', 'CANCELED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING_DEPOSIT', 'VALID', 'CONFIRMED', 'NOT_SELECTED', 'EXPIRED', 'CANCELED', 'REJECTED', 'EVENT_CANCELED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'SHORTFALL_PENDING', 'EXPIRED', 'SUPERSEDED', 'CANCELED', 'VOIDED', 'REFUND_REQUESTED', 'REFUNDED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('CANDIDATE', 'PRESELECTED', 'SELECTED', 'WAITING', 'NOT_SELECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VisibilityLevel" AS ENUM ('HIDDEN', 'AFTER_DEADLINE', 'AFTER_FINALIZED', 'ALWAYS');

-- CreateEnum
CREATE TYPE "DepositType" AS ENUM ('FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "DepositReason" AS ENUM ('INITIAL', 'RAISE_SHORTFALL', 'REAPPLY');

-- CreateEnum
CREATE TYPE "DepositRefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'MANUAL_REQUIRED');

-- CreateEnum
CREATE TYPE "DepositRefundReason" AS ENUM ('NOT_SELECTED', 'EVENT_CANCELED', 'PARTNER_REJECTED', 'USER_CANCELED', 'ADMIN_REVERSAL', 'DUPLICATE_PAYMENT', 'ROLLBACK_OVERPAY');

-- CreateEnum
CREATE TYPE "BidSource" AS ENUM ('INITIAL_APPLY', 'RAISE', 'ROLLBACK', 'REAPPLY', 'CANCEL', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "ApplicationCancelReason" AS ENUM ('USER_REQUEST', 'DEPOSIT_TIMEOUT', 'PARTNER_REJECT', 'EVENT_CANCELED', 'ADMIN');

-- CreateEnum
CREATE TYPE "EventCloseReason" AS ENUM ('PERIOD_ENDED', 'PARTNER_EARLY_CLOSE', 'ADMIN_FORCED', 'VENUE_SUSPENDED');

-- CreateEnum
CREATE TYPE "EventCancelReason" AS ENUM ('PARTNER_REQUEST', 'VENUE_UNAVAILABLE', 'INSUFFICIENT_APPLICANTS', 'PRICING_ERROR', 'POLICY_VIOLATION', 'ADMIN_FORCED', 'OTHER');

-- CreateEnum
CREATE TYPE "SelectionRoundStatus" AS ENUM ('PENDING', 'RANKING_READY', 'DRAFT', 'FINALIZED', 'REOPENED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SelectionEntrySource" AS ENUM ('AUTO_RANK', 'PARTNER_ADD', 'PARTNER_REMOVE', 'PARTNER_PROMOTE', 'PARTNER_REORDER', 'ADMIN_OVERRIDE', 'SYSTEM_REVOKE', 'SYSTEM_EVENT_CANCELED', 'INSTANT_CLAIM');

-- CreateEnum
CREATE TYPE "SelectionExclusionReason" AS ENUM ('DEPOSIT_UNPAID', 'DEPOSIT_EXPIRED', 'USER_CANCELED', 'BLOCKED_USER', 'ADMIN_DISQUALIFIED', 'DUPLICATE_ACCOUNT', 'ALREADY_SELECTED_PRIOR_ROUND');

-- CreateEnum
CREATE TYPE "SelectionRevokeReason" AS ENUM ('USER_CANCELED', 'NO_SHOW', 'PARTNER_REMOVED', 'PAYMENT_FAILED', 'ADMIN_ACTION', 'EVENT_CANCELED');

-- CreateEnum
CREATE TYPE "CoreActorType" AS ENUM ('USER', 'PARTNER', 'ADMIN', 'SYSTEM_CRON', 'SYSTEM_LAZY');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPLICATION_RECEIVED', 'APPLICATION_CONFIRMED_INSTANT', 'APPLICATION_CANCELED_BY_USER', 'DEPOSIT_REQUIRED', 'DEPOSIT_REMINDER', 'DEPOSIT_CONFIRMED', 'DEPOSIT_HOLD_EXPIRED', 'DEPOSIT_REFUND_SCHEDULED', 'REBID_ACCEPTED', 'REBID_DEPOSIT_SHORTFALL', 'REBID_ROLLED_BACK', 'DEADLINE_EXTENDED', 'EVENT_CANCELED', 'EVENT_CLOSED_CAPACITY_REACHED', 'SELECTION_FINALIZED_SELECTED', 'SELECTION_FINALIZED_NOT_SELECTED', 'SELECTION_REVISED_BY_PARTNER', 'PARTNER_APPROVAL_APPROVED', 'PARTNER_APPROVAL_REJECTED', 'PARTNER_NEW_APPLICATION_DIGEST', 'PARTNER_EVENT_DEADLINE_REACHED', 'PARTNER_BROADCAST_BLOCKED', 'ACCOUNT_SUSPENDED', 'ADMIN_ANNOUNCEMENT', 'BUSINESS_VERIFICATION_APPROVED', 'BUSINESS_VERIFICATION_REJECTED', 'VENUE_REVIEW_APPROVED', 'VENUE_REVIEW_REJECTED', 'VENUE_IMAGE_QUARANTINED', 'PARTNER_SUSPENDED', 'PARTNER_REINSTATED', 'APPLICATION_REJECTED_BY_PARTNER', 'DEPOSIT_REFUND_COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SKIPPED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BroadcastSegment" AS ENUM ('ALL_USERS', 'ALL_PARTNERS', 'APPROVED_PARTNERS', 'PENDING_PARTNER_APPLICANTS', 'EVENT_APPLICANTS', 'EVENT_APPLICANTS_BY_STATUS', 'EVENT_SELECTED', 'EVENT_NOT_SELECTED', 'REGION', 'CATEGORY_INTEREST', 'INACTIVE_USERS', 'EXPLICIT_USER_LIST');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ADMIN_INVITED', 'ADMIN_ACTIVATED', 'ADMIN_DEACTIVATED', 'ADMIN_PERMISSION_CHANGED', 'ADMIN_LOGIN', 'PARTNER_APPLIED', 'PARTNER_APPLICATION_CLAIMED', 'PARTNER_APPLICATION_APPROVED', 'PARTNER_APPLICATION_REJECTED', 'PARTNER_APPLICATION_MORE_INFO', 'PARTNER_APPROVED', 'PARTNER_REJECTED', 'PARTNER_SUSPENDED', 'PARTNER_REVOKED', 'PARTNER_REINSTATED', 'BUSINESS_SUBMITTED', 'BUSINESS_VERIFIED', 'BUSINESS_REJECTED', 'BUSINESS_REVOKED', 'VENUE_SUBMITTED', 'VENUE_PUBLISHED', 'VENUE_HIDDEN', 'VENUE_SUSPENDED', 'VENUE_ARCHIVED', 'VENUE_IMAGE_QUARANTINED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_SUSPENSION_LIFTED', 'ACCOUNT_ROLE_CHANGED', 'ACCOUNT_ANONYMIZED', 'PII_ACCESSED', 'REGISTRATION_DOC_VIEWED', 'CONTENT_HIDDEN', 'CONTENT_RESTORED', 'EVENT_FORCE_CLOSED', 'EVENT_FORCE_CANCELED', 'EVENT_UNPUBLISHED', 'EVENT_RESTORED', 'EVENT_DEADLINE_EXTENDED', 'EVENT_CAPACITY_EDITED', 'EVENT_FINAL_LIST_RESET', 'PARTNER_FINAL_LIST_EDITED', 'PARTNER_SELECTION_OVERRIDE', 'PARTNER_APPLICANT_REMOVED', 'PARTNER_DEADLINE_EXTENDED', 'PARTNER_EVENT_CANCELED', 'BROADCAST_CREATED', 'BROADCAST_APPROVED', 'BROADCAST_SENT', 'BROADCAST_CANCELED', 'BROADCAST_MODERATION_BLOCKED', 'EMAIL_SUPPRESSION_RELEASED', 'EMAIL_DELIVERY_RESENT', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_MERGED', 'CATEGORY_DEACTIVATED', 'REGION_UPDATED', 'PARTNER_USER_BLOCKED', 'PARTNER_USER_UNBLOCKED', 'SETTING_CHANGED', 'FEATURE_FLAG_TOGGLED', 'FEE_POLICY_CREATED', 'FEE_POLICY_ENDED', 'SETTLEMENT_COMPUTED', 'SETTLEMENT_STATUS_CHANGED', 'AUDIT_EXPORTED', 'SYSTEM_SWEEP_EXPIRED_HOLDS', 'SYSTEM_REBID_ROLLED_BACK', 'SYSTEM_RANKING_FINALIZED', 'SYSTEM_AUDIT_CHAIN_VERIFIED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'COMPUTED', 'READY', 'ON_HOLD', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('APPLICATION', 'DEPOSIT', 'RESULT', 'EVENT_CHANGE', 'MESSAGE', 'ACCOUNT', 'PARTNER_OPS', 'ANNOUNCEMENT', 'MARKETING');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('ADMIN_DIRECT', 'ADMIN_BROADCAST', 'PARTNER_EVENT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('DELIVERED', 'SKIPPED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DeliverySkipReason" AS ENUM ('PREFERENCE_OPTED_OUT', 'GLOBAL_EMAIL_OFF', 'SUPPRESSED_UNSUBSCRIBED', 'SUPPRESSED_BOUNCED', 'SUPPRESSED_COMPLAINED', 'NO_EMAIL_ON_ACCOUNT', 'NO_MARKETING_CONSENT', 'NO_NIGHT_MARKETING_CONSENT', 'RECIPIENT_DEACTIVATED', 'FEATURE_FLAG_OFF', 'COALESCED', 'MODERATION_BLOCKED');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'EXPANDING', 'SENDING', 'SENT', 'PARTIALLY_FAILED', 'CANCELED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ModerationState" AS ENUM ('NOT_REQUIRED', 'AUTO_FLAGGED', 'PENDING_REVIEW', 'APPROVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('USER_UNSUBSCRIBED', 'HARD_BOUNCE', 'SOFT_BOUNCE_THRESHOLD', 'SPAM_COMPLAINT', 'ADMIN_MANUAL', 'INVALID_ADDRESS');

-- CreateEnum
CREATE TYPE "SuppressionScope" AS ENUM ('MARKETING_ONLY', 'ALL');

-- CreateEnum
CREATE TYPE "DigestMode" AS ENUM ('IMMEDIATE', 'DAILY_DIGEST');

-- CreateEnum
CREATE TYPE "AuditActorRole" AS ENUM ('USER', 'PARTNER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditTargetType" AS ENUM ('USER', 'PARTNER_PROFILE', 'BUSINESS', 'VENUE', 'VENUE_IMAGE', 'EVENT', 'APPLICATION', 'BID_HISTORY', 'DEPOSIT', 'SELECTION', 'SELECTION_ENTRY', 'NOTIFICATION', 'MESSAGE', 'BROADCAST', 'CATEGORY', 'REGION', 'SETTING', 'PLATFORM_FEE', 'SETTLEMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FeeScope" AS ENUM ('GLOBAL', 'CATEGORY', 'REGION', 'PARTNER');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('PERCENT', 'FIXED', 'HYBRID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSub" VARCHAR(64),
    "email" VARCHAR(255),
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "googleProfileRaw" JSONB,
    "displayName" VARCHAR(20) NOT NULL,
    "realName" VARCHAR(40),
    "phone" VARCHAR(20),
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "avatarUrl" VARCHAR(500),
    "roles" "UserRole"[] DEFAULT ARRAY['USER']::"UserRole"[],
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING_PROFILE',
    "statusReason" VARCHAR(500),
    "suspendedUntil" TIMESTAMPTZ(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMPTZ(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'ko-KR',
    "timeZone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Seoul',
    "notificationEmail" VARCHAR(255),
    "preferredRegionCode" VARCHAR(10),
    "serviceTermsVersion" VARCHAR(20),
    "serviceTermsAgreedAt" TIMESTAMPTZ(3),
    "privacyTermsVersion" VARCHAR(20),
    "privacyTermsAgreedAt" TIMESTAMPTZ(3),
    "age14ConfirmedAt" TIMESTAMPTZ(3),
    "marketingEmailAgreedAt" TIMESTAMPTZ(3),
    "marketingEmailWithdrawnAt" TIMESTAMPTZ(3),
    "marketingInAppAgreedAt" TIMESTAMPTZ(3),
    "marketingInAppWithdrawnAt" TIMESTAMPTZ(3),
    "withdrawalRequestedAt" TIMESTAMPTZ(3),
    "anonymizedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactName" VARCHAR(50) NOT NULL,
    "contactEmail" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(20),
    "approvalStatus" "PartnerApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "slaDueAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "approvedByUserId" TEXT,
    "rejectedAt" TIMESTAMPTZ(3),
    "rejectionCode" "PartnerRejectionCode",
    "rejectionReason" VARCHAR(500),
    "resubmitCount" INTEGER NOT NULL DEFAULT 0,
    "suspendedAt" TIMESTAMPTZ(3),
    "suspensionReason" VARCHAR(500),
    "revokedAt" TIMESTAMPTZ(3),
    "partnerTermsVersion" VARCHAR(20),
    "partnerTermsAgreedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PartnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "legalName" VARCHAR(60) NOT NULL,
    "businessRegistrationNumber" VARCHAR(10) NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "representativeName" VARCHAR(30) NOT NULL,
    "registrationDocPathname" VARCHAR(500),
    "verificationStatus" "BusinessVerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "verificationSubmittedAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedByUserId" TEXT,
    "verificationRejectionReason" VARCHAR(500),
    "contactEmail" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(20) NOT NULL,
    "postalCode" VARCHAR(5),
    "roadAddress" VARCHAR(255),
    "detailAddress" VARCHAR(255),
    "settlementBankCode" VARCHAR(10),
    "settlementAccountNumberEnc" BYTEA,
    "settlementAccountHolder" VARCHAR(30),
    "settlementAccountLast4" VARCHAR(4),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "summary" VARCHAR(60),
    "description" TEXT,
    "status" "VenueStatus" NOT NULL DEFAULT 'DRAFT',
    "primaryCategoryId" TEXT NOT NULL,
    "regionCode" VARCHAR(10) NOT NULL,
    "sido" VARCHAR(20) NOT NULL,
    "sigungu" VARCHAR(30) NOT NULL,
    "postalCode" VARCHAR(5) NOT NULL,
    "roadAddress" VARCHAR(255) NOT NULL,
    "detailAddress" VARCHAR(255),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "phone" VARCHAR(20) NOT NULL,
    "websiteUrl" VARCHAR(500),
    "instagramHandle" VARCHAR(40),
    "seatCount" INTEGER,
    "reservationNotice" TEXT,
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Seoul',
    "businessHours" JSONB,
    "specialHours" JSONB,
    "coverImageId" TEXT,
    "searchText" TEXT,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "openEventCount" INTEGER NOT NULL DEFAULT 0,
    "lastEventEndsAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "submittedForReviewAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "hiddenAt" TIMESTAMPTZ(3),
    "suspendedAt" TIMESTAMPTZ(3),
    "suspensionReason" VARCHAR(500),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueImage" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "blobUrl" VARCHAR(500) NOT NULL,
    "blobPathname" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(50) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altText" VARCHAR(120),
    "sortOrder" INTEGER NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "status" "VenueImageStatus" NOT NULL DEFAULT 'READY',
    "uploadedByUserId" TEXT NOT NULL,
    "quarantineReason" VARCHAR(500),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VenueImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "nameKo" VARCHAR(40) NOT NULL,
    "nameEn" VARCHAR(40),
    "iconKey" VARCHAR(40),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "venueCount" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "level" "RegionLevel" NOT NULL,
    "sigunguCode" VARCHAR(5),
    "sido" VARCHAR(20) NOT NULL,
    "sigungu" VARCHAR(30),
    "eupmyeondong" VARCHAR(30),
    "displayName" VARCHAR(60) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "venueCount" INTEGER NOT NULL DEFAULT 0,
    "parentCode" VARCHAR(10),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "regionId" TEXT,
    "sigunguCode" VARCHAR(5),
    "title" VARCHAR(80) NOT NULL,
    "slug" TEXT,
    "description" TEXT NOT NULL,
    "tags" TEXT[],
    "mode" "EventMode" NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "statusBeforeSuspend" "EventStatus",
    "capacity" INTEGER NOT NULL,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "soldOutAt" TIMESTAMPTZ(3),
    "claimedCountRefreshedAt" TIMESTAMPTZ(3),
    "fixedAmount" INTEGER,
    "minAmount" INTEGER,
    "maxAmount" INTEGER,
    "amountStep" INTEGER NOT NULL DEFAULT 1,
    "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "applyStartAt" TIMESTAMPTZ(3) NOT NULL,
    "applyEndAt" TIMESTAMPTZ(3) NOT NULL,
    "originalApplyEndAt" TIMESTAMPTZ(3),
    "rankingLockAt" TIMESTAMPTZ(3),
    "serviceStartAt" TIMESTAMPTZ(3),
    "serviceEndAt" TIMESTAMPTZ(3),
    "serviceDateKst" CHAR(10),
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Seoul',
    "depositRequired" BOOLEAN NOT NULL DEFAULT false,
    "depositType" "DepositType",
    "depositFixedAmount" INTEGER,
    "depositPercentBp" INTEGER,
    "depositRoundingUnit" INTEGER NOT NULL DEFAULT 100,
    "depositMinAmount" INTEGER,
    "depositMaxAmount" INTEGER,
    "depositWindowMinutes" INTEGER NOT NULL DEFAULT 10,
    "depositRefundNote" VARCHAR(500),
    "softCloseEnabled" BOOLEAN NOT NULL DEFAULT false,
    "softCloseWindowMinutes" INTEGER,
    "softCloseExtendMinutes" INTEGER,
    "softCloseMaxExtensions" INTEGER NOT NULL DEFAULT 6,
    "softCloseMaxExtensionsPerUser" INTEGER NOT NULL DEFAULT 2,
    "softCloseHardEndAt" TIMESTAMPTZ(3),
    "softCloseExtensionCount" INTEGER NOT NULL DEFAULT 0,
    "showCompetitionRatio" BOOLEAN NOT NULL DEFAULT true,
    "ratioMinApplicantsToShow" INTEGER NOT NULL DEFAULT 0,
    "cutoffVisibility" "VisibilityLevel" NOT NULL DEFAULT 'HIDDEN',
    "rankVisibility" "VisibilityLevel" NOT NULL DEFAULT 'HIDDEN',
    "amountDistributionVisibility" "VisibilityLevel" NOT NULL DEFAULT 'HIDDEN',
    "liveApplicantCount" INTEGER NOT NULL DEFAULT 0,
    "totalApplicationCount" INTEGER NOT NULL DEFAULT 0,
    "expiredCount" INTEGER NOT NULL DEFAULT 0,
    "canceledCount" INTEGER NOT NULL DEFAULT 0,
    "competitionRatioX10" INTEGER NOT NULL DEFAULT 0,
    "statsRefreshedAt" TIMESTAMPTZ(3),
    "closeReason" "EventCloseReason",
    "cancelReason" "EventCancelReason",
    "cancelMemo" VARCHAR(500),
    "openedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "finalizedAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "suspendedAt" TIMESTAMPTZ(3),
    "suspendedReason" VARCHAR(500),
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventImage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "blobUrl" VARCHAR(500) NOT NULL,
    "pathname" VARCHAR(500) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" VARCHAR(50) NOT NULL,
    "blurDataUrl" TEXT,
    "altText" VARCHAR(200),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EventImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applySeq" BIGSERIAL NOT NULL,
    "eventMode" "EventMode" NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING_DEPOSIT',
    "amount" INTEGER NOT NULL,
    "lastBidAt" TIMESTAMPTZ(6) NOT NULL,
    "firstAppliedAt" TIMESTAMPTZ(6) NOT NULL,
    "settledAmount" INTEGER NOT NULL,
    "settledLastBidAt" TIMESTAMPTZ(6) NOT NULL,
    "highestAmountEver" INTEGER NOT NULL,
    "depositStatus" "DepositStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "depositDueAt" TIMESTAMPTZ(3),
    "depositRequiredAmount" INTEGER NOT NULL DEFAULT 0,
    "depositPaidAmount" INTEGER NOT NULL DEFAULT 0,
    "depositRefundedAmount" INTEGER NOT NULL DEFAULT 0,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "rebidCount" INTEGER NOT NULL DEFAULT 0,
    "reapplyCount" INTEGER NOT NULL DEFAULT 0,
    "slotClaimed" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMPTZ(3),
    "lastCanceledAt" TIMESTAMPTZ(3),
    "lastReapplyAt" TIMESTAMPTZ(3),
    "cancelReason" "ApplicationCancelReason",
    "confirmedAt" TIMESTAMPTZ(3),
    "partnerNote" VARCHAR(500),
    "agreedTermsVersion" VARCHAR(20),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "source" "BidSource" NOT NULL,
    "previousAmount" INTEGER,
    "newAmount" INTEGER NOT NULL,
    "deltaAmount" INTEGER NOT NULL,
    "bidAt" TIMESTAMPTZ(6) NOT NULL,
    "restoredLastBidAt" TIMESTAMPTZ(6),
    "depositRequiredAfter" INTEGER NOT NULL DEFAULT 0,
    "depositId" TEXT,
    "triggeredSoftClose" BOOLEAN NOT NULL DEFAULT false,
    "deadlineBefore" TIMESTAMPTZ(3),
    "deadlineAfter" TIMESTAMPTZ(3),
    "idempotencyKey" VARCHAR(64),
    "actorType" "CoreActorType" NOT NULL DEFAULT 'USER',
    "actorUserId" TEXT,
    "ipHash" CHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BidHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "reason" "DepositReason" NOT NULL,
    "basisAmount" INTEGER NOT NULL,
    "depositType" "DepositType" NOT NULL,
    "depositFixedAmount" INTEGER,
    "depositPercentBp" INTEGER,
    "requiredAmount" INTEGER NOT NULL,
    "amountDue" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "windowMinutes" INTEGER NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "reminderSentAt" TIMESTAMPTZ(3),
    "paymentIntentId" TEXT,
    "paymentMethod" VARCHAR(30),
    "featureFlagSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "refundStatus" "DepositRefundStatus",
    "refundReason" "DepositRefundReason",
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "refundRequestedAt" TIMESTAMPTZ(3),
    "refundProcessedAt" TIMESTAMPTZ(3),
    "refundIdempotencyKey" TEXT,
    "refundProviderId" TEXT,
    "refundFailureCode" VARCHAR(50),
    "refundAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "forfeitedAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Selection" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "status" "SelectionRoundStatus" NOT NULL DEFAULT 'PENDING',
    "eventMode" "EventMode" NOT NULL,
    "capacitySnapshot" INTEGER NOT NULL,
    "remainingSeats" INTEGER NOT NULL,
    "effectiveDeadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "depositWindowMinutes" INTEGER NOT NULL DEFAULT 0,
    "rankingBasisAt" TIMESTAMPTZ(3) NOT NULL,
    "rankingComputedAt" TIMESTAMPTZ(3),
    "rankingSnapshotHash" CHAR(64),
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "autoPreselectedCount" INTEGER NOT NULL DEFAULT 0,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "overrideCount" INTEGER NOT NULL DEFAULT 0,
    "autoPreselectEnabled" BOOLEAN NOT NULL DEFAULT true,
    "requireReasonOnOverride" BOOLEAN NOT NULL DEFAULT true,
    "allowSelectOverCapacity" BOOLEAN NOT NULL DEFAULT false,
    "overCapacityTolerance" INTEGER NOT NULL DEFAULT 0,
    "waitlistSize" INTEGER NOT NULL DEFAULT 0,
    "editAfterFinalizeWindowHours" INTEGER NOT NULL DEFAULT 72,
    "maxReopenCount" INTEGER NOT NULL DEFAULT 3,
    "finalizedAt" TIMESTAMPTZ(3),
    "finalizedByUserId" TEXT,
    "notifyDispatchedAt" TIMESTAMPTZ(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "lastReopenedAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "partnerMemo" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionCutoff" (
    "selectionId" TEXT NOT NULL,
    "cutoffAmount" INTEGER,
    "cutoffLastBidAt" TIMESTAMPTZ(6),
    "hasCutoffTie" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SelectionCutoff_pkey" PRIMARY KEY ("selectionId")
);

-- CreateTable
CREATE TABLE "SelectionEntry" (
    "id" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayNameSnapshot" VARCHAR(100) NOT NULL,
    "amountSnapshot" INTEGER NOT NULL,
    "lastBidAtSnapshot" TIMESTAMPTZ(6) NOT NULL,
    "appliedAtSnapshot" TIMESTAMPTZ(6) NOT NULL,
    "rebidCountSnapshot" INTEGER NOT NULL DEFAULT 0,
    "depositStatusSnapshot" "DepositStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "depositPaidSnapshot" INTEGER NOT NULL DEFAULT 0,
    "depositConfirmedAtSnapshot" TIMESTAMPTZ(6),
    "rankNo" INTEGER,
    "isEligible" BOOLEAN NOT NULL DEFAULT true,
    "exclusionReason" "SelectionExclusionReason",
    "tieGroupKey" VARCHAR(64),
    "tieOrdinal" INTEGER,
    "withinCapacity" BOOLEAN NOT NULL DEFAULT false,
    "status" "SelectionStatus" NOT NULL DEFAULT 'CANDIDATE',
    "source" "SelectionEntrySource" NOT NULL DEFAULT 'AUTO_RANK',
    "amountAtSelection" INTEGER,
    "position" INTEGER,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" VARCHAR(500),
    "overriddenByUserId" TEXT,
    "overriddenAt" TIMESTAMPTZ(3),
    "preselectedAt" TIMESTAMPTZ(3),
    "selectedAt" TIMESTAMPTZ(3),
    "notifiedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" "SelectionRevokeReason",
    "revokedByRole" "CoreActorType",
    "promotedFromEntryId" TEXT,
    "refundSignaledAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SelectionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "titleKo" VARCHAR(120) NOT NULL,
    "bodyKo" TEXT NOT NULL,
    "payload" JSONB,
    "deepLinkPath" VARCHAR(300),
    "eventId" TEXT,
    "applicationId" TEXT,
    "dedupeKey" VARCHAR(200) NOT NULL,
    "coalesceKey" VARCHAR(200),
    "readAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "broadcastId" TEXT,
    "eventId" TEXT,
    "senderUserId" TEXT,
    "senderDisplayName" TEXT,
    "recipientUserId" TEXT NOT NULL,
    "titleKo" VARCHAR(120) NOT NULL,
    "bodyKo" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'DELIVERED',
    "skipReason" "DeliverySkipReason",
    "applicationStatusAtSend" "ApplicationStatus",
    "readAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT,
    "messageId" TEXT,
    "recipientUserId" TEXT,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "toAddress" TEXT,
    "subjectKo" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "lastProviderEventAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lockedUntil" TIMESTAMPTZ(3),
    "skipReason" "DeliverySkipReason",
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "openedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailGloballyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "marketingConsentAt" TIMESTAMPTZ(3),
    "marketingConsentWithdrawnAt" TIMESTAMPTZ(3),
    "nightMarketingConsentAt" TIMESTAMPTZ(3),
    "digestMode" "DigestMode" NOT NULL DEFAULT 'IMMEDIATE',
    "preferredLocale" TEXT NOT NULL DEFAULT 'ko-KR',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserNotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "scope" "SuppressionScope" NOT NULL DEFAULT 'MARKETING_ONLY',
    "userId" TEXT,
    "sourceProviderEventId" TEXT,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3),
    "releasedAt" TIMESTAMPTZ(3),
    "releasedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderRole" "UserRole" NOT NULL,
    "eventId" TEXT,
    "segment" "BroadcastSegment" NOT NULL,
    "segmentFilter" JSONB,
    "applicationStatuses" "ApplicationStatus"[],
    "titleKo" VARCHAR(120) NOT NULL,
    "bodyKo" TEXT NOT NULL,
    "channels" "NotificationChannel"[],
    "category" "NotificationCategory" NOT NULL DEFAULT 'ANNOUNCEMENT',
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMPTZ(3),
    "expansionCursor" TEXT,
    "audienceSnapshotAt" TIMESTAMPTZ(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "suppressedCount" INTEGER NOT NULL DEFAULT 0,
    "moderationState" "ModerationState" NOT NULL DEFAULT 'NOT_REQUIRED',
    "moderationNote" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "canceledByUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "AuditActorRole" NOT NULL,
    "actorLabel" VARCHAR(120) NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetType" "AuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetOwnerUserId" TEXT,
    "summary" VARCHAR(500) NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reasonCode" VARCHAR(50),
    "reasonMemo" VARCHAR(1000),
    "requestId" VARCHAR(80),
    "idempotencyKey" VARCHAR(120),
    "correlationId" VARCHAR(64),
    "ipHash" CHAR(64),
    "userAgent" VARCHAR(500),
    "prevHash" CHAR(64),
    "rowHash" CHAR(64) NOT NULL,
    "chainKey" VARCHAR(80) NOT NULL DEFAULT 'global',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "FeeScope" NOT NULL DEFAULT 'GLOBAL',
    "scopeRefId" TEXT,
    "eventMode" "EventMode",
    "feeType" "FeeType" NOT NULL,
    "percentBps" INTEGER,
    "fixedAmountKrw" INTEGER,
    "minFeeKrw" INTEGER,
    "maxFeeKrw" INTEGER,
    "vatIncluded" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PlatformFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "periodKstMonth" VARCHAR(7) NOT NULL,
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "grossAmountKrw" INTEGER NOT NULL DEFAULT 0,
    "depositCollectedKrw" INTEGER NOT NULL DEFAULT 0,
    "depositRefundedKrw" INTEGER NOT NULL DEFAULT 0,
    "feePolicyId" TEXT,
    "feePolicySnapshot" JSONB,
    "platformFeeKrw" INTEGER NOT NULL DEFAULT 0,
    "vatKrw" INTEGER NOT NULL DEFAULT 0,
    "netPayoutKrw" INTEGER NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "holdReason" TEXT,
    "payoutRefId" TEXT,
    "computedAt" TIMESTAMPTZ(3),
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" VARCHAR(80) NOT NULL,
    "valueJson" JSONB NOT NULL,
    "description" VARCHAR(500),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" VARCHAR(120) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "lockedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pk" PRIMARY KEY ("userId","endpoint","key")
);

-- CreateTable
CREATE TABLE "PartnerBlockedUser" (
    "id" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PartnerBlockedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCategoryInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCategoryInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdentityLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkedUserId" TEXT NOT NULL,
    "signal" "IdentitySignal" NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_VenueSecondaryCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_VenueSecondaryCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "user_status_created_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "user_dormancy_sweep_idx" ON "User"("status", "lastLoginAt");

-- CreateIndex
CREATE INDEX "user_withdrawal_sweep_idx" ON "User"("status", "withdrawalRequestedAt");

-- CreateIndex
CREATE INDEX "user_display_name_idx" ON "User"("displayName");

-- CreateIndex
CREATE INDEX "user_region_segment_idx" ON "User"("status", "preferredRegionCode");

-- CreateIndex
CREATE INDEX "user_roles_gin" ON "User" USING GIN ("roles");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerProfile_userId_key" ON "PartnerProfile"("userId");

-- CreateIndex
CREATE INDEX "partner_approval_queue_idx" ON "PartnerProfile"("approvalStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "partner_sla_overdue_idx" ON "PartnerProfile"("approvalStatus", "slaDueAt");

-- CreateIndex
CREATE INDEX "business_partner_idx" ON "Business"("partnerProfileId");

-- CreateIndex
CREATE INDEX "business_verify_queue_idx" ON "Business"("verificationStatus", "verificationSubmittedAt");

-- CreateIndex
CREATE INDEX "business_brn_lookup_idx" ON "Business"("businessRegistrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_coverImageId_key" ON "Venue"("coverImageId");

-- CreateIndex
CREATE INDEX "venue_search_region_idx" ON "Venue"("status", "sido", "sigungu");

-- CreateIndex
CREATE INDEX "venue_search_category_idx" ON "Venue"("status", "primaryCategoryId");

-- CreateIndex
CREATE INDEX "venue_search_open_event_idx" ON "Venue"("status", "openEventCount");

-- CreateIndex
CREATE INDEX "venue_search_recent_idx" ON "Venue"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "venue_business_idx" ON "Venue"("businessId");

-- CreateIndex
CREATE INDEX "venue_region_idx" ON "Venue"("regionCode");

-- CreateIndex
CREATE INDEX "venue_review_queue_idx" ON "Venue"("status", "submittedForReviewAt");

-- CreateIndex
CREATE INDEX "venue_primary_category_idx" ON "Venue"("primaryCategoryId");

-- CreateIndex
CREATE INDEX "venue_search_text_trgm" ON "Venue" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "venue_image_gallery_idx" ON "VenueImage"("venueId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "venue_image_sweeper_idx" ON "VenueImage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "category_tree_idx" ON "Category"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "category_active_idx" ON "Category"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE INDEX "region_tree_idx" ON "Region"("level", "parentCode");

-- CreateIndex
CREATE INDEX "region_active_idx" ON "Region"("isActive", "level");

-- CreateIndex
CREATE INDEX "region_sigungu_code_idx" ON "Region"("sigunguCode");

-- CreateIndex
CREATE INDEX "event_status_apply_end_idx" ON "Event"("status", "applyEndAt");

-- CreateIndex
CREATE INDEX "event_status_apply_start_idx" ON "Event"("status", "applyStartAt");

-- CreateIndex
CREATE INDEX "event_ranking_lock_idx" ON "Event"("status", "rankingLockAt");

-- CreateIndex
CREATE INDEX "event_stats_refresh_idx" ON "Event"("status", "statsRefreshedAt");

-- CreateIndex
CREATE INDEX "event_partner_list_idx" ON "Event"("partnerId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "event_venue_idx" ON "Event"("venueId", "status");

-- CreateIndex
CREATE INDEX "event_category_search_idx" ON "Event"("categoryId", "status", "applyEndAt");

-- CreateIndex
CREATE INDEX "event_sigungu_search_idx" ON "Event"("sigunguCode", "status", "applyEndAt");

-- CreateIndex
CREATE INDEX "event_region_id_idx" ON "Event"("regionId", "status");

-- CreateIndex
CREATE INDEX "event_service_date_idx" ON "Event"("serviceDateKst");

-- CreateIndex
CREATE INDEX "event_mode_status_idx" ON "Event"("mode", "status");

-- CreateIndex
CREATE INDEX "event_status_recent_idx" ON "Event"("status", "openedAt" DESC);

-- CreateIndex
CREATE INDEX "event_status_ratio_idx" ON "Event"("status", "competitionRatioX10" DESC);

-- CreateIndex
CREATE INDEX "event_tags_gin" ON "Event" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "event_id_mode_uq" ON "Event"("id", "mode");

-- CreateIndex
CREATE INDEX "event_image_order_idx" ON "EventImage"("eventId", "sortOrder");

-- CreateIndex
CREATE INDEX "application_rank_idx" ON "Application"("eventId", "amount" DESC, "lastBidAt" ASC, "applySeq");

-- CreateIndex
CREATE INDEX "application_deposit_due_idx" ON "Application"("depositStatus", "depositDueAt");

-- CreateIndex
CREATE INDEX "application_my_list_idx" ON "Application"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "application_slot_idx" ON "Application"("eventId", "slotClaimed");

-- CreateIndex
CREATE INDEX "application_broadcast_fanout_idx" ON "Application"("eventId", "status", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "application_event_user_uq" ON "Application"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "application_identity_uq" ON "Application"("id", "eventId", "userId");

-- CreateIndex
CREATE INDEX "bid_history_event_time_idx" ON "BidHistory"("eventId", "bidAt");

-- CreateIndex
CREATE INDEX "bid_history_app_time_idx" ON "BidHistory"("applicationId", "bidAt");

-- CreateIndex
CREATE INDEX "bid_history_user_time_idx" ON "BidHistory"("userId", "bidAt");

-- CreateIndex
CREATE INDEX "bid_history_deposit_idx" ON "BidHistory"("depositId");

-- CreateIndex
CREATE INDEX "bid_history_softclose_by_user_idx" ON "BidHistory"("eventId", "userId", "triggeredSoftClose");

-- CreateIndex
CREATE UNIQUE INDEX "bid_history_app_seq_uq" ON "BidHistory"("applicationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "bid_history_app_idem_uq" ON "BidHistory"("applicationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_paymentIntentId_key" ON "Deposit"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_refundIdempotencyKey_key" ON "Deposit"("refundIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_refundProviderId_key" ON "Deposit"("refundProviderId");

-- CreateIndex
CREATE INDEX "deposit_sweep_idx" ON "Deposit"("status", "dueAt");

-- CreateIndex
CREATE INDEX "deposit_event_status_idx" ON "Deposit"("eventId", "status");

-- CreateIndex
CREATE INDEX "deposit_refund_queue_idx" ON "Deposit"("refundStatus", "refundRequestedAt");

-- CreateIndex
CREATE INDEX "deposit_user_idx" ON "Deposit"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "deposit_reminder_idx" ON "Deposit"("status", "reminderSentAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_app_seq_uq" ON "Deposit"("applicationId", "seq");

-- CreateIndex
CREATE INDEX "selection_open_sweep_idx" ON "Selection"("status", "rankingBasisAt");

-- CreateIndex
CREATE INDEX "selection_event_status_idx" ON "Selection"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "selection_event_round_uq" ON "Selection"("eventId", "roundNo");

-- CreateIndex
CREATE INDEX "selection_entry_list_idx" ON "SelectionEntry"("selectionId", "status", "rankNo");

-- CreateIndex
CREATE INDEX "selection_entry_app_idx" ON "SelectionEntry"("applicationId");

-- CreateIndex
CREATE INDEX "selection_entry_user_event_idx" ON "SelectionEntry"("userId", "eventId");

-- CreateIndex
CREATE INDEX "selection_entry_event_status_idx" ON "SelectionEntry"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "selection_entry_round_app_uq" ON "SelectionEntry"("selectionId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "selection_entry_round_rank_uq" ON "SelectionEntry"("selectionId", "rankNo");

-- CreateIndex
CREATE INDEX "idx_notification_inbox_unread" ON "Notification"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_notification_inbox_page" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_notification_event_type" ON "Notification"("eventId", "type");

-- CreateIndex
CREATE INDEX "idx_notification_application" ON "Notification"("applicationId");

-- CreateIndex
CREATE INDEX "idx_notification_expires" ON "Notification"("expiresAt");

-- CreateIndex
CREATE INDEX "idx_notification_coalesce" ON "Notification"("coalesceKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_notification_user_dedupe" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "idx_message_inbox_unread" ON "Message"("recipientUserId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_message_inbox_page" ON "Message"("recipientUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_message_event" ON "Message"("eventId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_message_sender" ON "Message"("senderUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_message_broadcast_cursor" ON "Message"("broadcastId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_broadcast_recipient" ON "Message"("broadcastId", "recipientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_providerMessageId_key" ON "EmailDelivery"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_idempotencyKey_key" ON "EmailDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_email_delivery_dispatch" ON "EmailDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "idx_email_delivery_lease" ON "EmailDelivery"("status", "lockedUntil");

-- CreateIndex
CREATE INDEX "idx_email_delivery_address" ON "EmailDelivery"("toAddress", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_email_delivery_recipient" ON "EmailDelivery"("recipientUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_email_delivery_notification" ON "EmailDelivery"("notificationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "uq_email_delivery_message" ON "EmailDelivery"("messageId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "uq_notification_preference" ON "NotificationPreference"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationSetting_userId_key" ON "UserNotificationSetting"("userId");

-- CreateIndex
CREATE INDEX "idx_email_suppression_sweep" ON "EmailSuppression"("scope", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_email_suppression" ON "EmailSuppression"("email", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "Broadcast_idempotencyKey_key" ON "Broadcast"("idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_broadcast_sender" ON "Broadcast"("senderUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_broadcast_schedule" ON "Broadcast"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "idx_broadcast_event" ON "Broadcast"("eventId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_broadcast_moderation" ON "Broadcast"("moderationState", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_idempotencyKey_key" ON "AuditLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_audit_target" ON "AuditLog"("targetType", "targetId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_actor" ON "AuditLog"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_action" ON "AuditLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_recent" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_chain" ON "AuditLog"("chainKey", "seq");

-- CreateIndex
CREATE INDEX "idx_audit_correlation" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "idx_platform_fee_resolution" ON "PlatformFee"("scope", "scopeRefId", "eventMode", "effectiveFrom");

-- CreateIndex
CREATE INDEX "idx_platform_fee_active" ON "PlatformFee"("isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "idx_settlement_partner_period" ON "Settlement"("partnerProfileId", "periodKstMonth");

-- CreateIndex
CREATE INDEX "idx_settlement_status" ON "Settlement"("status", "periodKstMonth");

-- CreateIndex
CREATE UNIQUE INDEX "uq_settlement_event_period" ON "Settlement"("eventId", "periodKstMonth");

-- CreateIndex
CREATE INDEX "idem_sweep_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "partner_blocked_user_user_idx" ON "PartnerBlockedUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_blocked_user_uq" ON "PartnerBlockedUser"("partnerProfileId", "userId");

-- CreateIndex
CREATE INDEX "user_category_interest_fanout_idx" ON "UserCategoryInterest"("categoryId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_category_interest_uq" ON "UserCategoryInterest"("userId", "categoryId");

-- CreateIndex
CREATE INDEX "user_identity_link_reverse_idx" ON "UserIdentityLink"("linkedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identity_link_uq" ON "UserIdentityLink"("userId", "linkedUserId", "signal");

-- CreateIndex
CREATE INDEX "_VenueSecondaryCategories_B_index" ON "_VenueSecondaryCategories"("B");

-- AddForeignKey
ALTER TABLE "PartnerProfile" ADD CONSTRAINT "PartnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerProfile" ADD CONSTRAINT "PartnerProfile_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_primaryCategoryId_fkey" FOREIGN KEY ("primaryCategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "Region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "VenueImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueImage" ADD CONSTRAINT "VenueImage_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueImage" ADD CONSTRAINT "VenueImage_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "Region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImage" ADD CONSTRAINT "EventImage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_eventId_eventMode_fkey" FOREIGN KEY ("eventId", "eventMode") REFERENCES "Event"("id", "mode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidHistory" ADD CONSTRAINT "BidHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidHistory" ADD CONSTRAINT "BidHistory_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidHistory" ADD CONSTRAINT "BidHistory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidHistory" ADD CONSTRAINT "BidHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_eventId_eventMode_fkey" FOREIGN KEY ("eventId", "eventMode") REFERENCES "Event"("id", "mode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionCutoff" ADD CONSTRAINT "SelectionCutoff_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "Selection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionEntry" ADD CONSTRAINT "SelectionEntry_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "Selection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionEntry" ADD CONSTRAINT "SelectionEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionEntry" ADD CONSTRAINT "SelectionEntry_promotedFromEntryId_fkey" FOREIGN KEY ("promotedFromEntryId") REFERENCES "SelectionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionEntry" ADD CONSTRAINT "SelectionEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionEntry" ADD CONSTRAINT "SelectionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationSetting" ADD CONSTRAINT "UserNotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_feePolicyId_fkey" FOREIGN KEY ("feePolicyId") REFERENCES "PlatformFee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBlockedUser" ADD CONSTRAINT "PartnerBlockedUser_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBlockedUser" ADD CONSTRAINT "PartnerBlockedUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBlockedUser" ADD CONSTRAINT "PartnerBlockedUser_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCategoryInterest" ADD CONSTRAINT "UserCategoryInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCategoryInterest" ADD CONSTRAINT "UserCategoryInterest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityLink" ADD CONSTRAINT "UserIdentityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityLink" ADD CONSTRAINT "UserIdentityLink_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VenueSecondaryCategories" ADD CONSTRAINT "_VenueSecondaryCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VenueSecondaryCategories" ADD CONSTRAINT "_VenueSecondaryCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
