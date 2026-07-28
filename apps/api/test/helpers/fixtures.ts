/**
 * 통합 테스트 픽스처.
 *
 * ─── 왜 Nest e2e 하네스가 아니라 서비스 레이어를 직접 부르는가 ─────────────
 *
 * 여기 있는 테스트가 검증하려는 것은 **HTTP 계약이 아니라 트랜잭션 경계와 SQL 술어**다:
 * IC-15 의 단일 원자적 조건부 UPDATE, IC-31 의 ROW_NUMBER() 순위, IC-23 의 쌍 롤백,
 * IC-03 의 같은 트랜잭션 안 멱등 레코드. 전부 서비스 안쪽에서 결정되고, 컨트롤러는
 * 그 앞에 가드/DTO 검증을 얹을 뿐이다.
 *
 * Nest 테스팅 모듈을 띄우면 얻는 것(라우팅·파이프·가드)보다 잃는 것이 크다 —
 * 8개를 동시에 쏘는 테스트에서 supertest 를 끼우면 실패했을 때 "경합이 깨진 것"인지
 * "HTTP 계층이 느린 것"인지 구분할 수 없다. 그래서 서비스를 실제 PrismaClient 로 직접 조립한다.
 * 서비스들은 전부 생성자 주입만 쓰므로 `new` 로 조립된다 — DI 컨테이너가 필요 없다.
 *
 * 반대로 공개 응답의 D-07 검증(visibility)은 매퍼가 순수 함수라 그것만 직접 부른다.
 */
import { randomBytes } from 'node:crypto';
import {
  AccountStatus,
  ApplicationStatus,
  BusinessType,
  BusinessVerificationStatus,
  DepositReason,
  DepositStatus,
  DepositType,
  EventMode,
  EventStatus,
  PartnerApprovalStatus,
  type PrismaClient,
  RegionLevel,
  UserRole,
  VenueStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

/**
 * PrismaService 는 PrismaClient 를 상속하고 생성자에서 전역 싱글턴을 돌려주는 것 말고는
 * 아무 것도 하지 않는다. 테스트는 자기 커넥션 풀을 가진 클라이언트를 쓰고 싶으므로 타입만 맞춘다.
 */
export function asPrismaService(prisma: PrismaClient): PrismaService {
  return prisma as unknown as PrismaService;
}

/**
 * DEPOSIT_HOLD_ENABLED=false 인 ConfigService. (D-05 — 실제 결제 집행은 범위 밖)
 * true 로 켜면 ApplicationDepositsService.confirm 이 501 을 던지도록 되어 있다.
 */
export function testConfig(overrides: Record<string, unknown> = {}): ConfigService {
  return new ConfigService({ DEPOSIT_HOLD_ENABLED: false, ...overrides });
}

/** 실행마다 다른 8자 태그. 모든 픽스처 id·자연키에 섞어 다른 실행과 충돌하지 않게 한다. */
export function newTag(): string {
  return randomBytes(4).toString('hex');
}

export const minutes = (n: number): Date => new Date(Date.now() + n * 60_000);
export const days = (n: number): Date => minutes(n * 1_440);

/**
 * 마이크로초까지 지정한 timestamptz 리터럴.
 *
 * JS Date 는 밀리초까지밖에 못 담는다(IC-04). 그런데 D-04 의 2순위 키인 `lastBidAt` 은
 * `Timestamptz(6)` 이라, **밀리초는 같고 마이크로초만 다른 두 입찰**이 실제로 존재한다.
 * 그 경우를 재현하려면 값을 SQL 문자열로 직접 넣는 수밖에 없다.
 *
 * @param micros 6자리 문자열. 예: '100456'
 */
export function microStamp(base: Date, micros: string): string {
  return `${base.toISOString().slice(0, 19)}.${micros}+00`;
}

export interface TestWorld {
  prisma: PrismaClient;
  tag: string;
  regionCode: string;
  categoryId: string;
  partnerUserId: string;
  partnerProfileId: string;
  businessId: string;
  venueId: string;
  /** 정리 대상. 만든 순서대로 쌓는다. */
  eventIds: string[];
  userIds: string[];
}

/**
 * 파트너 1명 + 매장 1개까지 갖춘 최소 세계.
 *
 * Region 을 매번 새로 만드는 이유: Venue.regionCode 에는 `trg_venue_region_level_guard` 가 걸려
 * 반드시 **SIGUNGU 레벨** Region 을 가리켜야 하고, 시드가 만든 실제 행정구역을 테스트가
 * 지우면 안 되기 때문이다. code 는 실제 법정동코드와 겹치지 않게 9로 시작시킨다.
 */
export async function createWorld(prisma: PrismaClient): Promise<TestWorld> {
  const tag = newTag();

  const regionCode = `9${randomDigits(9)}`;
  await prisma.region.create({
    data: {
      id: `it-region-${tag}`,
      code: regionCode,
      level: RegionLevel.SIGUNGU,
      sido: '테스트시',
      sigungu: '테스트구',
      // IC-52: Event.sigunguCode 는 이 값을 복사하는 것 말고 채워지는 경로가 없다.
      sigunguCode: randomDigits(5),
      displayName: `테스트시 테스트구 ${tag}`,
    },
  });

  const categoryId = `it-cat-${tag}`;
  await prisma.category.create({
    data: { id: categoryId, code: `it-${tag}`, nameKo: '테스트업종' },
  });

  const partnerUserId = `it-partner-${tag}`;
  await prisma.user.create({
    data: {
      id: partnerUserId,
      googleSub: `it-google-partner-${tag}`,
      email: `partner-${tag}@dibs.test`,
      displayName: '테스트파트너',
      roles: [UserRole.USER, UserRole.PARTNER],
      status: AccountStatus.ACTIVE,
    },
  });

  const partnerProfileId = `it-profile-${tag}`;
  await prisma.partnerProfile.create({
    data: {
      id: partnerProfileId,
      userId: partnerUserId,
      contactName: '테스트파트너',
      contactEmail: `partner-${tag}@dibs.test`,
      approvalStatus: PartnerApprovalStatus.APPROVED,
      approvedAt: new Date(),
    },
  });

  const businessId = `it-biz-${tag}`;
  await prisma.business.create({
    data: {
      id: businessId,
      partnerProfileId,
      name: '테스트사업자',
      legalName: '주식회사 테스트사업자',
      // business_brn_uq 는 (deletedAt IS NULL AND status <> 'REJECTED') 부분 유니크다.
      businessRegistrationNumber: randomDigits(10),
      businessType: BusinessType.CORPORATION,
      representativeName: '테스트',
      verificationStatus: BusinessVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      contactEmail: `biz-${tag}@dibs.test`,
      contactPhone: '02-000-0000',
    },
  });

  const venueId = `it-venue-${tag}`;
  await prisma.venue.create({
    data: {
      id: venueId,
      businessId,
      name: `테스트매장 ${tag}`,
      slug: `it-venue-${tag}`,
      status: VenueStatus.ACTIVE,
      primaryCategoryId: categoryId,
      regionCode,
      sido: '테스트시',
      sigungu: '테스트구',
      postalCode: '00000',
      roadAddress: '테스트로 1',
      phone: '02-000-0000',
      publishedAt: new Date(),
    },
  });

  return {
    prisma,
    tag,
    regionCode,
    categoryId,
    partnerUserId,
    partnerProfileId,
    businessId,
    venueId,
    eventIds: [],
    userIds: [],
  };
}

/**
 * 신청 가능한 이용자 N명.
 *
 * `phoneVerifiedAt` 이 반드시 채워져 있다 — 신청 INSERT 가 **같은 문장 안에서** 그 컬럼을
 * 확인하기 때문에(IC-18), 비어 있으면 모든 신청이 PHONE_VERIFICATION_REQUIRED(403) 로 끝난다.
 * 번호가 전부 다른 것도 필수다: `user_phone_uq` 가 인증된 번호에만 걸리는 부분 유니크다.
 */
export async function createUsers(world: TestWorld, count: number): Promise<AuthenticatedUser[]> {
  const users: AuthenticatedUser[] = [];

  for (let i = 0; i < count; i += 1) {
    const id = `it-u-${world.tag}-${i}`;
    const email = `u${i}-${world.tag}@dibs.test`;

    await world.prisma.user.create({
      data: {
        id,
        googleSub: `it-google-${world.tag}-${i}`,
        email,
        displayName: `테스터${i}`,
        phone: `${world.tag}-${String(i).padStart(3, '0')}`,
        phoneVerifiedAt: new Date(),
        roles: [UserRole.USER],
        status: AccountStatus.ACTIVE,
        notificationEmail: email,
      },
    });

    world.userIds.push(id);
    users.push({
      id,
      email,
      displayName: `테스터${i}`,
      roles: [UserRole.USER],
      partnerApproved: false,
      partnerProfileId: null,
    });
  }

  return users;
}

/**
 * 통합 테스트 전용 운영자 계정. **정리 단계에서 지우지 않는다.**
 *
 * 이유는 하나다: `AuditLog` 는 append-only 이고 BEFORE UPDATE/DELETE 트리거가 둘 다 막는다.
 * `AuditLog.actorUserId` 의 FK 는 `ON DELETE SET NULL` 이라 계정을 지우려는 순간 Postgres 가
 * AuditLog 를 UPDATE 하려 들고, 그 UPDATE 가 트리거에 막혀 **삭제 자체가 실패한다**.
 * (운영에서는 문제가 안 된다 — 계정은 하드 삭제가 아니라 익명화된다.)
 * 그래서 감사 행을 남기는 액터는 실행마다 새로 만들지 않고 고정 계정 하나를 재사용한다.
 */
export async function ensureIntegrationAdmin(prisma: PrismaClient): Promise<AuthenticatedUser> {
  const email = 'integration-admin@dibs.test';

  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      id: 'it-admin',
      googleSub: 'it-google-admin',
      email,
      displayName: '통합테스트운영자',
      roles: [UserRole.USER, UserRole.ADMIN],
      status: AccountStatus.ACTIVE,
    },
    update: { roles: [UserRole.USER, UserRole.ADMIN], status: AccountStatus.ACTIVE },
    select: { id: true },
  });

  return {
    id: admin.id,
    email,
    displayName: '통합테스트운영자',
    roles: [UserRole.USER, UserRole.ADMIN],
    partnerApproved: false,
    partnerProfileId: null,
  };
}

export interface EventOptions {
  mode: EventMode;
  status?: EventStatus;
  capacity: number;
  fixedAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  amountStep?: number;
  applyStartAt?: Date;
  applyEndAt?: Date;
  deposit?: { type: 'FIXED'; amount: number } | { type: 'PERCENT'; bp: number };
  depositWindowMinutes?: number;
}

/**
 * 이벤트 1건.
 *
 * `rankingLockAt` 을 항상 `applyEndAt + window + 1분` 으로 채우는 이유:
 * `event_ranking_lock_required_chk` 가 OPEN/CLOSED/FINALIZED 에 대해 NOT NULL 을 요구하고,
 * `event_ranking_lock_after_end_chk` 가 마감보다 뒤여야 한다고 요구한다(D-04).
 */
export async function createEvent(world: TestWorld, options: EventOptions): Promise<string> {
  const id = `it-evt-${world.tag}-${world.eventIds.length}`;
  const windowMinutes = options.depositWindowMinutes ?? 10;

  const applyStartAt = options.applyStartAt ?? days(-1);
  const applyEndAt = options.applyEndAt ?? days(3);
  const status = options.status ?? EventStatus.OPEN;

  const deposit = options.deposit;

  const region = await world.prisma.region.findUniqueOrThrow({
    where: { code: world.regionCode },
    select: { id: true, sigunguCode: true },
  });

  await world.prisma.event.create({
    data: {
      id,
      venueId: world.venueId,
      partnerId: world.partnerProfileId,
      categoryId: world.categoryId,
      regionId: region.id,
      // IC-52: venue.region.sigunguCode 를 복사하는 것이 유일한 경로다.
      sigunguCode: region.sigunguCode,
      title: `테스트 이벤트 ${id}`,
      slug: id,
      description: '통합 테스트용 이벤트',
      tags: ['test'],
      mode: options.mode,
      status,
      capacity: options.capacity,
      // event_mode_amount_chk: INSTANT 는 fixedAmount 만, BID 는 min/max 만.
      fixedAmount: options.mode === EventMode.INSTANT ? (options.fixedAmount ?? 10_000) : null,
      minAmount: options.mode === EventMode.BID ? (options.minAmount ?? 10_000) : null,
      maxAmount: options.mode === EventMode.BID ? (options.maxAmount ?? 1_000_000) : null,
      amountStep: options.amountStep ?? 1,
      applyStartAt,
      applyEndAt,
      rankingLockAt: new Date(applyEndAt.getTime() + (windowMinutes + 1) * 60_000),
      depositRequired: deposit !== undefined,
      depositType:
        deposit === undefined
          ? null
          : deposit.type === 'FIXED'
            ? DepositType.FIXED
            : DepositType.PERCENT,
      depositFixedAmount: deposit !== undefined && deposit.type === 'FIXED' ? deposit.amount : null,
      depositPercentBp: deposit !== undefined && deposit.type === 'PERCENT' ? deposit.bp : null,
      depositRoundingUnit: 100,
      depositWindowMinutes: windowMinutes,
      openedAt: status === EventStatus.OPEN || status === EventStatus.CLOSED ? applyStartAt : null,
      closedAt: status === EventStatus.CLOSED ? applyEndAt : null,
    },
  });

  world.eventIds.push(id);
  return id;
}

export interface RawApplicationInput {
  id: string;
  eventId: string;
  userId: string;
  eventMode: EventMode;
  status: ApplicationStatus;
  amount: number;
  /** microStamp() 로 만든 timestamptz 리터럴. 마이크로초까지 지정할 수 있다. */
  lastBidAt: string;
  firstAppliedAt?: string;
  depositStatus?: DepositStatus;
  depositRequiredAmount?: number;
  depositPaidAmount?: number;
  slotClaimed?: boolean;
}

/**
 * 신청 1행을 **raw SQL 로** 직접 넣는다.
 *
 * Prisma 클라이언트를 쓰지 않는 이유는 하나다 — `lastBidAt` 은 `Timestamptz(6)` 인데
 * Prisma 는 JS `Date`(밀리초)만 넘길 수 있다. 마이크로초만 다른 두 입찰을 만들 수 없으면
 * D-04 의 2순위 키를 제대로 시험할 수 없다(IC-04 가 말하는 바로 그 정밀도 문제다).
 *
 * `settledAmount` 를 상태에 맞춰 계산하는 이유: `app_settled_amount_chk` 는 DEFERRABLE 이 아니라
 * INSERT 시점에 즉시 검사된다. 예약금이 필요 없는 신청은 처음부터 settledAmount = amount 여야 한다.
 */
export async function insertApplication(
  prisma: PrismaClient,
  input: RawApplicationInput,
): Promise<string> {
  const depositStatus = input.depositStatus ?? DepositStatus.NOT_REQUIRED;
  const firstAppliedAt = input.firstAppliedAt ?? input.lastBidAt;

  const settled =
    depositStatus === DepositStatus.NOT_REQUIRED || depositStatus === DepositStatus.PAID
      ? input.amount
      : 0;

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "Application" (
      "id","eventId","userId","eventMode","status","amount",
      "lastBidAt","firstAppliedAt","settledAmount","settledLastBidAt","highestAmountEver",
      "depositStatus","depositDueAt","depositRequiredAmount","depositPaidAmount",
      "policyVersion","slotClaimed","updatedAt"
    ) VALUES (
      $1, $2, $3, $4::"EventMode", $5::"ApplicationStatus", $6::int,
      $7::timestamptz, $8::timestamptz, $9::int, $10::timestamptz, $6::int,
      $11::"DepositStatus",
      CASE WHEN $11::"DepositStatus" IN ('PENDING','SHORTFALL_PENDING')
           THEN now() + interval '10 minutes' ELSE NULL END,
      $12::int, $13::int, 1, $14::boolean, now()
    )
  `,
    input.id,
    input.eventId,
    input.userId,
    input.eventMode,
    input.status,
    input.amount,
    input.lastBidAt,
    firstAppliedAt,
    settled,
    settled > 0 ? input.lastBidAt : firstAppliedAt,
    depositStatus,
    input.depositRequiredAmount ?? 0,
    input.depositPaidAmount ?? 0,
    input.slotClaimed ?? false,
  );

  return input.id;
}

/** 예약금 홀드 1건. `dueAt` 을 과거로 넣으면 스위퍼의 대상이 된다. */
export async function insertDeposit(
  prisma: PrismaClient,
  input: {
    id: string;
    applicationId: string;
    eventId: string;
    userId: string;
    seq?: number;
    reason: DepositReason;
    basisAmount: number;
    amountDue: number;
    /** now 기준 분. 음수면 이미 만료된 홀드다. */
    dueInMinutes: number;
  },
): Promise<string> {
  await prisma.deposit.create({
    data: {
      id: input.id,
      applicationId: input.applicationId,
      eventId: input.eventId,
      userId: input.userId,
      seq: input.seq ?? 1,
      reason: input.reason,
      basisAmount: input.basisAmount,
      depositType: DepositType.FIXED,
      depositFixedAmount: input.amountDue,
      requiredAmount: input.amountDue,
      // deposit_amounts_chk: amountDue > 0. 0원짜리 홀드는 존재할 수 없다.
      amountDue: input.amountDue,
      amountPaid: 0,
      windowMinutes: 10,
      openedAt: minutes(input.dueInMinutes - 10),
      dueAt: minutes(input.dueInMinutes),
      status: DepositStatus.PENDING,
      featureFlagSnapshot: false,
    },
  });

  return input.id;
}

/**
 * 이 실행이 만든 행만 지운다.
 *
 * 순서가 곧 제약이다. Application→Event, Event→Venue, Venue→Business, Business→PartnerProfile 이
 * 전부 `onDelete: Restrict` 라, 자식부터 지우지 않으면 첫 DELETE 에서 막힌다.
 *
 * `AuditLog` 는 지우지 않는다(append-only 트리거가 DELETE 를 거부한다). 스위퍼·랭킹이 남긴
 * 시스템 감사 행은 그대로 쌓인다 — 통합 테스트를 전용 DB 에서 돌려야 하는 이유 중 하나다.
 */
export async function destroyWorld(world: TestWorld): Promise<void> {
  const { prisma, eventIds, userIds } = world;
  const allUsers = [...userIds, world.partnerUserId];

  if (userIds.length > 0) {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.message.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
  }

  if (eventIds.length > 0) {
    // SelectionCutoff / SelectionEntry 는 Selection·Application 에서 CASCADE 로 따라오지만,
    // 순서를 명시해 두면 부분 실패했을 때 어디서 막혔는지가 분명해진다.
    await prisma.selectionEntry.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.selection.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.bidHistory.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.deposit.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.application.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventImage.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  await prisma.venue.updateMany({ where: { id: world.venueId }, data: { coverImageId: null } });
  await prisma.venueImage.deleteMany({ where: { venueId: world.venueId } });
  await prisma.venue.deleteMany({ where: { id: world.venueId } });
  await prisma.business.deleteMany({ where: { id: world.businessId } });
  await prisma.partnerProfile.deleteMany({ where: { id: world.partnerProfileId } });
  await prisma.user.deleteMany({ where: { id: { in: allUsers } } });
  await prisma.category.deleteMany({ where: { id: world.categoryId } });
  await prisma.region.deleteMany({ where: { code: world.regionCode } });
}

function randomDigits(length: number): string {
  let out = '';
  while (out.length < length) out += String(Math.floor(Math.random() * 10));
  return out.slice(0, length);
}
