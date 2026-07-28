/**
 * 최소 시드 — 계정 3개 + 마스터 데이터만.
 *
 * `seed.ts` 는 화면을 눌러 보려고 이벤트·신청·알림까지 잔뜩 만든다. 그건 처음 구경할 때는
 * 좋지만, 실제로 쓸 데이터를 넣기 시작하면 데모 행이 섞여 무엇이 진짜인지 알 수 없게 된다.
 * 이 스크립트는 **깨끗한 출발점**을 만든다.
 *
 *   운영자  1명   admin@dibs.local
 *   파트너  1명   partner@dibs.local  (승인 완료 — 바로 시설·이벤트를 만들 수 있다)
 *   이용자  1명   user@dibs.local     (휴대폰 인증 완료 — 신청이 가능하다)
 *
 * 업종(Category)과 행정구역(Region)은 남긴다. 마스터 데이터라 없으면 시설 등록 폼의
 * 드롭다운이 비고, 검색 필터도 동작하지 않는다. 피처 플래그(Setting)도 같은 이유로 남긴다.
 *
 * 사용법:
 *   기존 데이터를 지우고 넣기   pnpm --filter @dibs/api db:seed:minimal
 *   VS Code                    Tasks → "DB 비우고 최소 계정만 넣기"
 *
 * ★ 데이터 삭제는 TRUNCATE 로 한다. AuditLog 에는 DELETE 를 막는 append-only 트리거가
 *   걸려 있어서(001_constraints.sql §12) DELETE 로는 지울 수 없다. TRUNCATE 는 행 트리거를
 *   타지 않으므로 통과한다. 마이그레이션을 되돌리지 않으니 제약·인덱스·트리거는 그대로 남는다.
 */
import { AccountStatus, PartnerApprovalStatus, PrismaClient, RegionLevel, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const NOW = new Date();

/** 빈 문자열도 미설정으로 본다. `??` 는 `KEY=""` 를 통과시킨다. */
const envOr = (key: string, fallback: string): string => {
  const raw = process.env[key];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
};

const ADMIN_EMAIL = envOr('ADMIN_SEED_EMAIL', 'admin@dibs.local');
const ADMIN_GOOGLE_SUB = envOr('ADMIN_SEED_GOOGLE_SUB', 'seed-admin-placeholder');
const PARTNER_EMAIL = envOr('PARTNER_SEED_EMAIL', 'partner@dibs.local');
const USER_EMAIL = envOr('USER_SEED_EMAIL', 'user@dibs.local');

// =============================================================================
// 1. 비우기
// =============================================================================

/**
 * 트랜잭션 데이터를 전부 비운다. 마스터 데이터(Category/Region/Setting)는 남긴다.
 *
 * TRUNCATE ... CASCADE 를 한 문장에 몰아 쓴다. 테이블을 하나씩 지우면 외래키 순서를
 * 사람이 관리해야 하고, 순서가 틀리면 중간에서 실패해 절반만 지워진 상태가 남는다.
 * RESTART IDENTITY 는 Application.applySeq 같은 시퀀스를 1 로 되돌린다.
 */
async function wipe(): Promise<void> {
  const tables = [
    // 코어 도메인
    'SelectionEntry', 'SelectionCutoff', 'Selection',
    'Deposit', 'BidHistory', 'Application',
    'EventImage', 'Event',
    'VenueImage', 'Venue', 'Business',
    // 알림 / 운영
    'EmailDelivery', 'Message', 'Notification', 'Broadcast',
    'EmailSuppression', 'NotificationPreference', 'UserNotificationSetting',
    'AuditLog', 'Settlement', 'PlatformFee',
    'IdempotencyRecord', 'PartnerBlockedUser', 'UserIdentityLink', 'UserCategoryInterest',
    // 계정
    'PartnerProfile', 'User',
  ];

  const list = tables.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  console.log(`  비움   ${tables.length}개 테이블 (Category·Region·Setting 은 유지)`);
}

// =============================================================================
// 2. 마스터 데이터 — 없으면 폼과 검색이 동작하지 않는다
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

const SETTINGS = [
  {
    key: 'DEPOSIT_HOLD_ENABLED',
    value: false,
    description: '예약금 홀드. 켜면 신청 후 정해진 시간 안에 예약금을 내야 확정된다. 실결제는 미구현.',
  },
  {
    key: 'SETTLEMENT_ENABLED',
    value: false,
    description: '정산 집계. 집행은 범위 밖이라 표만 채운다.',
  },
  {
    key: 'EVENT_ADVANCED_VISIBILITY_ENABLED',
    value: false,
    description: '커트라인·내 순위 공개 토글을 파트너에게 열어 줄지. 기본은 경쟁률만 공개(D-07).',
  },
] as const;

async function seedMaster(): Promise<void> {
  for (const [index, c] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { id: `seed-cat-${c.code}` },
      create: {
        id: `seed-cat-${c.code}`,
        code: c.code,
        nameKo: c.nameKo,
        nameEn: c.nameEn,
        iconKey: c.iconKey,
        sortOrder: index,
        isActive: true,
      },
      update: { nameKo: c.nameKo, isActive: true },
    });
  }

  // 시도를 먼저 만들어야 시군구의 parentCode 가 걸린다(자기참조 FK).
  const ordered = [...REGIONS].sort((a, b) => (a.parentCode === null ? -1 : 1) - (b.parentCode === null ? -1 : 1));

  for (const r of ordered) {
    await prisma.region.upsert({
      where: { code: r.code },
      create: {
        code: r.code,
        level: r.level,
        sido: r.sido,
        sigungu: r.sigungu,
        sigunguCode: r.sigunguCode,
        parentCode: r.parentCode,
        displayName: r.displayName,
        isActive: true,
      },
      update: { displayName: r.displayName, sigunguCode: r.sigunguCode, isActive: true },
    });
  }

  for (const s of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, valueJson: s.value as never, description: s.description },
      update: { description: s.description },
    });
  }

  console.log(`  마스터 업종 ${CATEGORIES.length} · 지역 ${REGIONS.length} · 설정 ${SETTINGS.length}`);
}

// =============================================================================
// 3. 계정 3개
// =============================================================================

/** 모든 계정에 공통으로 필요한 약관 동의. 없으면 일부 화면이 동의 유도로 막는다. */
const consent = {
  serviceTermsVersion: '1.0',
  serviceTermsAgreedAt: NOW,
  privacyTermsVersion: '1.0',
  privacyTermsAgreedAt: NOW,
  age14ConfirmedAt: NOW,
};

async function seedAccounts(): Promise<void> {
  // ─── 운영자 ───────────────────────────────────────────────────────────
  // 셀프가입이 불가능하므로(D-09) 이 경로가 운영자를 만드는 유일한 방법이다.
  await prisma.user.create({
    data: {
      id: 'seed-user-admin',
      googleSub: ADMIN_GOOGLE_SUB,
      email: ADMIN_EMAIL,
      emailVerifiedAt: NOW,
      displayName: '운영자',
      realName: 'Dibs 운영자',
      roles: [UserRole.USER, UserRole.ADMIN],
      status: AccountStatus.ACTIVE,
      notificationEmail: ADMIN_EMAIL,
      ...consent,
    },
  });

  // ─── 파트너 ───────────────────────────────────────────────────────────
  // 승인 완료 상태로 만든다. 승인 흐름을 직접 테스트하고 싶으면 운영자 콘솔에서
  // 정지시켰다가 다시 승인하거나, 새 계정으로 파트너 신청서를 내면 된다.
  await prisma.user.create({
    data: {
      id: 'seed-user-partner',
      googleSub: 'seed-google-partner',
      email: PARTNER_EMAIL,
      emailVerifiedAt: NOW,
      displayName: '파트너',
      realName: '파트너 담당자',
      phone: '010-0000-0001',
      phoneVerifiedAt: NOW,
      roles: [UserRole.USER, UserRole.PARTNER],
      status: AccountStatus.ACTIVE,
      notificationEmail: PARTNER_EMAIL,
      ...consent,
      partnerProfile: {
        create: {
          id: 'seed-partner-profile',
          contactName: '파트너 담당자',
          contactEmail: PARTNER_EMAIL,
          contactPhone: '010-0000-0001',
          approvalStatus: PartnerApprovalStatus.APPROVED,
          submittedAt: NOW,
          approvedAt: NOW,
          partnerTermsVersion: '1.0',
          partnerTermsAgreedAt: NOW,
        },
      },
    },
  });

  // ─── 이용자 ───────────────────────────────────────────────────────────
  // ★ phoneVerifiedAt 이 필수다. 신청 생성이 "휴대폰 인증된 계정"만 허용하도록
  //   SQL 제약으로 걸려 있어서(IC-18), 비워 두면 신청이 전부 막힌다.
  await prisma.user.create({
    data: {
      id: 'seed-user-u1',
      googleSub: 'seed-google-u1',
      email: USER_EMAIL,
      emailVerifiedAt: NOW,
      displayName: '이용자',
      phone: '010-0000-0002',
      phoneVerifiedAt: NOW,
      roles: [UserRole.USER],
      status: AccountStatus.ACTIVE,
      notificationEmail: USER_EMAIL,
      preferredRegionCode: '1168000000',
      ...consent,
    },
  });

  console.log('  계정   운영자 1 · 파트너 1(승인 완료) · 이용자 1(휴대폰 인증 완료)');
}

// =============================================================================

async function main(): Promise<void> {
  console.log('최소 시드 — 기존 데이터를 지우고 계정 3개만 남깁니다\n');

  await wipe();
  await seedMaster();
  await seedAccounts();

  const line = '─'.repeat(66);
  console.log(`\n${line}`);
  console.log('완료. 로그인 계정');
  console.log(`  운영자   ${ADMIN_EMAIL}`);
  console.log(`  파트너   ${PARTNER_EMAIL}   (승인 완료 — 바로 시설·이벤트 등록 가능)`);
  console.log(`  이용자   ${USER_EMAIL}      (휴대폰 인증 완료 — 신청 가능)`);
  console.log(line);
  console.log('로그인:  node .vscode/scripts/dev-token.mjs <이메일>');
  console.log('         또는 VS Code → Tasks → "개발용 토큰 발급"');

  if (ADMIN_GOOGLE_SUB === 'seed-admin-placeholder') {
    console.log(`\n※ 구글 로그인을 쓰려면 운영자의 googleSub 을 실제 값으로 바꿔야 합니다.`);
    console.log(`   ADMIN_SEED_EMAIL="본인@gmail.com" ADMIN_SEED_GOOGLE_SUB="<구글 sub>" 로 다시 실행하거나,`);
    console.log(`   UPDATE "User" SET "googleSub" = '<구글 sub>' WHERE email = '${ADMIN_EMAIL}';`);
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n최소 시드 실패:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
