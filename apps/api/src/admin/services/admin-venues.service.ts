import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  Prisma,
  VenueImageStatus,
  VenueStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { toCursorPage } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertAffected, auditChainKey } from '../admin.internals';
import type { AdminReasonDto } from '../dto/admin-common.dto';
import type {
  HideVenueDto,
  QuarantineImageDto,
  RestoreVenueDto,
  VenueModerationQueryDto,
} from '../dto/moderation-admin.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminOutboxService } from './admin-outbox.service';

const QUEUE_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  sido: true,
  sigungu: true,
  imageCount: true,
  openEventCount: true,
  submittedForReviewAt: true,
  publishedAt: true,
  hiddenAt: true,
  suspendedAt: true,
  suspensionReason: true,
  version: true,
  createdAt: true,
} satisfies Prisma.VenueSelect;

const DETAIL_SELECT = {
  ...QUEUE_SELECT,
  summary: true,
  description: true,
  roadAddress: true,
  detailAddress: true,
  postalCode: true,
  phone: true,
  websiteUrl: true,
  instagramHandle: true,
  seatCount: true,
  reservationNotice: true,
  businessHours: true,
  primaryCategoryId: true,
  regionCode: true,
  business: {
    select: {
      id: true,
      name: true,
      verificationStatus: true,
      partner: { select: { id: true, userId: true, contactName: true } },
    },
  },
  images: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      blobUrl: true,
      status: true,
      sortOrder: true,
      isCover: true,
      altText: true,
      quarantineReason: true,
    },
  },
} satisfies Prisma.VenueSelect;

/**
 * 매장 검수 · 콘텐츠 모더레이션.
 *
 * 파트너 모듈에도 hide/unhide 가 있지만 그것은 **자기 매장을 잠시 내리는** 조치이고,
 * 여기의 hide 는 운영자의 강제 비공개다. 상태 전이는 같아도 감사 액션(CONTENT_HIDDEN)과
 * 되돌릴 수 있는 주체가 다르므로 한 곳에 합치지 않는다 —
 * 합치면 파트너가 운영자 조치를 자기 화면에서 그냥 풀어버릴 수 있게 된다.
 */
@Injectable()
export class AdminVenuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly outbox: AdminOutboxService,
  ) {}

  async list(query: VenueModerationQueryDto) {
    // 업종으로 좁혀 볼 때는 상태 기본값(검수 대기)을 걸지 않는다.
    // "이 업종을 쓰는 시설"을 보러 온 것이므로 상태와 무관하게 전부 나와야 하고,
    // 안 그러면 업종 관리 화면의 "시설 3곳"과 목록 건수가 어긋나 보인다.
    const status = query.status ?? (query.categoryId ? undefined : VenueStatus.PENDING_REVIEW);

    const rows = await this.prisma.venue.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(query.q ? { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } } : {}),
        // 대표 업종과 보조 업종을 모두 본다 — 삭제를 막는 기준과 같아야 한다.
        ...(query.categoryId
          ? {
              OR: [
                { primaryCategoryId: query.categoryId },
                { secondaryCategories: { some: { id: query.categoryId } } },
              ],
            }
          : {}),
      },
      // 검수 큐는 제출 순서. venue_review_queue_idx(status, submittedForReviewAt) 를 탄다.
      orderBy: [{ submittedForReviewAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: QUEUE_SELECT,
    });

    return toCursorPage(rows, query.limit);
  }

  async getDetail(venueId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: DETAIL_SELECT,
    });

    if (!venue) throw new NotFoundException('매장을 찾을 수 없습니다.');

    return venue;
  }

  /**
   * 검수 승인. PENDING_REVIEW → ACTIVE.
   *
   * `publishedAt` 은 COALESCE 로 최초 1회만 찍는다 — 정지 후 재승인할 때 갱신해 버리면
   * "언제 처음 공개됐는가"가 사라지고, venue_search_recent_idx 로 정렬한 최신 목록에서
   * 오래된 매장이 신규처럼 맨 앞에 올라온다.
   *
   * 사업자 확인(VERIFIED)을 술어로 함께 건다. 확인이 취소된 사업자의 매장을 공개하면
   * 검수 화면에서는 정상으로 보이는데 실체는 미확인 사업자다.
   */
  async approve(admin: AuthenticatedUser, venueId: string) {
    return this.moderate(admin, venueId, {
      from: [VenueStatus.PENDING_REVIEW],
      to: VenueStatus.ACTIVE,
      conflictCode: 'VENUE_NOT_IN_REVIEW',
      action: AuditAction.VENUE_PUBLISHED,
      summary: (name) => `매장 검수 승인: ${name}`,
      reasonMemo: null,
      sql: (id) => Prisma.sql`
        UPDATE "Venue" v SET
          status = 'ACTIVE'::"VenueStatus",
          "publishedAt" = COALESCE(v."publishedAt", now()),
          "hiddenAt" = NULL,
          "suspendedAt" = NULL,
          "suspensionReason" = NULL,
          "version" = v."version" + 1,
          "updatedAt" = now()
        WHERE v.id = ${id}
          AND v."deletedAt" IS NULL
          AND v.status = 'PENDING_REVIEW'
          AND EXISTS (
            SELECT 1 FROM "Business" b
            WHERE b.id = v."businessId"
              AND b."deletedAt" IS NULL
              AND b."verificationStatus" = 'VERIFIED'
          )
      `,
      notification: {
        type: NotificationType.VENUE_REVIEW_APPROVED,
        priority: NotificationPriority.HIGH,
        titleKo: '매장 검수가 승인되었습니다',
        body: () => '이제 이 매장으로 이벤트를 열 수 있습니다.',
      },
    });
  }

  /** 검수 반려. DRAFT 로 되돌려 파트너가 고친 뒤 다시 제출하게 한다. */
  async reject(admin: AuthenticatedUser, venueId: string, dto: AdminReasonDto) {
    return this.moderate(admin, venueId, {
      from: [VenueStatus.PENDING_REVIEW],
      to: VenueStatus.DRAFT,
      conflictCode: 'VENUE_NOT_IN_REVIEW',
      action: AuditAction.VENUE_HIDDEN,
      summary: (name) => `매장 검수 반려: ${name} — ${dto.reason}`,
      reasonMemo: dto.reason,
      sql: (id) => Prisma.sql`
        UPDATE "Venue" v SET
          status = 'DRAFT'::"VenueStatus",
          "submittedForReviewAt" = NULL,
          "version" = v."version" + 1,
          "updatedAt" = now()
        WHERE v.id = ${id} AND v."deletedAt" IS NULL AND v.status = 'PENDING_REVIEW'
      `,
      notification: {
        type: NotificationType.VENUE_REVIEW_REJECTED,
        priority: NotificationPriority.HIGH,
        titleKo: '매장 검수가 반려되었습니다',
        body: () => `사유: ${dto.reason}\n내용을 보완한 뒤 다시 검수를 요청해 주세요.`,
      },
    });
  }

  /** 운영자 강제 비공개. 검색·상세에서 즉시 빠진다. */
  async hide(admin: AuthenticatedUser, venueId: string, dto: HideVenueDto) {
    return this.moderate(admin, venueId, {
      from: [VenueStatus.ACTIVE],
      to: VenueStatus.HIDDEN,
      conflictCode: 'VENUE_NOT_ACTIVE',
      action: AuditAction.CONTENT_HIDDEN,
      summary: (name) => `운영자 비공개: ${name} — ${dto.reason}`,
      reasonMemo: dto.reason,
      sql: (id) => Prisma.sql`
        UPDATE "Venue" v SET
          status = 'HIDDEN'::"VenueStatus",
          "hiddenAt" = now(),
          "version" = v."version" + 1,
          "updatedAt" = now()
        WHERE v.id = ${id} AND v."deletedAt" IS NULL AND v.status = 'ACTIVE'
      `,
      notification: {
        type: NotificationType.VENUE_REVIEW_REJECTED,
        priority: NotificationPriority.CRITICAL,
        titleKo: '매장이 비공개 처리되었습니다',
        body: () => `사유: ${dto.reason}\n조치 후 고객센터로 재검토를 요청해 주세요.`,
      },
    });
  }

  /** 비공개 해제. 공개 이력이 있는 매장만 ACTIVE 로 돌아간다. */
  async restore(admin: AuthenticatedUser, venueId: string, dto: RestoreVenueDto) {
    return this.moderate(admin, venueId, {
      from: [VenueStatus.HIDDEN],
      to: VenueStatus.ACTIVE,
      conflictCode: 'VENUE_NOT_HIDDEN',
      action: AuditAction.CONTENT_RESTORED,
      summary: (name) => `운영자 비공개 해제: ${name}`,
      reasonMemo: dto.reason ?? null,
      sql: (id) => Prisma.sql`
        UPDATE "Venue" v SET
          status = 'ACTIVE'::"VenueStatus",
          "hiddenAt" = NULL,
          "publishedAt" = COALESCE(v."publishedAt", now()),
          "version" = v."version" + 1,
          "updatedAt" = now()
        WHERE v.id = ${id} AND v."deletedAt" IS NULL AND v.status = 'HIDDEN'
      `,
      notification: {
        type: NotificationType.VENUE_REVIEW_APPROVED,
        priority: NotificationPriority.HIGH,
        titleKo: '매장 비공개가 해제되었습니다',
        body: () => '매장이 다시 검색에 노출됩니다.',
      },
    });
  }

  /**
   * 매장 정지.
   *
   * Venue 에는 Event 와 달리 `statusBeforeSuspend` 가 없다. 그래서 해제할 때 무엇으로
   * 되돌릴지는 `publishedAt` 의 존재 여부로 결정한다 — 한 번이라도 공개된 적이 있으면 ACTIVE,
   * 아니면 DRAFT. 원래 상태 자체는 감사 행의 beforeJson 에 남는다.
   */
  async suspend(admin: AuthenticatedUser, venueId: string, dto: AdminReasonDto) {
    return this.moderate(admin, venueId, {
      from: [VenueStatus.ACTIVE, VenueStatus.HIDDEN, VenueStatus.PENDING_REVIEW],
      to: VenueStatus.SUSPENDED,
      conflictCode: 'VENUE_NOT_SUSPENDABLE',
      action: AuditAction.VENUE_SUSPENDED,
      summary: (name) => `매장 정지: ${name} — ${dto.reason}`,
      reasonMemo: dto.reason,
      sql: (id) => Prisma.sql`
        UPDATE "Venue" v SET
          status = 'SUSPENDED'::"VenueStatus",
          "suspendedAt" = now(),
          "suspensionReason" = ${dto.reason},
          "version" = v."version" + 1,
          "updatedAt" = now()
        WHERE v.id = ${id}
          AND v."deletedAt" IS NULL
          AND v.status IN ('ACTIVE','HIDDEN','PENDING_REVIEW')
      `,
      notification: {
        type: NotificationType.VENUE_REVIEW_REJECTED,
        priority: NotificationPriority.CRITICAL,
        titleKo: '매장이 정지되었습니다',
        body: () => `사유: ${dto.reason}`,
      },
    });
  }

  /** 정지 해제. 공개 이력이 있으면 ACTIVE, 없으면 DRAFT 로 돌린다. */
  async unsuspend(admin: AuthenticatedUser, venueId: string, dto: RestoreVenueDto) {
    return this.moderate(admin, venueId, {
      from: [VenueStatus.SUSPENDED],
      to: VenueStatus.ACTIVE,
      conflictCode: 'VENUE_NOT_SUSPENDED',
      action: AuditAction.CONTENT_RESTORED,
      summary: (name) => `매장 정지 해제: ${name}`,
      reasonMemo: dto.reason ?? null,
      sql: (id) => Prisma.sql`
        UPDATE "Venue" v SET
          status = CASE WHEN v."publishedAt" IS NOT NULL
                        THEN 'ACTIVE'::"VenueStatus" ELSE 'DRAFT'::"VenueStatus" END,
          "suspendedAt" = NULL,
          "suspensionReason" = NULL,
          "version" = v."version" + 1,
          "updatedAt" = now()
        WHERE v.id = ${id} AND v."deletedAt" IS NULL AND v.status = 'SUSPENDED'
      `,
      notification: {
        type: NotificationType.VENUE_REVIEW_APPROVED,
        priority: NotificationPriority.HIGH,
        titleKo: '매장 정지가 해제되었습니다',
        body: () => '매장 운영을 다시 시작하실 수 있습니다.',
      },
    });
  }

  /**
   * 이미지 격리. 대표 이미지였다면 대표 지정을 함께 푼다.
   *
   * `coverImageId` 를 NULL 로 만드는 것까지 한 트랜잭션에서 하지 않으면,
   * 격리된 이미지가 목록 카드의 대표 이미지로 계속 나간다 — 격리의 목적 자체가 사라진다.
   */
  async quarantineImage(
    admin: AuthenticatedUser,
    venueId: string,
    imageId: string,
    dto: QuarantineImageDto,
  ) {
    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.VENUE_IMAGE));

      const image = await tx.venueImage.findFirst({
        where: { id: imageId, venueId, deletedAt: null },
        select: {
          id: true,
          status: true,
          isCover: true,
          venue: {
            select: { id: true, name: true, business: { select: { partner: { select: { userId: true } } } } },
          },
        },
      });

      if (!image) throw new NotFoundException('이미지를 찾을 수 없습니다.');

      const { count } = await tx.venueImage.updateMany({
        where: { id: imageId, venueId, deletedAt: null, status: { not: VenueImageStatus.QUARANTINED } },
        data: {
          status: VenueImageStatus.QUARANTINED,
          quarantineReason: dto.reason,
          isCover: false,
        },
      });

      assertAffected(count, 1, 'IMAGE_ALREADY_QUARANTINED');

      // 대표였던 경우에만 0행이 아니다. 0행이 정상이므로 단언하지 않는다.
      await tx.venue.updateMany({
        where: { id: venueId, coverImageId: imageId },
        data: { coverImageId: null, version: { increment: 1 } },
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.VENUE_IMAGE_QUARANTINED,
        targetType: AuditTargetType.VENUE_IMAGE,
        targetId: imageId,
        targetOwnerUserId: image.venue.business.partner.userId,
        summary: `이미지 격리(${image.venue.name}): ${dto.reason}`,
        before: { status: image.status, isCover: image.isCover },
        after: { status: VenueImageStatus.QUARANTINED },
        reasonMemo: dto.reason,
        correlationId,
      });

      await this.outbox.enqueue(tx, {
        userId: image.venue.business.partner.userId,
        type: NotificationType.VENUE_IMAGE_QUARANTINED,
        category: NotificationCategory.PARTNER_OPS,
        priority: NotificationPriority.HIGH,
        titleKo: '매장 이미지가 격리되었습니다',
        bodyKo: `[${image.venue.name}] 사유: ${dto.reason}\n다른 이미지로 교체해 주세요.`,
        deepLinkPath: `/partner/venues/${venueId}/images`,
        dedupeKey: `${NotificationType.VENUE_IMAGE_QUARANTINED}:${correlationId}`,
      });

      return { imageId, status: VenueImageStatus.QUARANTINED };
    });
  }

  /** 격리 해제. 대표 지정은 복원하지 않는다 — 파트너가 다시 고르게 한다. */
  async releaseImage(admin: AuthenticatedUser, venueId: string, imageId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.VENUE_IMAGE));

      const { count } = await tx.venueImage.updateMany({
        where: { id: imageId, venueId, deletedAt: null, status: VenueImageStatus.QUARANTINED },
        data: { status: VenueImageStatus.READY, quarantineReason: null },
      });

      assertAffected(count, 1, 'IMAGE_NOT_QUARANTINED');

      await this.audit.append(tx, admin, {
        action: AuditAction.CONTENT_RESTORED,
        targetType: AuditTargetType.VENUE_IMAGE,
        targetId: imageId,
        summary: '이미지 격리 해제',
        before: { status: VenueImageStatus.QUARANTINED },
        after: { status: VenueImageStatus.READY },
      });

      return { imageId, status: VenueImageStatus.READY };
    });
  }

  /**
   * 상태 전이 본체.
   *
   * `updateMany` 대신 raw SQL 을 쓰는 이유는 `COALESCE(publishedAt, now())` 와
   * `CASE WHEN publishedAt IS NOT NULL` 처럼 **자기 컬럼을 읽는 갱신**이 있기 때문이다.
   * Prisma 로는 표현할 수 없어 읽고-쓰기로 퇴화하는데, 그러면 IC-01 이 막으려는 경합 창이 열린다.
   */
  private async moderate(
    admin: AuthenticatedUser,
    venueId: string,
    spec: {
      from: VenueStatus[];
      to: VenueStatus;
      conflictCode: string;
      action: AuditAction;
      summary: (venueName: string) => string;
      reasonMemo: string | null;
      sql: (venueId: string) => Prisma.Sql;
      notification: {
        type: NotificationType;
        priority: NotificationPriority;
        titleKo: string;
        body: () => string;
      };
    },
  ) {
    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.VENUE));

      const before = await tx.venue.findFirst({
        where: { id: venueId, deletedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          business: {
            select: { verificationStatus: true, partner: { select: { userId: true } } },
          },
        },
      });

      if (!before) throw new NotFoundException('매장을 찾을 수 없습니다.');

      const affected = await tx.$executeRaw(spec.sql(venueId));

      // 0행이면 상태가 이미 바뀌었거나(경합) 사업자 확인 술어가 깨진 것이다. 둘 다 409 가 맞다.
      assertAffected(affected, 1, spec.conflictCode);

      await this.audit.append(tx, admin, {
        action: spec.action,
        targetType: AuditTargetType.VENUE,
        targetId: venueId,
        targetOwnerUserId: before.business.partner.userId,
        summary: spec.summary(before.name),
        before: { status: before.status },
        after: { status: spec.to },
        reasonMemo: spec.reasonMemo,
        correlationId,
      });

      await this.outbox.enqueue(tx, {
        userId: before.business.partner.userId,
        type: spec.notification.type,
        category: NotificationCategory.PARTNER_OPS,
        priority: spec.notification.priority,
        titleKo: spec.notification.titleKo,
        bodyKo: `[${before.name}] ${spec.notification.body()}`,
        deepLinkPath: `/partner/venues/${venueId}`,
        dedupeKey: `${spec.notification.type}:${correlationId}`,
      });

      return tx.venue.findUniqueOrThrow({ where: { id: venueId }, select: QUEUE_SELECT });
    });
  }
}
