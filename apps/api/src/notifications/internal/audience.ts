import { ApplicationStatus, BroadcastSegment, Prisma } from '@prisma/client';

import type { Tx } from './audit';

/**
 * 세그먼트 → 수신자 확장. (D-10)
 *
 * 전부 **커서 페이지네이션**이다. 전체 유저 공지는 한 번에 다 못 펼친다 —
 * Vercel 함수는 타임아웃으로 죽고, 죽은 자리에서 다시 시작할 방법이 없으면 공지가
 * 절반만 나간 채로 굳는다. `Broadcast.expansionCursor` 에 마지막 userId 를 적어 두고
 * 다음 크론이 그 뒤부터 잇는다. 커서를 `id` 로 잡았기 때문에 정렬은 언제나 `u.id ASC` 다.
 *
 * 모든 세그먼트가 하나의 SELECT 형태를 공유하고 조건만 갈아끼우는 이유는 D-10 때문이다.
 * 세그먼트마다 쿼리를 따로 쓰면 "탈퇴자 제외"나 "광고 동의 확인" 같은 공통 게이트를
 * 새 세그먼트 하나에서 빠뜨리게 되고, 그 실수는 발송되고 나서야 드러난다.
 */
export interface AudienceSpec {
  segment: BroadcastSegment;
  /** 이벤트 기반 세그먼트에서만 채워진다. 채워지면 신청 상태 스냅샷도 함께 읽는다. */
  eventId: string | null;
  applicationStatuses: ApplicationStatus[];
  /** MARKETING 범주면 인앱 광고 수신 동의자만 받는다(정보통신망법 제50조). */
  requireMarketingConsent: boolean;
  /** 파트너 발송이면 그 파트너가 차단한 사용자를 뺀다. (IC-66) */
  excludeBlockedByPartnerId: string | null;
  regionCode: string | null;
  categoryId: string | null;
  explicitUserIds: string[];
  inactiveSinceDays: number | null;
}

export interface AudienceRow {
  userId: string;
  /** 파트너 발송 시 Message.applicationStatusAtSend 로 굳힐 값. 이벤트 세그먼트가 아니면 null. */
  applicationStatus: ApplicationStatus | null;
}

/** 세그먼트별 추가 조건. 여기 없는 세그먼트는 "살아 있는 활성 계정 전부"가 된다. */
function segmentCondition(spec: AudienceSpec): Prisma.Sql | null {
  const eventId = spec.eventId;

  switch (spec.segment) {
    case BroadcastSegment.ALL_USERS:
      return Prisma.empty;

    // roles 는 enum 배열이라 text[] 로 캐스팅해야 '= ANY' 가 파라미터 바인딩과 맞는다.
    case BroadcastSegment.ALL_PARTNERS:
      return Prisma.sql`AND 'PARTNER' = ANY(u.roles::text[])`;

    case BroadcastSegment.APPROVED_PARTNERS:
      return Prisma.sql`AND EXISTS (
        SELECT 1 FROM "PartnerProfile" p WHERE p."userId" = u.id AND p."approvalStatus" = 'APPROVED'
      )`;

    case BroadcastSegment.PENDING_PARTNER_APPLICANTS:
      return Prisma.sql`AND EXISTS (
        SELECT 1 FROM "PartnerProfile" p WHERE p."userId" = u.id AND p."approvalStatus" = 'PENDING'
      )`;

    case BroadcastSegment.EVENT_APPLICANTS:
      if (!eventId) return null;
      return Prisma.sql`AND EXISTS (
        SELECT 1 FROM "Application" a WHERE a."eventId" = ${eventId} AND a."userId" = u.id
      )`;

    case BroadcastSegment.EVENT_APPLICANTS_BY_STATUS: {
      if (!eventId || spec.applicationStatuses.length === 0) return null;
      // 파라미터는 text 로 들어오므로 enum 쪽을 text 로 내린다. 반대 방향(::"ApplicationStatus")은
      // 잘못된 값이 들어왔을 때 22P02 로 터지는데, 그건 DTO 가 이미 막았어야 하는 것이라 의미가 없다.
      const statuses = Prisma.join(spec.applicationStatuses.map((s) => Prisma.sql`${s}`));
      return Prisma.sql`AND EXISTS (
        SELECT 1 FROM "Application" a
        WHERE a."eventId" = ${eventId} AND a."userId" = u.id AND a.status::text IN (${statuses})
      )`;
    }

    case BroadcastSegment.EVENT_SELECTED:
      if (!eventId) return null;
      return Prisma.sql`AND EXISTS (
        SELECT 1 FROM "SelectionEntry" e
        WHERE e."eventId" = ${eventId} AND e."userId" = u.id AND e.status = 'SELECTED'
      )`;

    case BroadcastSegment.EVENT_NOT_SELECTED:
      if (!eventId) return null;
      return Prisma.sql`AND EXISTS (
        SELECT 1 FROM "SelectionEntry" e
        WHERE e."eventId" = ${eventId} AND e."userId" = u.id AND e.status = 'NOT_SELECTED'
      )`;

    case BroadcastSegment.REGION:
      if (!spec.regionCode) return null;
      return Prisma.sql`AND u."preferredRegionCode" = ${spec.regionCode}`;

    case BroadcastSegment.CATEGORY_INTEREST:
      if (!spec.categoryId) return null;
      return Prisma.sql`AND EXISTS (
        SELECT 1 FROM "UserCategoryInterest" i
        WHERE i."categoryId" = ${spec.categoryId} AND i."userId" = u.id
      )`;

    case BroadcastSegment.INACTIVE_USERS: {
      const days = spec.inactiveSinceDays ?? 90;
      return Prisma.sql`AND (u."lastLoginAt" IS NULL OR u."lastLoginAt" < now() - make_interval(days => ${days}))`;
    }

    case BroadcastSegment.EXPLICIT_USER_LIST: {
      if (spec.explicitUserIds.length === 0) return null;
      const ids = Prisma.join(spec.explicitUserIds.map((id) => Prisma.sql`${id}`));
      return Prisma.sql`AND u.id IN (${ids})`;
    }

    default:
      return null;
  }
}

/**
 * 다음 페이지를 읽는다. 빈 배열이면 확장이 끝났다는 뜻이다.
 *
 * 세그먼트 정의가 성립하지 않으면(예: EVENT_APPLICANTS 인데 eventId 가 없음) 빈 배열을 준다.
 * 여기서 던지면 크론이 그 공지 하나 때문에 매 분 실패하고, 뒤에 줄 선 공지가 전부 밀린다.
 */
export async function fetchAudiencePage(
  tx: Tx,
  spec: AudienceSpec,
  cursor: string | null,
  limit: number,
): Promise<AudienceRow[]> {
  const condition = segmentCondition(spec);
  if (condition === null) return [];

  const after = cursor ? Prisma.sql`AND u.id > ${cursor}` : Prisma.empty;

  // 광고성 정보는 **인앱 동의**가 따로 있다. 이메일 동의(발송 게이트가 본다)와 별개다.
  // 철회 시각이 동의 시각보다 뒤면 철회 상태로 본다 — 재동의하면 AgreedAt 이 다시 앞선다.
  const marketing = spec.requireMarketingConsent
    ? Prisma.sql`AND u."marketingInAppAgreedAt" IS NOT NULL
        AND (u."marketingInAppWithdrawnAt" IS NULL OR u."marketingInAppWithdrawnAt" < u."marketingInAppAgreedAt")`
    : Prisma.empty;

  const notBlocked = spec.excludeBlockedByPartnerId
    ? Prisma.sql`AND NOT EXISTS (
        SELECT 1 FROM "PartnerBlockedUser" b
        WHERE b."partnerProfileId" = ${spec.excludeBlockedByPartnerId}
          AND b."userId" = u.id AND b."releasedAt" IS NULL
      )`
    : Prisma.empty;

  // 이벤트 공지는 수신자마다 "보낼 당시 신청 상태"를 굳혀 둔다. 나중에 상태가 바뀌어도
  // "왜 이 사람이 이 공지를 받았나"를 되짚을 수 있어야 한다(Message.applicationStatusAtSend).
  const statusSnapshot = spec.eventId
    ? Prisma.sql`LEFT JOIN LATERAL (
        SELECT a.status FROM "Application" a
        WHERE a."eventId" = ${spec.eventId} AND a."userId" = u.id
        ORDER BY a."createdAt" DESC
        LIMIT 1
      ) app ON true`
    : Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::"ApplicationStatus" AS status) app ON true`;

  return tx.$queryRaw<AudienceRow[]>`
    SELECT u.id AS "userId", app.status AS "applicationStatus"
    FROM "User" u
    ${statusSnapshot}
    WHERE u."deletedAt" IS NULL
      AND u."anonymizedAt" IS NULL
      AND u.status NOT IN ('WITHDRAWN', 'WITHDRAWAL_PENDING')
      ${after}
      ${condition}
      ${marketing}
      ${notBlocked}
    ORDER BY u.id ASC
    LIMIT ${limit}
  `;
}
