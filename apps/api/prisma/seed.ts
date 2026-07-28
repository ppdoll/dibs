/**
 * Dibs — 시드 데이터
 *
 * 실행: `pnpm --filter @dibs/api db:seed`  (내부적으로 `tsx prisma/seed.ts`)
 * 선행: `prisma migrate deploy` → `prisma/sql/001_constraints.sql` 적용.
 *       (001 을 적용하지 않아도 이 시드는 돌지만, 그건 CHECK 가 아무것도 안 지켜주는 DB 다.)
 *
 * ─── 이 파일이 지키는 두 가지 ────────────────────────────────────────────
 *
 * 1) **멱등성.** 몇 번을 다시 돌려도 행이 늘지 않고 죽지 않는다.
 *    키는 전부 안정적인 자연키다 — Region.code / User.email / Setting.key /
 *    (eventId,userId) / (applicationId,seq) / (userId,dedupeKey).
 *    Prisma 모델에 총(total) 유니크가 없는 것들(Category.code, Venue.slug, Event.slug 는
 *    001_constraints.sql 이 부분 유니크로 바꿔놨다)은 대신 **고정 id**(`seed-` 접두사)로 upsert 한다.
 *    id 를 고정하면 "이 행은 시드가 만든 것"이 눈으로 구분되고, 사람이 만든 데이터와 절대 섞이지 않는다.
 *
 * 2) **DB CHECK 를 통과하는 조합만 만든다.** 001_constraints.sql 의 제약은 장식이 아니라
 *    실제로 시드를 죽인다. 특히 자주 걸리는 것들:
 *      - app_settled_amount_chk      : depositStatus='NOT_REQUIRED' 면 settledAmount = amount 여야 한다
 *      - app_pending_deposit_chk     : status='PENDING_DEPOSIT' 면 depositStatus='PENDING'
 *      - app_expired_deposit_chk     : status='EXPIRED' 면 depositStatus='EXPIRED'
 *      - event_mode_amount_chk       : INSTANT=fixedAmount만 / BID=min·max만 (배타)
 *      - event_ranking_lock_*_chk    : OPEN·CLOSED·FINALIZED 는 rankingLockAt 필수, 그리고 applyEndAt 이후
 *      - deposit_paid_chk            : status='PAID' 면 amountPaid = amountDue 이고 paidAt 이 있어야 한다
 *      - venue_region_level_guard    : Venue.regionCode 는 반드시 SIGUNGU 레벨 Region
 *
 * ─── 확정된 라운드(FINALIZED)만 다르게 다루는 이유 ────────────────────────
 *   SelectionEntry 의 동결 스냅샷은 write-once 이고 BEFORE UPDATE 트리거가 수정을 거부한다(IC-34).
 *   그래서 확정 이벤트 묶음(이벤트/신청/라운드/엔트리)은 **처음 한 번만 쓰고 다시 건드리지 않는다**.
 *   나머지 "살아있는" 이벤트는 매 실행마다 시각을 now 기준으로 다시 계산해 데모가 늙지 않게 한다.
 */

import {
  AccountStatus,
  ApplicationStatus,
  BidSource,
  BusinessType,
  BusinessVerificationStatus,
  CoreActorType,
  DepositReason,
  DepositStatus,
  DepositType,
  EventMode,
  EventStatus,
  MessageKind,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  PartnerApprovalStatus,
  PrismaClient,
  RegionLevel,
  SelectionEntrySource,
  SelectionRoundStatus,
  SelectionStatus,
  UserRole,
  VenueImageStatus,
  VenueStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

// =============================================================================
// 0. 공통 — 시각 / 문자열 헬퍼
// =============================================================================

const NOW = new Date();

/** now 기준 n분 뒤(음수면 전). 시드의 모든 시각은 여기서만 나온다. */
const min = (n: number): Date => new Date(NOW.getTime() + n * 60_000);
const day = (n: number): Date => min(n * 1_440);

/**
 * KST 벽시계 날짜 'YYYY-MM-DD'.
 * event_service_date_format_chk 가 형식을 강제하고, event_service_date_idx 가 이 값으로 필터한다.
 */
function kstDateString(at: Date): string {
  return new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 동점 그룹 키 = `{금액}-{YYYYMMDDHH24MISSUS}` (RankingService 의 tie_key 와 같은 형식).
 * JS Date 는 밀리초까지라 마이크로초 자리는 항상 000 이다 — 시드 데이터라서 괜찮다.
 * 실제 순위 계산은 SQL 이 하고(IC-31), 여기 값은 그 SQL 이 만들 결과를 손으로 맞춘 데모용이다.
 */
function tieGroupKeyOf(amount: number, lastBidAt: Date): string {
  const iso = lastBidAt.toISOString(); // 2026-07-27T01:02:03.456Z
  const compact =
    iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) +
    iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) +
    iso.slice(20, 23) + '000';
  return `${amount}-${compact}`;
}

/** 정률 예약금(bp) → 실제 요구 금액. deposit-policy.ts 의 requiredDepositFor 와 같은 규칙. */
function percentDeposit(amount: number, bp: number, unit = 100): number {
  return Math.min(amount, Math.floor(Math.floor((amount * bp) / 10_000) / unit) * unit);
}

/** Map 에서 반드시 있어야 하는 값을 꺼낸다. noUncheckedIndexedAccess 때문에 필요하다. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`시드 내부 오류: ${what} 가 없습니다.`);
  return value;
}

// =============================================================================
// 1. 운영자 계정 (D-09)
//
//   운영자는 셀프가입이 불가능하다. 즉 **이 시드가 운영자를 만드는 유일한 경로**다.
//
//   ★ 구글 계정 연결 방법 — 반드시 읽을 것
//   AuthService.loginWithGoogle 은 **googleSub 로만** 계정을 찾는다(이메일은 바뀔 수 있으니까).
//   그런데 User.googleSub 은 NULL 로 둘 수 없다 — user_identity_present_chk 가
//   "살아있는 계정은 googleSub 와 email 이 둘 다 있어야 한다"를 강제한다.
//   그래서 여기서는 자리표시자 googleSub 을 넣는다.
//
//   결과(숨기지 않고 적는다): 자리표시자를 그대로 두고 그 이메일로 구글 로그인을 하면,
//   googleSub 이 안 맞아 신규 가입 경로로 빠지고 → email 유니크 위반으로 **로그인이 500 으로 실패한다.**
//   운영자로 로그인하기 전에 둘 중 하나를 반드시 해야 한다.
//
//     (A) 권장 — 구글 sub 를 미리 알고 있으면 env 로 넘긴다. 그러면 시드가 바로 연결해 준다.
//           ADMIN_SEED_EMAIL="me@gmail.com" ADMIN_SEED_GOOGLE_SUB="1078...(21자리)" pnpm db:seed
//
//     (B) 이미 시드를 돌린 뒤라면 한 줄 SQL 로 붙인다(Prisma Studio 로 같은 값을 고쳐도 된다).
//           UPDATE "User" SET "googleSub" = '<구글 sub>' WHERE email = '<ADMIN_SEED_EMAIL>';
//         구글 sub 는 https://oauth2.googleapis.com/tokeninfo?id_token=... 또는
//         로그인 실패 직후 서버 로그(googleProfileRaw)에서 확인할 수 있다.
// =============================================================================

/**
 * 환경변수를 읽되 **빈 문자열도 미설정으로 취급**한다.
 *
 * `??` 를 쓰면 안 된다. .env 에 `ADMIN_SEED_EMAIL=""` 처럼 키만 있고 값이 빈 경우가
 * 흔한데(우리 .env.example 이 정확히 그렇다), `??` 는 null/undefined 만 걸러내므로
 * 빈 문자열이 그대로 통과한다. 그러면 email='' 인 운영자가 만들어지고,
 * 그 계정으로는 로그인도 안 되고 어떤 안내문에도 이메일이 안 찍힌다.
 */
const envOr = (key: string, fallback: string): string => {
  const raw = process.env[key];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
};

const ADMIN_EMAIL = envOr('ADMIN_SEED_EMAIL', 'admin@dibs.local');
const ADMIN_GOOGLE_SUB = envOr('ADMIN_SEED_GOOGLE_SUB', 'seed-admin-placeholder');
const ADMIN_LINKED = ADMIN_GOOGLE_SUB !== 'seed-admin-placeholder';

async function seedAdmin(): Promise<string> {
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      id: 'seed-user-admin',
      googleSub: ADMIN_GOOGLE_SUB,
      email: ADMIN_EMAIL,
      emailVerifiedAt: NOW,
      displayName: '운영자',
      realName: 'Dibs 운영자',
      roles: [UserRole.USER, UserRole.ADMIN],
      status: AccountStatus.ACTIVE,
      notificationEmail: ADMIN_EMAIL,
      serviceTermsVersion: '1.0',
      serviceTermsAgreedAt: NOW,
      privacyTermsVersion: '1.0',
      privacyTermsAgreedAt: NOW,
      age14ConfirmedAt: NOW,
    },
    // googleSub 은 덮어쓰지 않는다. 사람이 (B) 로 붙여놓은 진짜 sub 를 시드 재실행이 지우면
    // 그 순간 운영자가 로그인할 수 없게 된다. env 로 명시했을 때만 갱신한다.
    update: {
      roles: [UserRole.USER, UserRole.ADMIN],
      status: AccountStatus.ACTIVE,
      ...(ADMIN_LINKED ? { googleSub: ADMIN_GOOGLE_SUB } : {}),
    },
    select: { id: true },
  });

  return admin.id;
}

// =============================================================================
// 2. 런타임 설정 / 피처 플래그 (IC-65)
//
//   env 로만 두면 플래그 하나 끄는 데 재배포가 필요하고 누가 언제 껐는지 기록이 없다.
//   Deposit.featureFlagSnapshot 이 "그 홀드를 만들 때 값이 뭐였는지"를 여기서 가져간다.
// =============================================================================

const SETTINGS: { key: string; value: unknown; description: string }[] = [
  {
    key: 'DEPOSIT_HOLD_ENABLED',
    value: false,
    description: '실제 결제(PG) 집행 스위치. D-05 에 따라 MVP 에서는 꺼둔다.',
  },
  {
    key: 'SETTLEMENT_ENABLED',
    value: false,
    description: '정산 계산/지급 스위치. 모델만 존재한다.',
  },
  {
    key: 'EVENT_ADVANCED_VISIBILITY_ENABLED',
    value: false,
    description: '커트라인·내 순위 공개 토글(D-07 의 보류 항목). 켜기 전에 제품 결정이 먼저다.',
  },
];

async function seedSettings(): Promise<number> {
  for (const s of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, valueJson: s.value as never, description: s.description },
      // 사람이 운영 화면에서 바꾼 값을 시드가 되돌리면 안 된다. 설명만 최신으로 맞춘다.
      update: { description: s.description },
    });
  }
  return SETTINGS.length;
}

// =============================================================================
// 3. 업종(Category)
//
//   Category.code 는 Prisma 쪽 @unique 가 없다(001 §10 이 부분 유니크로 바꿨다).
//   그래서 upsert 키는 고정 id 로 두고, code 는 "사람이 읽는 자연키"로 유지한다.
// =============================================================================

const CATEGORIES = [
  { code: 'fine-dining', nameKo: '파인다이닝', nameEn: 'Fine dining', iconKey: 'utensils' },
  { code: 'omakase', nameKo: '오마카세', nameEn: 'Omakase', iconKey: 'fish' },
  { code: 'cafe-dessert', nameKo: '카페·디저트', nameEn: 'Cafe & dessert', iconKey: 'coffee' },
  { code: 'pension-stay', nameKo: '펜션·숙소', nameEn: 'Stay', iconKey: 'bed' },
  { code: 'studio-rental', nameKo: '스튜디오·대관', nameEn: 'Studio & venue', iconKey: 'camera' },
  { code: 'class-oneday', nameKo: '클래스·원데이', nameEn: 'Class', iconKey: 'palette' },
  { code: 'sports-leisure', nameKo: '스포츠·레저', nameEn: 'Sports & leisure', iconKey: 'racket' },
  { code: 'beauty-salon', nameKo: '뷰티·살롱', nameEn: 'Beauty & salon', iconKey: 'scissors' },
] as const;

async function seedCategories(): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();

  for (const [index, c] of CATEGORIES.entries()) {
    const id = `seed-cat-${c.code}`;
    const row = await prisma.category.upsert({
      where: { id },
      create: {
        id,
        code: c.code,
        nameKo: c.nameKo,
        nameEn: c.nameEn,
        iconKey: c.iconKey,
        sortOrder: (index + 1) * 10,
        isActive: true,
      },
      update: {
        code: c.code,
        nameKo: c.nameKo,
        nameEn: c.nameEn,
        iconKey: c.iconKey,
        sortOrder: (index + 1) * 10,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    byCode.set(c.code, row.id);
  }

  return byCode;
}

// =============================================================================
// 4. 행정구역(Region)
//
//   code 는 **법정동코드 10자리**, sigunguCode 는 **행정표준코드 5자리**다.
//   이름만 비슷하고 값 공간이 겹치지 않는다 — Event.sigunguCode 는 venue.region.sigunguCode 를
//   복사하는 것 말고 채워지는 경로가 아예 없으므로(IC-52), SIGUNGU 행에 이 값이 비어 있으면
//   지역 검색이 조용히 0건이 된다. 001_constraints.sql §12-3 주석이 시드에 요구하는 항목이다.
// =============================================================================

interface RegionSeed {
  code: string;
  level: RegionLevel;
  sido: string;
  sigungu: string | null;
  sigunguCode: string | null;
  parentCode: string | null;
  displayName: string;
}

const REGIONS: RegionSeed[] = [
  { code: '1100000000', level: RegionLevel.SIDO, sido: '서울특별시', sigungu: null, sigunguCode: null, parentCode: null, displayName: '서울특별시' },
  { code: '1168000000', level: RegionLevel.SIGUNGU, sido: '서울특별시', sigungu: '강남구', sigunguCode: '11680', parentCode: '1100000000', displayName: '서울 강남구' },
  { code: '1165000000', level: RegionLevel.SIGUNGU, sido: '서울특별시', sigungu: '서초구', sigunguCode: '11650', parentCode: '1100000000', displayName: '서울 서초구' },
  { code: '1144000000', level: RegionLevel.SIGUNGU, sido: '서울특별시', sigungu: '마포구', sigunguCode: '11440', parentCode: '1100000000', displayName: '서울 마포구' },
  { code: '1120000000', level: RegionLevel.SIGUNGU, sido: '서울특별시', sigungu: '성동구', sigunguCode: '11200', parentCode: '1100000000', displayName: '서울 성동구' },
  { code: '1117000000', level: RegionLevel.SIGUNGU, sido: '서울특별시', sigungu: '용산구', sigunguCode: '11170', parentCode: '1100000000', displayName: '서울 용산구' },
  { code: '4100000000', level: RegionLevel.SIDO, sido: '경기도', sigungu: null, sigunguCode: null, parentCode: null, displayName: '경기도' },
  { code: '4113500000', level: RegionLevel.SIGUNGU, sido: '경기도', sigungu: '성남시 분당구', sigunguCode: '41135', parentCode: '4100000000', displayName: '경기 성남시 분당구' },
  { code: '4128500000', level: RegionLevel.SIGUNGU, sido: '경기도', sigungu: '고양시 일산동구', sigunguCode: '41285', parentCode: '4100000000', displayName: '경기 고양시 일산동구' },
];

async function seedRegions(): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();

  // 부모(SIDO)를 먼저 넣는다. parentCode 가 Region.code 를 참조하는 FK 라 순서가 곧 제약이다.
  const ordered = [...REGIONS].sort((a, b) => (a.parentCode === null ? -1 : 0) - (b.parentCode === null ? -1 : 0));

  for (const r of ordered) {
    const row = await prisma.region.upsert({
      where: { code: r.code },
      create: {
        id: `seed-region-${r.code}`,
        code: r.code,
        level: r.level,
        sido: r.sido,
        sigungu: r.sigungu,
        sigunguCode: r.sigunguCode,
        parentCode: r.parentCode,
        displayName: r.displayName,
        isActive: true,
      },
      update: {
        level: r.level,
        sido: r.sido,
        sigungu: r.sigungu,
        sigunguCode: r.sigunguCode,
        parentCode: r.parentCode,
        displayName: r.displayName,
        isActive: true,
      },
      select: { id: true },
    });
    idByCode.set(r.code, row.id);
  }

  return idByCode;
}

// =============================================================================
// 5. 데모 파트너 (User → PartnerProfile → Business → Venue → VenueImage)
// =============================================================================

const PARTNER_EMAIL = 'partner@dibs.demo';

interface VenueSeed {
  id: string;
  slug: string;
  name: string;
  categoryCode: string;
  regionCode: string;
  sido: string;
  sigungu: string;
  postalCode: string;
  roadAddress: string;
  summary: string;
  phone: string;
  seatCount: number;
}

const VENUES: VenueSeed[] = [
  {
    id: 'seed-venue-gangnam',
    slug: 'dibs-table-gangnam',
    name: '딥스테이블 강남점',
    categoryCode: 'fine-dining',
    regionCode: '1168000000',
    sido: '서울특별시',
    sigungu: '강남구',
    postalCode: '06035',
    roadAddress: '서울특별시 강남구 도산대로 108',
    summary: '제철 재료로 매달 코스를 바꾸는 15석 다이닝',
    phone: '02-540-1234',
    seatCount: 15,
  },
  {
    id: 'seed-venue-seongsu',
    slug: 'dibs-roastery-seongsu',
    name: '딥스로스터리 성수점',
    categoryCode: 'cafe-dessert',
    regionCode: '1120000000',
    sido: '서울특별시',
    sigungu: '성동구',
    postalCode: '04781',
    roadAddress: '서울특별시 성동구 연무장길 45',
    summary: '로스팅룸을 통째로 빌려 여는 커피 클래스 공간',
    phone: '02-464-5678',
    seatCount: 24,
  },
];

interface PartnerWorld {
  partnerUserId: string;
  partnerProfileId: string;
  businessId: string;
  venueIds: string[];
  imageCount: number;
}

async function seedPartner(categoryIdByCode: Map<string, string>): Promise<PartnerWorld> {
  const partnerUser = await prisma.user.upsert({
    where: { email: PARTNER_EMAIL },
    create: {
      id: 'seed-user-partner',
      googleSub: 'seed-google-partner',
      email: PARTNER_EMAIL,
      emailVerifiedAt: NOW,
      displayName: '딥스컴퍼니',
      realName: '김파트너',
      phone: '010-2000-0001',
      phoneVerifiedAt: day(-40),
      roles: [UserRole.USER, UserRole.PARTNER],
      status: AccountStatus.ACTIVE,
      notificationEmail: PARTNER_EMAIL,
      serviceTermsVersion: '1.0',
      serviceTermsAgreedAt: day(-40),
      privacyTermsVersion: '1.0',
      privacyTermsAgreedAt: day(-40),
      age14ConfirmedAt: day(-40),
    },
    update: { roles: [UserRole.USER, UserRole.PARTNER], status: AccountStatus.ACTIVE },
    select: { id: true },
  });

  // PartnerProfile.userId 는 @unique 라 그 자체가 자연키다.
  const profile = await prisma.partnerProfile.upsert({
    where: { userId: partnerUser.id },
    create: {
      id: 'seed-partner-profile',
      userId: partnerUser.id,
      contactName: '김파트너',
      contactEmail: PARTNER_EMAIL,
      contactPhone: '010-2000-0001',
      approvalStatus: PartnerApprovalStatus.APPROVED,
      submittedAt: day(-38),
      approvedAt: day(-37),
      partnerTermsVersion: '1.0',
      partnerTermsAgreedAt: day(-38),
    },
    update: { approvalStatus: PartnerApprovalStatus.APPROVED, approvedAt: day(-37) },
    select: { id: true },
  });

  // 사업자등록번호가 진짜 자연키지만 Prisma 쪽에 총 유니크가 없다(001 §9-4 의 부분 유니크가 담당).
  // 그래서 upsert 키는 고정 id 로 둔다.
  const business = await prisma.business.upsert({
    where: { id: 'seed-business' },
    create: {
      id: 'seed-business',
      partnerProfileId: profile.id,
      name: '딥스컴퍼니',
      legalName: '주식회사 딥스컴퍼니',
      businessRegistrationNumber: '1208147521',
      businessType: BusinessType.CORPORATION,
      representativeName: '김파트너',
      verificationStatus: BusinessVerificationStatus.VERIFIED,
      verificationSubmittedAt: day(-38),
      verifiedAt: day(-37),
      contactEmail: PARTNER_EMAIL,
      contactPhone: '02-540-1234',
      postalCode: '06035',
      roadAddress: '서울특별시 강남구 도산대로 108',
      detailAddress: '3층',
    },
    update: {
      verificationStatus: BusinessVerificationStatus.VERIFIED,
      verifiedAt: day(-37),
    },
    select: { id: true },
  });

  const venueIds: string[] = [];
  let imageCount = 0;

  for (const v of VENUES) {
    const categoryId = must(categoryIdByCode.get(v.categoryCode), `카테고리 ${v.categoryCode}`);

    await prisma.venue.upsert({
      where: { id: v.id },
      create: {
        id: v.id,
        businessId: business.id,
        name: v.name,
        slug: v.slug,
        summary: v.summary,
        description: `${v.summary}. 딥스에서만 열리는 한정 예약을 운영합니다.`,
        status: VenueStatus.ACTIVE,
        primaryCategoryId: categoryId,
        regionCode: v.regionCode,
        sido: v.sido,
        sigungu: v.sigungu,
        postalCode: v.postalCode,
        roadAddress: v.roadAddress,
        phone: v.phone,
        seatCount: v.seatCount,
        searchText: `${v.name} ${v.summary} ${v.sido} ${v.sigungu}`,
        submittedForReviewAt: day(-36),
        publishedAt: day(-35),
      },
      update: {
        status: VenueStatus.ACTIVE,
        primaryCategoryId: categoryId,
        searchText: `${v.name} ${v.summary} ${v.sido} ${v.sigungu}`,
        publishedAt: day(-35),
        deletedAt: null,
      },
      select: { id: true },
    });

    // ★ 실제 업로드가 아니다. Vercel Blob 2단계 핸드셰이크(클라이언트 직접 업로드 → 서버 등록)를
    //   시드에서 재현할 방법이 없으므로 URL 만 그럴듯하게 채운 자리표시자다.
    //   이미지가 안 뜨는 건 정상이고, 진짜 이미지는 파트너 콘솔에서 올려야 한다.
    const images = [0, 1].map((sortOrder) => ({
      id: `${v.id}-img-${sortOrder}`,
      venueId: v.id,
      blobUrl: `https://placeholder.blob.vercel-storage.com/seed/${v.slug}-${sortOrder}.jpg`,
      blobPathname: `seed/${v.slug}-${sortOrder}.jpg`,
      mimeType: 'image/jpeg',
      byteSize: 240_000,
      width: 1600,
      height: 1067,
      altText: `${v.name} 대표 이미지 ${sortOrder + 1}`,
      sortOrder,
      isCover: sortOrder === 0,
      status: VenueImageStatus.READY,
      uploadedByUserId: partnerUser.id,
    }));

    const created = await prisma.venueImage.createMany({ data: images, skipDuplicates: true });
    imageCount += created.count;

    await prisma.venue.update({
      where: { id: v.id },
      data: { coverImageId: `${v.id}-img-0`, imageCount: images.length },
    });

    venueIds.push(v.id);
  }

  return {
    partnerUserId: partnerUser.id,
    partnerProfileId: profile.id,
    businessId: business.id,
    venueIds,
    imageCount,
  };
}

// =============================================================================
// 6. 데모 이용자
//
//   u1~u8 이 "데모 로그인 계정"이다. 화면을 눌러 볼 사람은 이 8개만 보면 된다.
//   f1~f12 는 경쟁률·순위 화면이 한 줄짜리로 보이지 않게 하려고 넣는 **군중용 보조 계정**이다.
//   1계정 1신청(application_event_user_uq)이라 15명짜리 입찰을 만들려면 계정도 15개가 필요하다.
//
//   phoneVerifiedAt 이 전부 채워져 있는 이유: 신청 INSERT 가 같은 문장 안에서
//   `u."phoneVerifiedAt" IS NOT NULL` 을 확인한다(IC-18). 비어 있으면 신청 자체가 403 이다.
//   번호는 전부 다르다 — user_phone_uq 가 "인증된 번호 1개 = 사람 1명"을 강제한다.
// =============================================================================

const PRIMARY_USERS = [
  { key: 'u1', name: '서지우' },
  { key: 'u2', name: '박도윤' },
  { key: 'u3', name: '이하은' },
  { key: 'u4', name: '최시우' },
  { key: 'u5', name: '정예린' },
  { key: 'u6', name: '강민준' },
  { key: 'u7', name: '윤서아' },
  { key: 'u8', name: '임건우' },
] as const;

const FILLER_COUNT = 12;

async function seedUsers(): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  let phoneSeq = 1;

  const upsertUser = async (key: string, displayName: string) => {
    const email = `${key}@dibs.demo`;
    const phone = `010-3000-${String(phoneSeq++).padStart(4, '0')}`;

    const row = await prisma.user.upsert({
      where: { email },
      create: {
        id: `seed-user-${key}`,
        googleSub: `seed-google-${key}`,
        email,
        emailVerifiedAt: day(-20),
        displayName,
        phone,
        phoneVerifiedAt: day(-20),
        roles: [UserRole.USER],
        status: AccountStatus.ACTIVE,
        notificationEmail: email,
        preferredRegionCode: '1168000000',
        serviceTermsVersion: '1.0',
        serviceTermsAgreedAt: day(-20),
        privacyTermsVersion: '1.0',
        privacyTermsAgreedAt: day(-20),
        age14ConfirmedAt: day(-20),
      },
      // 휴대폰 인증을 되살리는 것이 핵심이다. 누가 테스트로 지워놓으면 신청이 전부 403 이 된다.
      update: { status: AccountStatus.ACTIVE, phone, phoneVerifiedAt: day(-20) },
      select: { id: true },
    });

    // 알림 화면이 "설정 없음"으로 비지 않게 계정 단위 스위치를 만들어 둔다.
    await prisma.userNotificationSetting.upsert({
      where: { userId: row.id },
      create: { id: `seed-notifset-${key}`, userId: row.id, emailGloballyEnabled: true },
      update: {},
    });

    idByKey.set(key, row.id);
  };

  for (const u of PRIMARY_USERS) await upsertUser(u.key, u.name);
  for (let i = 1; i <= FILLER_COUNT; i += 1) await upsertUser(`f${i}`, `데모참가자${i}`);

  return idByKey;
}

// =============================================================================
// 7. 이벤트
// =============================================================================

const DEPOSIT_WINDOW_MIN = 10;
/** 순위 확정 시각 = 마감 + 디파짓 윈도우 + FINALIZE_GRACE(1분). (D-04) */
const rankingLockOf = (applyEndAt: Date, windowMinutes: number): Date =>
  new Date(applyEndAt.getTime() + (windowMinutes + 1) * 60_000);

interface ApplicantSeed {
  /** 데모 이용자 키 (u1~u8 / f1~f12) */
  key: string;
  amount: number;
  /** now 기준 분. 신청 기간 안이어야 한다(IC-33 이 마감 이후 신청을 순위에서 뺀다). */
  atMin: number;
  /** 최초 신청 시각이 다르면(=상향한 사람) 여기에. 없으면 atMin 과 같다. */
  firstAtMin?: number;
  status: ApplicationStatus;
}

// ── 7-1. INSTANT / OPEN — 선착순 즉시확정, 고정 30,000원, 정원 5 ────────────
const INSTANT_OPEN_ID = 'seed-event-instant-open';
const INSTANT_FIXED_AMOUNT = 30_000;
const INSTANT_DEPOSIT = 5_000;
const INSTANT_APPLICANTS: ApplicantSeed[] = [
  { key: 'u1', amount: INSTANT_FIXED_AMOUNT, atMin: -600, status: ApplicationStatus.CONFIRMED },
  { key: 'u2', amount: INSTANT_FIXED_AMOUNT, atMin: -480, status: ApplicationStatus.CONFIRMED },
  { key: 'u3', amount: INSTANT_FIXED_AMOUNT, atMin: -300, status: ApplicationStatus.CONFIRMED },
  // 아직 예약금 카운트다운 중. 자리는 이미 잡고 있다(D-05: 모드 A 는 잡아둔 자리를 유지).
  { key: 'u4', amount: INSTANT_FIXED_AMOUNT, atMin: -3, status: ApplicationStatus.PENDING_DEPOSIT },
  // 미납으로 만료된 신청. 자리는 반환됐다 → claimedCount 에 포함되지 않는다(IC-15).
  { key: 'u5', amount: INSTANT_FIXED_AMOUNT, atMin: -200, status: ApplicationStatus.EXPIRED },
];

// ── 7-2. BID / OPEN — 50,000~300,000원, 정원 10, 15명 ───────────────────────
const BID_OPEN_ID = 'seed-event-bid-open';
const BID_OPEN_PERCENT_BP = 1_000; // 10%
const BID_OPEN_APPLICANTS: ApplicantSeed[] = [
  { key: 'u1', amount: 280_000, atMin: -900, status: ApplicationStatus.VALID },
  { key: 'u2', amount: 240_000, atMin: -880, status: ApplicationStatus.VALID },
  // ★ 상향한 사람: 180,000 → 210,000. lastBidAt 이 상향 시각으로 갱신됐다(D-06).
  { key: 'u3', amount: 210_000, atMin: -700, firstAtMin: -1_000, status: ApplicationStatus.VALID },
  { key: 'u4', amount: 180_000, atMin: -650, status: ApplicationStatus.VALID },
  // ★ 동점 A — 150,000 을 **먼저** 불렀다. D-04 의 2순위 키(lastBidAt ASC)로 이긴다.
  { key: 'u5', amount: 150_000, atMin: -600, status: ApplicationStatus.VALID },
  // ★ 동점 B — 같은 150,000 인데 3시간 늦게 불렀다. 같은 금액에서 뒤로 밀린다.
  { key: 'u6', amount: 150_000, atMin: -420, status: ApplicationStatus.VALID },
  { key: 'u7', amount: 140_000, atMin: -540, status: ApplicationStatus.VALID },
  { key: 'u8', amount: 130_000, atMin: -500, status: ApplicationStatus.VALID },
  { key: 'f1', amount: 120_000, atMin: -480, status: ApplicationStatus.VALID },
  { key: 'f2', amount: 110_000, atMin: -460, status: ApplicationStatus.VALID },
  { key: 'f3', amount: 100_000, atMin: -440, status: ApplicationStatus.VALID },
  { key: 'f4', amount: 90_000, atMin: -400, status: ApplicationStatus.VALID },
  { key: 'f5', amount: 80_000, atMin: -360, status: ApplicationStatus.VALID },
  { key: 'f6', amount: 70_000, atMin: -300, status: ApplicationStatus.VALID },
  // 예약금 미납 — 순위 집계에서 빠진다(D-05: 디파짓은 순위가 아니라 자격 요건).
  { key: 'f7', amount: 60_000, atMin: -5, status: ApplicationStatus.PENDING_DEPOSIT },
];

// ── 7-3. BID / CLOSED — 확정 시각이 지났고 열린 홀드가 없다 = 라운드를 열 수 있다 ──
const BID_CLOSED_ID = 'seed-event-bid-closed';
const BID_CLOSED_APPLICANTS: ApplicantSeed[] = [
  { key: 'u1', amount: 190_000, atMin: -5_000, status: ApplicationStatus.VALID },
  { key: 'u2', amount: 170_000, atMin: -4_800, status: ApplicationStatus.VALID },
  { key: 'u3', amount: 150_000, atMin: -4_600, status: ApplicationStatus.VALID },
  { key: 'u4', amount: 130_000, atMin: -4_400, status: ApplicationStatus.VALID },
  { key: 'u5', amount: 110_000, atMin: -4_200, status: ApplicationStatus.VALID },
  { key: 'u6', amount: 90_000, atMin: -4_000, status: ApplicationStatus.VALID },
  { key: 'f8', amount: 80_000, atMin: -3_800, status: ApplicationStatus.VALID },
  { key: 'f9', amount: 60_000, atMin: -3_600, status: ApplicationStatus.VALID },
  { key: 'f10', amount: 40_000, atMin: -3_400, status: ApplicationStatus.VALID },
];

// ── 7-4. BID / FINALIZED — 당첨/미당첨 화면에 데이터가 있어야 한다 ───────────
const BID_FINALIZED_ID = 'seed-event-bid-finalized';
const BID_FINALIZED_CAPACITY = 3;
const BID_FINALIZED_APPLICANTS: ApplicantSeed[] = [
  { key: 'u2', amount: 148_000, atMin: -40_000, status: ApplicationStatus.CONFIRMED },
  { key: 'u3', amount: 132_000, atMin: -39_000, status: ApplicationStatus.CONFIRMED },
  { key: 'u4', amount: 120_000, atMin: -38_000, status: ApplicationStatus.CONFIRMED },
  { key: 'u5', amount: 95_000, atMin: -37_000, status: ApplicationStatus.NOT_SELECTED },
  { key: 'u6', amount: 80_000, atMin: -36_000, status: ApplicationStatus.NOT_SELECTED },
  { key: 'u7', amount: 60_000, atMin: -35_000, status: ApplicationStatus.NOT_SELECTED },
  { key: 'u8', amount: 45_000, atMin: -34_000, status: ApplicationStatus.NOT_SELECTED },
];

interface EventCounts {
  live: number;
  total: number;
  expired: number;
}

function countOf(applicants: ApplicantSeed[]): EventCounts {
  const live = applicants.filter((a) =>
    (
      [
        ApplicationStatus.PENDING_DEPOSIT,
        ApplicationStatus.VALID,
        ApplicationStatus.CONFIRMED,
      ] as ApplicationStatus[]
    ).includes(a.status),
  ).length;

  return {
    live,
    total: applicants.length,
    expired: applicants.filter((a) => a.status === ApplicationStatus.EXPIRED).length,
  };
}

/** round(live * 10 / capacity) — "4.7:1" 을 정수로 저장한다. */
const ratioX10 = (live: number, capacity: number): number =>
  capacity > 0 ? Math.round((live * 10) / capacity) : 0;

interface SeedEventInput {
  id: string;
  slug: string;
  title: string;
  description: string;
  venueId: string;
  partnerId: string;
  categoryId: string;
  regionId: string;
  sigunguCode: string;
  mode: EventMode;
  status: EventStatus;
  capacity: number;
  fixedAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  amountStep?: number;
  applyStartAt: Date;
  applyEndAt: Date;
  serviceStartAt: Date;
  tags: string[];
  deposit?:
    | { type: 'FIXED'; amount: number }
    | { type: 'PERCENT'; bp: number };
  softClose?: boolean;
  counts: EventCounts;
  claimedCount?: number;
}

function eventData(input: SeedEventInput) {
  const hasRankingLock = (
    [EventStatus.OPEN, EventStatus.CLOSED, EventStatus.FINALIZED, EventStatus.SCHEDULED] as EventStatus[]
  ).includes(input.status);

  // 삼항 안에서 좁히지 않고 미리 갈라둔다 — 판별 유니온을 옵셔널 체이닝으로 좁히는 코드는
  // 나중에 필드가 하나 늘 때 조용히 null 을 흘린다. event_deposit_policy_chk 가 그걸 잡긴 하지만,
  // 시드가 CHECK 로 죽는 것보다 여기서 명시적인 편이 낫다.
  const deposit = input.deposit;
  const depositRequired = deposit !== undefined;
  const windowMinutes = DEPOSIT_WINDOW_MIN;
  const depositType =
    deposit === undefined ? null : deposit.type === 'FIXED' ? DepositType.FIXED : DepositType.PERCENT;
  const depositFixedAmount = deposit !== undefined && deposit.type === 'FIXED' ? deposit.amount : null;
  const depositPercentBp = deposit !== undefined && deposit.type === 'PERCENT' ? deposit.bp : null;

  return {
    venueId: input.venueId,
    partnerId: input.partnerId,
    categoryId: input.categoryId,
    regionId: input.regionId,
    // IC-52: 채워지는 경로는 venue.region.sigunguCode 복사 하나뿐이다.
    sigunguCode: input.sigunguCode,
    title: input.title,
    slug: input.slug,
    description: input.description,
    tags: input.tags,
    mode: input.mode,
    status: input.status,
    capacity: input.capacity,
    claimedCount: input.claimedCount ?? 0,
    // event_mode_amount_chk: 두 벌이 배타적이어야 한다.
    fixedAmount: input.mode === EventMode.INSTANT ? (input.fixedAmount ?? 0) : null,
    minAmount: input.mode === EventMode.BID ? (input.minAmount ?? 0) : null,
    maxAmount: input.mode === EventMode.BID ? (input.maxAmount ?? 0) : null,
    amountStep: input.amountStep ?? 1,
    applyStartAt: input.applyStartAt,
    applyEndAt: input.applyEndAt,
    rankingLockAt: hasRankingLock ? rankingLockOf(input.applyEndAt, windowMinutes) : null,
    serviceStartAt: input.serviceStartAt,
    serviceEndAt: new Date(input.serviceStartAt.getTime() + 2 * 3_600_000),
    serviceDateKst: kstDateString(input.serviceStartAt),
    depositRequired,
    depositType,
    depositFixedAmount,
    depositPercentBp,
    depositRoundingUnit: 100,
    depositWindowMinutes: windowMinutes,
    depositRefundNote: depositRequired ? '미선정 시 3영업일 이내 전액 환불됩니다.' : null,
    // event_softclose_config_chk: 켜면 window/extend/hardEnd 가 전부 있어야 한다.
    softCloseEnabled: input.softClose === true,
    softCloseWindowMinutes: input.softClose === true ? 10 : null,
    softCloseExtendMinutes: input.softClose === true ? 10 : null,
    softCloseHardEndAt:
      input.softClose === true ? new Date(input.applyEndAt.getTime() + 60 * 60_000) : null,
    showCompetitionRatio: true,
    liveApplicantCount: input.counts.live,
    totalApplicationCount: input.counts.total,
    expiredCount: input.counts.expired,
    competitionRatioX10: ratioX10(input.counts.live, input.capacity),
    statsRefreshedAt: NOW,
    openedAt: (
      [EventStatus.OPEN, EventStatus.CLOSED, EventStatus.FINALIZED] as EventStatus[]
    ).includes(input.status)
      ? input.applyStartAt
      : null,
    closedAt: (
      [EventStatus.CLOSED, EventStatus.FINALIZED] as EventStatus[]
    ).includes(input.status)
      ? input.applyEndAt
      : null,
    finalizedAt:
      input.status === EventStatus.FINALIZED
        ? new Date(input.applyEndAt.getTime() + 24 * 3_600_000)
        : null,
  };
}

/**
 * 신청 1건 + (필요하면) 예약금 홀드 + 입찰 이력.
 *
 * 상태별로 채워야 하는 컬럼 조합이 다르고, 그 조합을 CHECK 가 전부 검사한다.
 * 여기 한 곳에서만 만들어야 조합이 어긋나지 않는다.
 */
interface WriteApplicationInput {
  eventId: string;
  eventMode: EventMode;
  applicant: ApplicantSeed;
  userId: string;
  requiredDeposit: number;
  /** 확정 라운드처럼 다시 쓰면 안 되는 묶음은 true. (SelectionEntry 스냅샷 불변 — IC-34) */
  writeOnce: boolean;
}

interface WrittenApplication {
  id: string;
  userId: string;
  amount: number;
  lastBidAt: Date;
  firstAppliedAt: Date;
  status: ApplicationStatus;
  depositStatus: DepositStatus;
  depositPaid: number;
}

async function writeApplication(input: WriteApplicationInput): Promise<WrittenApplication> {
  const { applicant, requiredDeposit } = input;
  const applicationId = `seed-app-${input.eventId.replace('seed-event-', '')}-${applicant.key}`;

  const lastBidAt = min(applicant.atMin);
  const firstAppliedAt = min(applicant.firstAtMin ?? applicant.atMin);

  // 상태 × 예약금 조합. 001_constraints.sql §3 이 검사하는 그 조합이다.
  const needsDeposit = requiredDeposit > 0;
  const pending = applicant.status === ApplicationStatus.PENDING_DEPOSIT;
  const expired = applicant.status === ApplicationStatus.EXPIRED;

  const depositStatus = !needsDeposit
    ? DepositStatus.NOT_REQUIRED
    : pending
      ? DepositStatus.PENDING
      : expired
        ? DepositStatus.EXPIRED
        : DepositStatus.PAID;

  const depositPaid = depositStatus === DepositStatus.PAID ? requiredDeposit : 0;

  // app_settled_amount_chk: NOT_REQUIRED 면 settledAmount = amount 여야 하고,
  // 아직 안 낸(PENDING) / 만료된(EXPIRED) 신청은 담보가 없으므로 0 이다.
  const settledAmount =
    depositStatus === DepositStatus.NOT_REQUIRED || depositStatus === DepositStatus.PAID
      ? applicant.amount
      : 0;

  const slotClaimed =
    input.eventMode === EventMode.INSTANT &&
    (applicant.status === ApplicationStatus.CONFIRMED ||
      applicant.status === ApplicationStatus.PENDING_DEPOSIT);

  const row = {
    id: applicationId,
    eventId: input.eventId,
    userId: input.userId,
    eventMode: input.eventMode,
    status: applicant.status,
    amount: applicant.amount,
    lastBidAt,
    firstAppliedAt,
    settledAmount,
    // app_bid_clock_order_chk: settledLastBidAt <= lastBidAt
    settledLastBidAt: settledAmount > 0 ? lastBidAt : firstAppliedAt,
    highestAmountEver: applicant.amount,
    depositStatus,
    // app_deposit_due_required_chk: 열린 홀드에는 만기가 반드시 있어야 한다.
    depositDueAt: depositStatus === DepositStatus.PENDING ? min(applicant.atMin + DEPOSIT_WINDOW_MIN) : null,
    depositRequiredAmount: needsDeposit ? requiredDeposit : 0,
    depositPaidAmount: depositPaid,
    rebidCount: applicant.firstAtMin === undefined ? 0 : 1,
    slotClaimed,
    canceledAt: expired ? lastBidAt : null,
    lastCanceledAt: expired ? lastBidAt : null,
    confirmedAt:
      applicant.status === ApplicationStatus.CONFIRMED || applicant.status === ApplicationStatus.VALID
        ? lastBidAt
        : null,
    agreedTermsVersion: '1.0',
  };

  if (input.writeOnce) {
    await prisma.application.createMany({ data: [row], skipDuplicates: true });
  } else {
    const { id: _ignored, eventId: _e, userId: _u, ...mutable } = row;
    await prisma.application.upsert({
      where: { eventId_userId: { eventId: input.eventId, userId: input.userId } },
      create: row,
      update: mutable,
    });
  }

  // ── 예약금 홀드 ──────────────────────────────────────────────────────
  if (needsDeposit) {
    const openedAt = lastBidAt;
    const dueAt = min(applicant.atMin + DEPOSIT_WINDOW_MIN);

    // deposit_status_domain_chk: NOT_REQUIRED / SHORTFALL_PENDING 은 이 컬럼에 올 수 없다.
    const holdStatus = pending
      ? DepositStatus.PENDING
      : expired
        ? DepositStatus.EXPIRED
        : DepositStatus.PAID;

    // 산정 스냅샷을 FIXED 로 접는 이유는 앱과 같다(deposit-policy.ts 의 foldDepositConfig):
    // bp·라운딩·상하한을 원 단위 금액으로 접는 계산은 한 곳에서만 하고, 홀드에는 그 결과를 박는다.
    // 정률 이벤트라도 홀드 행은 "그때 얼마를 요구했는가"만 재구성할 수 있으면 된다.
    const hold = {
      id: `${applicationId}-dep-1`,
      applicationId,
      eventId: input.eventId,
      userId: input.userId,
      seq: 1,
      reason: DepositReason.INITIAL,
      basisAmount: applicant.amount,
      depositType: DepositType.FIXED,
      depositFixedAmount: requiredDeposit,
      depositPercentBp: null,
      requiredAmount: requiredDeposit,
      amountDue: requiredDeposit, // deposit_amounts_chk: amountDue > 0
      // deposit_paid_chk: PAID 면 amountPaid = amountDue 이고 paidAt 이 있어야 한다.
      amountPaid: holdStatus === DepositStatus.PAID ? requiredDeposit : 0,
      windowMinutes: DEPOSIT_WINDOW_MIN,
      openedAt,
      dueAt,
      status: holdStatus,
      paidAt: holdStatus === DepositStatus.PAID ? new Date(openedAt.getTime() + 60_000) : null,
      resolvedAt: holdStatus === DepositStatus.PENDING ? null : new Date(openedAt.getTime() + 60_000),
      featureFlagSnapshot: false,
    };

    if (input.writeOnce) {
      await prisma.deposit.createMany({ data: [hold], skipDuplicates: true });
    } else {
      const { id: _hid, applicationId: _aid, ...mutableHold } = hold;
      await prisma.deposit.upsert({
        where: { applicationId_seq: { applicationId, seq: 1 } },
        create: hold,
        update: mutableHold,
      });
    }
  }

  // ── 입찰 이력 (append-only) ──────────────────────────────────────────
  // bid_history_previous_amount_chk: INITIAL_APPLY 만 previousAmount 가 NULL 이다.
  // bid_history_arithmetic_chk: newAmount = COALESCE(previousAmount,0) + deltaAmount
  const initialAmount = applicant.firstAtMin === undefined ? applicant.amount : applicant.amount - 30_000;

  const history: {
    id: string;
    applicationId: string;
    eventId: string;
    userId: string;
    seq: number;
    source: BidSource;
    previousAmount: number | null;
    newAmount: number;
    deltaAmount: number;
    bidAt: Date;
    depositRequiredAfter: number;
    actorType: CoreActorType;
    actorUserId: string;
  }[] = [
    {
      id: `${applicationId}-bid-1`,
      applicationId,
      eventId: input.eventId,
      userId: input.userId,
      seq: 1,
      source: BidSource.INITIAL_APPLY,
      previousAmount: null,
      newAmount: initialAmount,
      deltaAmount: initialAmount,
      bidAt: firstAppliedAt,
      depositRequiredAfter: requiredDeposit,
      actorType: CoreActorType.USER,
      actorUserId: input.userId,
    },
  ];

  if (applicant.firstAtMin !== undefined) {
    history.push({
      id: `${applicationId}-bid-2`,
      applicationId,
      eventId: input.eventId,
      userId: input.userId,
      seq: 2,
      source: BidSource.RAISE,
      previousAmount: initialAmount,
      newAmount: applicant.amount,
      deltaAmount: applicant.amount - initialAmount, // RAISE 는 delta > 0 이어야 한다
      bidAt: lastBidAt,
      depositRequiredAfter: requiredDeposit,
      actorType: CoreActorType.USER,
      actorUserId: input.userId,
    });
  }

  await prisma.bidHistory.createMany({ data: history, skipDuplicates: true });

  return {
    id: applicationId,
    userId: input.userId,
    amount: applicant.amount,
    lastBidAt,
    firstAppliedAt,
    status: applicant.status,
    depositStatus,
    depositPaid,
  };
}

// =============================================================================
// 8. 확정된 선정 라운드 (Selection / SelectionEntry / SelectionCutoff)
//
//   ★ 여기서 만드는 순위는 **데모 데이터**다. 진짜 순위는 RankingService 의 ROW_NUMBER() SQL 이
//     계산한다(IC-31). 아래 정렬은 그 SQL 이 만들어낼 결과와 같아지도록 D-04 의 세 키를
//     그대로 적용한 것이고, 이 파일 밖에서 순위를 TS 로 정렬하는 코드는 존재하면 안 된다.
//
//   SelectionEntry 의 동결 스냅샷은 write-once 이며 BEFORE UPDATE 트리거가 수정을 거부하므로
//   전부 createMany(skipDuplicates) 로만 쓴다 — 재실행해도 UPDATE 가 나가지 않는다.
// =============================================================================

async function seedFinalizedRound(
  eventId: string,
  applications: WrittenApplication[],
  displayNameByUserId: Map<string, string>,
  capacity: number,
  applyEndAt: Date,
): Promise<{ entries: number; selected: number }> {
  const selectionId = `seed-selection-${eventId.replace('seed-event-', '')}-r1`;

  // D-04: 금액 DESC → 그 금액 도달 시각 ASC → 신청 순서 ASC.
  const ranked = [...applications].sort(
    (a, b) =>
      b.amount - a.amount ||
      a.lastBidAt.getTime() - b.lastBidAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  await prisma.selection.upsert({
    where: { eventId_roundNo: { eventId, roundNo: 1 } },
    create: {
      id: selectionId,
      eventId,
      roundNo: 1,
      eventMode: EventMode.BID,
      status: SelectionRoundStatus.FINALIZED,
      capacitySnapshot: capacity,
      remainingSeats: capacity,
      effectiveDeadlineAt: applyEndAt,
      depositWindowMinutes: 0,
      // selection_basis_after_deadline_chk: rankingBasisAt >= effectiveDeadlineAt
      rankingBasisAt: new Date(applyEndAt.getTime() + 60_000),
      rankingComputedAt: new Date(applyEndAt.getTime() + 120_000),
      eligibleCount: ranked.length,
      excludedCount: 0,
      autoPreselectedCount: capacity,
      selectedCount: capacity,
      finalizedAt: new Date(applyEndAt.getTime() + 24 * 3_600_000),
      notifyDispatchedAt: new Date(applyEndAt.getTime() + 24 * 3_600_000),
      partnerMemo: '1라운드 확정. 상위 3명 선정.',
    },
    update: {},
    select: { id: true },
  });

  const entries = ranked.map((app, index) => {
    const rankNo = index + 1;
    const withinCapacity = rankNo <= capacity;

    return {
      id: `${selectionId}-e${rankNo}`,
      selectionId,
      eventId,
      applicationId: app.id,
      userId: app.userId,
      displayNameSnapshot: must(displayNameByUserId.get(app.userId), `표시이름 ${app.userId}`),
      amountSnapshot: app.amount,
      lastBidAtSnapshot: app.lastBidAt,
      appliedAtSnapshot: app.firstAppliedAt,
      rebidCountSnapshot: 0,
      depositStatusSnapshot: app.depositStatus,
      depositPaidSnapshot: app.depositPaid,
      rankNo,
      // selection_entry_exclusion_chk: (isEligible = true) = (exclusionReason IS NULL)
      isEligible: true,
      exclusionReason: null,
      tieGroupKey: tieGroupKeyOf(app.amount, app.lastBidAt),
      tieOrdinal: 1,
      // selection_entry_capacity_chk: 정원 안이면 반드시 적격
      withinCapacity,
      status: withinCapacity ? SelectionStatus.SELECTED : SelectionStatus.NOT_SELECTED,
      source: SelectionEntrySource.AUTO_RANK,
      amountAtSelection: withinCapacity ? app.amount : null,
      position: withinCapacity ? rankNo : null,
      preselectedAt: withinCapacity ? new Date(applyEndAt.getTime() + 120_000) : null,
      selectedAt: withinCapacity ? new Date(applyEndAt.getTime() + 24 * 3_600_000) : null,
      notifiedAt: new Date(applyEndAt.getTime() + 24 * 3_600_000),
    };
  });

  const created = await prisma.selectionEntry.createMany({ data: entries, skipDuplicates: true });

  // ★ 커트라인은 SelectionCutoff 에만 쓴다(IC-35 / D-07).
  //   Selection 의 스칼라였을 때는 `include: { selections: true }` 한 줄로 공개됐다.
  //   관계로 분리된 지금은 기본 경로로 절대 따라오지 않는다 — 그 구조를 되돌리면 안 된다.
  const boundary = entries[capacity - 1];
  if (boundary) {
    await prisma.selectionCutoff.upsert({
      where: { selectionId },
      create: {
        selectionId,
        cutoffAmount: boundary.amountSnapshot,
        cutoffLastBidAt: boundary.lastBidAtSnapshot,
        hasCutoffTie: false,
      },
      update: {},
    });
  }

  return { entries: created.count, selected: capacity };
}

// =============================================================================
// 9. 알림 / 쪽지 — 받은함이 비어 있으면 화면을 볼 수가 없다
// =============================================================================

async function seedInbox(
  userIdByKey: Map<string, string>,
  adminUserId: string,
  partnerUserId: string,
): Promise<{ notifications: number; messages: number }> {
  const u = (key: string) => must(userIdByKey.get(key), `데모 이용자 ${key}`);

  const notifications = [
    {
      id: 'seed-noti-1',
      userId: u('u1'),
      type: NotificationType.APPLICATION_RECEIVED,
      category: NotificationCategory.APPLICATION,
      priority: NotificationPriority.NORMAL,
      titleKo: '신청이 접수되었습니다',
      bodyKo: "'딥스테이블 강남점 셰프 테이블' 신청이 접수되었습니다.",
      deepLinkPath: `/my/applications/seed-app-instant-open-u1`,
      eventId: INSTANT_OPEN_ID,
      applicationId: 'seed-app-instant-open-u1',
      dedupeKey: 'APPLICATION_RECEIVED:seed-app-instant-open-u1',
    },
    {
      id: 'seed-noti-2',
      userId: u('u4'),
      type: NotificationType.DEPOSIT_REQUIRED,
      category: NotificationCategory.DEPOSIT,
      priority: NotificationPriority.HIGH,
      titleKo: '예약금을 입금해 주세요',
      bodyKo: '신청을 유효하게 하려면 5,000원을 10분 안에 입금해 주세요.',
      deepLinkPath: `/my/applications/seed-app-instant-open-u4`,
      eventId: INSTANT_OPEN_ID,
      applicationId: 'seed-app-instant-open-u4',
      dedupeKey: 'DEPOSIT_REQUIRED:seed-app-instant-open-u4-dep-1',
    },
    {
      id: 'seed-noti-3',
      userId: u('u5'),
      type: NotificationType.DEPOSIT_HOLD_EXPIRED,
      category: NotificationCategory.DEPOSIT,
      priority: NotificationPriority.HIGH,
      titleKo: '예약금 납부 시간이 지났습니다',
      bodyKo: '납부 시간 안에 예약금이 확인되지 않아 신청이 만료되었습니다.',
      deepLinkPath: `/events/${INSTANT_OPEN_ID}`,
      eventId: INSTANT_OPEN_ID,
      applicationId: 'seed-app-instant-open-u5',
      dedupeKey: 'DEPOSIT_HOLD_EXPIRED:seed-app-instant-open-u5-dep-1',
    },
    {
      id: 'seed-noti-4',
      userId: u('u2'),
      type: NotificationType.SELECTION_FINALIZED_SELECTED,
      category: NotificationCategory.RESULT,
      priority: NotificationPriority.HIGH,
      titleKo: '선정되셨습니다',
      // D-07 / IC-44: 문구에 타인의 금액도, 커트라인도, 본인 순위도 없다.
      bodyKo: "'딥스로스터리 성수점 프라이빗 커핑' 최종 명단에 선정되셨습니다.",
      deepLinkPath: `/my/applications/seed-app-bid-finalized-u2`,
      eventId: BID_FINALIZED_ID,
      applicationId: 'seed-app-bid-finalized-u2',
      dedupeKey: 'SELECTION_FINALIZED_SELECTED:seed-app-bid-finalized-u2',
    },
    {
      id: 'seed-noti-5',
      userId: u('u7'),
      type: NotificationType.SELECTION_FINALIZED_NOT_SELECTED,
      category: NotificationCategory.RESULT,
      priority: NotificationPriority.NORMAL,
      titleKo: '이번에는 선정되지 않았습니다',
      bodyKo: '아쉽게도 이번 회차에는 선정되지 않았습니다. 예약금은 전액 환불됩니다.',
      deepLinkPath: `/my/applications/seed-app-bid-finalized-u7`,
      eventId: BID_FINALIZED_ID,
      applicationId: 'seed-app-bid-finalized-u7',
      dedupeKey: 'SELECTION_FINALIZED_NOT_SELECTED:seed-app-bid-finalized-u7',
    },
    {
      id: 'seed-noti-6',
      userId: u('u3'),
      type: NotificationType.ADMIN_ANNOUNCEMENT,
      category: NotificationCategory.ANNOUNCEMENT,
      priority: NotificationPriority.LOW,
      titleKo: '딥스 베타 오픈 안내',
      bodyKo: '딥스 베타에 오신 것을 환영합니다. 이용 중 불편한 점은 언제든 알려 주세요.',
      deepLinkPath: '/',
      eventId: null,
      applicationId: null,
      dedupeKey: 'ADMIN_ANNOUNCEMENT:beta-open',
    },
  ];

  const notiResult = await prisma.notification.createMany({
    data: notifications,
    skipDuplicates: true,
  });

  const messages = [
    {
      id: 'seed-msg-1',
      kind: MessageKind.ADMIN_DIRECT,
      senderUserId: adminUserId,
      senderDisplayName: '운영자',
      recipientUserId: u('u1'),
      titleKo: '프로필 정보를 확인해 주세요',
      bodyKo: '휴대폰 인증이 완료되어 모든 이벤트에 신청하실 수 있습니다.',
    },
    {
      id: 'seed-msg-2',
      kind: MessageKind.PARTNER_EVENT,
      senderUserId: partnerUserId,
      senderDisplayName: '딥스컴퍼니',
      recipientUserId: u('u2'),
      eventId: BID_OPEN_ID,
      titleKo: '이용 안내드립니다',
      bodyKo: '입장은 예약 시간 10분 전부터 가능합니다. 주차는 건물 지하 1층을 이용해 주세요.',
    },
    {
      id: 'seed-msg-3',
      kind: MessageKind.PARTNER_EVENT,
      senderUserId: partnerUserId,
      senderDisplayName: '딥스컴퍼니',
      recipientUserId: u('u3'),
      eventId: BID_OPEN_ID,
      titleKo: '이용 안내드립니다',
      bodyKo: '입장은 예약 시간 10분 전부터 가능합니다. 주차는 건물 지하 1층을 이용해 주세요.',
    },
  ];

  const msgResult = await prisma.message.createMany({ data: messages, skipDuplicates: true });

  return { notifications: notiResult.count, messages: msgResult.count };
}

// =============================================================================
// main
// =============================================================================

async function main(): Promise<void> {
  const adminUserId = await seedAdmin();
  const settingCount = await seedSettings();
  const categoryIdByCode = await seedCategories();
  const regionIdByCode = await seedRegions();
  const partner = await seedPartner(categoryIdByCode);
  const userIdByKey = await seedUsers();

  const displayNameByUserId = new Map<string, string>();
  for (const p of PRIMARY_USERS) {
    displayNameByUserId.set(must(userIdByKey.get(p.key), p.key), p.name);
  }
  for (let i = 1; i <= FILLER_COUNT; i += 1) {
    displayNameByUserId.set(must(userIdByKey.get(`f${i}`), `f${i}`), `데모참가자${i}`);
  }

  const gangnam = must(partner.venueIds[0], '강남 매장');
  const seongsu = must(partner.venueIds[1], '성수 매장');
  const catFine = must(categoryIdByCode.get('fine-dining'), '파인다이닝');
  const catCafe = must(categoryIdByCode.get('cafe-dessert'), '카페·디저트');
  const catClass = must(categoryIdByCode.get('class-oneday'), '클래스·원데이');
  const regionGangnam = must(regionIdByCode.get('1168000000'), '강남구');
  const regionSeongdong = must(regionIdByCode.get('1120000000'), '성동구');

  const u = (key: string) => must(userIdByKey.get(key), `데모 이용자 ${key}`);

  // ── 이벤트 정의 ───────────────────────────────────────────────────────
  const instantCounts = countOf(INSTANT_APPLICANTS);
  const instantOpen: SeedEventInput = {
    id: INSTANT_OPEN_ID,
    slug: 'gangnam-chef-table-instant',
    title: '딥스테이블 강남점 셰프 테이블 (선착순)',
    description:
      '매주 목요일 저녁, 셰프가 직접 서빙하는 5석 한정 테이블입니다. 신청 즉시 자리가 확정됩니다.',
    venueId: gangnam,
    partnerId: partner.partnerProfileId,
    categoryId: catFine,
    regionId: regionGangnam,
    sigunguCode: '11680',
    mode: EventMode.INSTANT,
    status: EventStatus.OPEN,
    capacity: 5,
    fixedAmount: INSTANT_FIXED_AMOUNT,
    applyStartAt: day(-2),
    applyEndAt: day(5),
    serviceStartAt: day(14),
    tags: ['선착순', '셰프테이블', '강남'],
    deposit: { type: 'FIXED', amount: INSTANT_DEPOSIT },
    counts: instantCounts,
    // CONFIRMED 3 + PENDING_DEPOSIT 1 = 4. EXPIRED 는 자리를 반환했으므로 세지 않는다(IC-15).
    claimedCount: 4,
  };

  const bidOpenCounts = countOf(BID_OPEN_APPLICANTS);
  const bidOpen: SeedEventInput = {
    id: BID_OPEN_ID,
    slug: 'gangnam-omakase-bid',
    title: '딥스테이블 강남점 오마카세 10석 (금액 제안)',
    description:
      '원하는 금액을 제안해 주세요. 마감 후 상위 10명을 파트너가 확정합니다. 기간 중에는 경쟁률만 공개됩니다.',
    venueId: gangnam,
    partnerId: partner.partnerProfileId,
    categoryId: catFine,
    regionId: regionGangnam,
    sigunguCode: '11680',
    mode: EventMode.BID,
    status: EventStatus.OPEN,
    capacity: 10,
    minAmount: 50_000,
    maxAmount: 300_000,
    amountStep: 1_000,
    applyStartAt: day(-1),
    applyEndAt: day(3),
    serviceStartAt: day(20),
    tags: ['입찰', '오마카세', '강남'],
    deposit: { type: 'PERCENT', bp: BID_OPEN_PERCENT_BP },
    softClose: true,
    counts: bidOpenCounts,
  };

  const bidClosedCounts = countOf(BID_CLOSED_APPLICANTS);
  const bidClosed: SeedEventInput = {
    id: BID_CLOSED_ID,
    slug: 'seongsu-cupping-closed',
    title: '딥스로스터리 성수점 커피 클래스 6석 (마감)',
    description: '신청이 마감되었습니다. 파트너가 최종 명단을 확정하는 단계입니다.',
    venueId: seongsu,
    partnerId: partner.partnerProfileId,
    categoryId: catClass,
    regionId: regionSeongdong,
    sigunguCode: '11200',
    mode: EventMode.BID,
    status: EventStatus.CLOSED,
    capacity: 6,
    minAmount: 40_000,
    maxAmount: 200_000,
    amountStep: 1_000,
    applyStartAt: day(-10),
    applyEndAt: day(-2),
    serviceStartAt: day(6),
    tags: ['입찰', '원데이클래스', '성수'],
    deposit: { type: 'PERCENT', bp: 1_000 },
    counts: bidClosedCounts,
  };

  const bidFinalizedCounts = countOf(BID_FINALIZED_APPLICANTS);
  const bidFinalized: SeedEventInput = {
    id: BID_FINALIZED_ID,
    slug: 'seongsu-private-cupping-finalized',
    title: '딥스로스터리 성수점 프라이빗 커핑 3석 (확정)',
    description: '선정이 완료된 회차입니다. 당첨/미당첨 화면을 확인할 수 있습니다.',
    venueId: seongsu,
    partnerId: partner.partnerProfileId,
    categoryId: catCafe,
    regionId: regionSeongdong,
    sigunguCode: '11200',
    mode: EventMode.BID,
    status: EventStatus.FINALIZED,
    capacity: BID_FINALIZED_CAPACITY,
    minAmount: 30_000,
    maxAmount: 150_000,
    amountStep: 1_000,
    applyStartAt: day(-30),
    applyEndAt: day(-20),
    serviceStartAt: day(-5),
    tags: ['입찰', '커핑', '성수'],
    // 예약금 없음 — 확정 묶음은 재실행이 없으므로 조합을 최대한 단순하게 유지한다.
    counts: bidFinalizedCounts,
  };

  const draftEvent: SeedEventInput = {
    id: 'seed-event-instant-draft',
    slug: 'gangnam-weekend-brunch-draft',
    title: '딥스테이블 강남점 주말 브런치 (작성 중)',
    description: '아직 공개하지 않은 초안입니다. 파트너 콘솔에서만 보입니다.',
    venueId: gangnam,
    partnerId: partner.partnerProfileId,
    categoryId: catFine,
    regionId: regionGangnam,
    sigunguCode: '11680',
    mode: EventMode.INSTANT,
    status: EventStatus.DRAFT,
    capacity: 8,
    fixedAmount: 45_000,
    applyStartAt: day(7),
    applyEndAt: day(14),
    serviceStartAt: day(21),
    tags: ['브런치'],
    counts: { live: 0, total: 0, expired: 0 },
  };

  const scheduledEvent: SeedEventInput = {
    id: 'seed-event-bid-scheduled',
    slug: 'seongsu-roastery-night-scheduled',
    title: '딥스로스터리 성수점 나이트 커핑 (오픈 예정)',
    description: '공개 예약되었습니다. 신청 시작 시각이 되면 자동으로 열립니다.',
    venueId: seongsu,
    partnerId: partner.partnerProfileId,
    categoryId: catCafe,
    regionId: regionSeongdong,
    sigunguCode: '11200',
    mode: EventMode.BID,
    status: EventStatus.SCHEDULED,
    capacity: 12,
    minAmount: 80_000,
    maxAmount: 400_000,
    amountStep: 1_000,
    applyStartAt: day(2),
    applyEndAt: day(9),
    serviceStartAt: day(16),
    tags: ['입찰', '커핑', '오픈예정'],
    deposit: { type: 'PERCENT', bp: 1_000 },
    counts: { live: 0, total: 0, expired: 0 },
  };

  const allEvents = [instantOpen, bidOpen, bidClosed, bidFinalized, draftEvent, scheduledEvent];

  for (const e of allEvents) {
    const data = eventData(e);
    // 확정된 회차는 다시 쓰지 않는다 — SelectionEntry 스냅샷과 시각이 어긋나면 안 된다(IC-34).
    const isFrozen = e.status === EventStatus.FINALIZED;

    await prisma.event.upsert({
      where: { id: e.id },
      create: { id: e.id, ...data },
      update: isFrozen ? {} : data,
      select: { id: true },
    });
  }

  // ── 신청 ─────────────────────────────────────────────────────────────
  const writeAll = async (
    eventId: string,
    mode: EventMode,
    applicants: ApplicantSeed[],
    depositOf: (amount: number) => number,
    writeOnce: boolean,
  ): Promise<WrittenApplication[]> => {
    const written: WrittenApplication[] = [];
    for (const applicant of applicants) {
      written.push(
        await writeApplication({
          eventId,
          eventMode: mode,
          applicant,
          userId: u(applicant.key),
          requiredDeposit: depositOf(applicant.amount),
          writeOnce,
        }),
      );
    }
    return written;
  };

  await writeAll(INSTANT_OPEN_ID, EventMode.INSTANT, INSTANT_APPLICANTS, () => INSTANT_DEPOSIT, false);
  await writeAll(BID_OPEN_ID, EventMode.BID, BID_OPEN_APPLICANTS, (a) => percentDeposit(a, BID_OPEN_PERCENT_BP), false);
  await writeAll(BID_CLOSED_ID, EventMode.BID, BID_CLOSED_APPLICANTS, (a) => percentDeposit(a, 1_000), false);
  const finalizedApps = await writeAll(BID_FINALIZED_ID, EventMode.BID, BID_FINALIZED_APPLICANTS, () => 0, true);

  const round = await seedFinalizedRound(
    BID_FINALIZED_ID,
    finalizedApps,
    displayNameByUserId,
    BID_FINALIZED_CAPACITY,
    day(-20),
  );

  // ── 매장 카운터 대사 ─────────────────────────────────────────────────
  await prisma.venue.update({
    where: { id: gangnam },
    data: { openEventCount: 2, lastEventEndsAt: day(5) },
  });
  await prisma.venue.update({
    where: { id: seongsu },
    data: { openEventCount: 0, lastEventEndsAt: day(9) },
  });

  const inbox = await seedInbox(userIdByKey, adminUserId, partner.partnerUserId);

  // ── 요약 ─────────────────────────────────────────────────────────────
  const line = '─'.repeat(72);
  console.log(`\n${line}`);
  console.log('Dibs 시드 완료');
  console.log(line);
  console.log(`설정(피처 플래그)      ${settingCount}건`);
  console.log(`업종(Category)         ${CATEGORIES.length}건`);
  console.log(`행정구역(Region)       ${REGIONS.length}건 (시군구 행에 sigunguCode 채움 — IC-52)`);
  console.log(`파트너                 1명 (사업자 1, 매장 ${VENUES.length}, 이미지 ${VENUES.length * 2} — 전부 자리표시자 URL)`);
  console.log(`이용자                 ${PRIMARY_USERS.length}명(데모 로그인) + ${FILLER_COUNT}명(군중용 보조 계정)`);
  console.log(`이벤트                 ${allEvents.length}건`);
  console.log(`  · INSTANT / OPEN      정원 5, 확정 3 · 예약금대기 1 · 만료 1 (claimedCount=4)`);
  console.log(`  · BID / OPEN          정원 10, 신청 ${BID_OPEN_APPLICANTS.length} (150,000원 동점 2명 — lastBidAt 로 갈린다)`);
  console.log(`  · BID / CLOSED        정원 6, 신청 ${BID_CLOSED_APPLICANTS.length} — 확정 시각 경과, 라운드 개시 가능`);
  console.log(`  · BID / FINALIZED     정원 3, 신청 ${BID_FINALIZED_APPLICANTS.length} — 선정 ${round.selected}명 / 엔트리 ${round.entries}건 신규`);
  console.log(`  · INSTANT / DRAFT     파트너 콘솔에서만 보이는 초안`);
  console.log(`  · BID / SCHEDULED     오픈 예정`);
  console.log(`알림 ${inbox.notifications}건 신규 · 쪽지 ${inbox.messages}건 신규`);
  console.log(line);
  console.log('데모 로그인 계정');
  console.log(`  운영자   ${ADMIN_EMAIL}`);
  console.log(`  파트너   ${PARTNER_EMAIL}`);
  console.log(`  이용자   ${PRIMARY_USERS.map((p) => `${p.key}@dibs.demo`).join(', ')}`);
  console.log(`  (보조)   f1@dibs.demo ~ f${FILLER_COUNT}@dibs.demo`);
  console.log(line);

  if (!ADMIN_LINKED) {
    console.log('⚠ 운영자 googleSub 이 자리표시자입니다. 이 상태로 구글 로그인하면 실패합니다.');
    console.log('  구글 sub 를 알고 있다면:');
    console.log(`    ADMIN_SEED_EMAIL="${ADMIN_EMAIL}" ADMIN_SEED_GOOGLE_SUB="<구글 sub>" pnpm db:seed`);
    console.log('  이미 시드를 돌렸다면 한 줄 SQL 로 붙이세요:');
    console.log(`    UPDATE "User" SET "googleSub" = '<구글 sub>' WHERE email = '${ADMIN_EMAIL}';`);
    console.log(line);
  }

  console.log('로그인은 구글 OAuth 만 지원합니다(D-09). 위 이메일은 DB 안의 데모 행이지');
  console.log('실제 구글 계정이 아니므로, 화면 확인용으로는 각 계정의 googleSub 을 본인 것으로');
  console.log('바꾸거나 개발용 토큰 발급 경로를 쓰세요.');
  console.log(`${line}\n`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('시드 실패:', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
