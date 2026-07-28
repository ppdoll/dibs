import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  AuditAction,
  AuditTargetType,
  BroadcastSegment,
  BroadcastStatus,
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
  NotificationType,
  Prisma,
  SelectionStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { toCursorPage } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertAffected, auditChainKey } from '../admin.internals';
import type { OptionalAdminReasonDto } from '../dto/admin-common.dto';
import type {
  BroadcastListQueryDto,
  CreateBroadcastDto,
  ScheduleBroadcastDto,
} from '../dto/broadcast-admin.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminOutboxService } from './admin-outbox.service';
import { AdminSettingsService } from './admin-settings.service';

/**
 * 한 트랜잭션에서 물질화할 수신자 수.
 *
 * 서버리스 함수 타임아웃 안에서 끝나야 하므로 통째로 넣지 않는다.
 * `Broadcast.expansionCursor` 에 마지막 User.id 를 남겨 두고, 다음 호출이 그 뒤부터 잇는다.
 */
const FANOUT_BATCH_SIZE = 500;

/** 한 번의 send 호출이 처리할 최대 배치 수. 넘으면 SENDING 으로 두고 다음 호출을 기다린다. */
const MAX_BATCHES_PER_CALL = 6;

/** 세그먼트가 반드시 이벤트를 지목해야 하는 것들. */
const EVENT_SCOPED_SEGMENTS: BroadcastSegment[] = [
  BroadcastSegment.EVENT_APPLICANTS,
  BroadcastSegment.EVENT_APPLICANTS_BY_STATUS,
  BroadcastSegment.EVENT_SELECTED,
  BroadcastSegment.EVENT_NOT_SELECTED,
];

const BROADCAST_SELECT = {
  id: true,
  segment: true,
  segmentFilter: true,
  applicationStatuses: true,
  eventId: true,
  titleKo: true,
  bodyKo: true,
  channels: true,
  category: true,
  status: true,
  scheduledAt: true,
  audienceSnapshotAt: true,
  totalRecipients: true,
  sentCount: true,
  failedCount: true,
  requiresApproval: true,
  approvedByUserId: true,
  approvedAt: true,
  canceledAt: true,
  createdAt: true,
} satisfies Prisma.BroadcastSelect;

/**
 * 운영자 공지. (D-10)
 *
 * 발송은 두 겹이다 — `Message` 는 **수신자 스냅샷**(누구에게 보냈는지의 원장)이고,
 * `Notification` 은 그 사람의 알림함에 뜨는 행이다. 둘을 합치지 않는 이유는,
 * 사용자가 알림을 지워도 "보냈다"는 사실은 남아야 하기 때문이다.
 *
 * 팬아웃은 항상 `skipDuplicates: true` 다(IC-41). 재실행이 정상 경로이기 때문이다 —
 * 배치 중간에 함수가 죽으면 다음 호출이 커서부터 다시 잇는데, 경계에서 겹치는 것이
 * 빠뜨리는 것보다 훨씬 낫다.
 */
@Injectable()
export class AdminBroadcastsService {
  private readonly logger = new Logger(AdminBroadcastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly outbox: AdminOutboxService,
    private readonly settings: AdminSettingsService,
  ) {}

  async list(query: BroadcastListQueryDto) {
    const rows = await this.prisma.broadcast.findMany({
      where: { deletedAt: null, ...(query.status ? { status: query.status } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: BROADCAST_SELECT,
    });

    return toCursorPage(rows, query.limit);
  }

  async getDetail(broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, deletedAt: null },
      select: BROADCAST_SELECT,
    });

    if (!broadcast) throw new NotFoundException('공지를 찾을 수 없습니다.');

    return broadcast;
  }

  /**
   * 작성.
   *
   * 세그먼트 조건을 `segmentFilter` 로 굳혀 둔다. 발송이 나중에(또는 재실행으로) 일어나므로
   * 그때 대상 정의를 다시 지어내지 않으려면 조건이 행으로 남아 있어야 한다 —
   * "그때 누구에게 보내려 했는가"를 사후에 재구성할 수 없으면 민원 대응이 불가능하다.
   */
  async create(admin: AuthenticatedUser, dto: CreateBroadcastDto) {
    const filter = this.buildSegmentFilter(dto);
    const requiresApproval = await this.settings.getBool('BROADCAST_REQUIRES_APPROVAL');

    if (dto.eventId) {
      const event = await this.prisma.event.findFirst({
        where: { id: dto.eventId, deletedAt: null },
        select: { id: true },
      });
      if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');
    }

    const status = requiresApproval
      ? BroadcastStatus.PENDING_APPROVAL
      : dto.scheduledAt
        ? BroadcastStatus.SCHEDULED
        : BroadcastStatus.DRAFT;

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.BROADCAST));

      const broadcast = await tx.broadcast.create({
        data: {
          senderUserId: admin.id,
          senderRole: UserRole.ADMIN,
          eventId: dto.eventId ?? null,
          segment: dto.segment,
          segmentFilter: filter as Prisma.InputJsonValue,
          applicationStatuses: dto.applicationStatuses ?? [],
          titleKo: dto.titleKo,
          bodyKo: dto.bodyKo,
          channels: dto.channels ?? [NotificationChannel.IN_APP],
          category: dto.category ?? NotificationCategory.ANNOUNCEMENT,
          status,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          requiresApproval,
          // 전역 유니크라 클라이언트 재시도가 공지를 두 번 만들지 않는다.
          idempotencyKey: dto.idempotencyKey,
        },
        select: BROADCAST_SELECT,
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.BROADCAST_CREATED,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcast.id,
        summary: `공지 작성(${dto.segment}): ${dto.titleKo}`,
        after: { segment: dto.segment, status, filter },
        idempotencyKey: `broadcast-create:${dto.idempotencyKey}`,
      });

      return broadcast;
    });
  }

  /** 승인. 다른 운영자가 눌러야 한다 — 자기 공지를 자기가 승인하면 승인 절차가 장식이다. */
  async approve(admin: AuthenticatedUser, broadcastId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.BROADCAST));

      const before = await tx.broadcast.findFirst({
        where: { id: broadcastId, deletedAt: null },
        select: { id: true, senderUserId: true, scheduledAt: true, titleKo: true },
      });

      if (!before) throw new NotFoundException('공지를 찾을 수 없습니다.');

      if (before.senderUserId === admin.id) {
        throw new BadRequestException('본인이 작성한 공지는 본인이 승인할 수 없습니다.');
      }

      const { count } = await tx.broadcast.updateMany({
        where: { id: broadcastId, deletedAt: null, status: BroadcastStatus.PENDING_APPROVAL },
        data: {
          status: before.scheduledAt ? BroadcastStatus.SCHEDULED : BroadcastStatus.DRAFT,
          approvedByUserId: admin.id,
          approvedAt: new Date(),
        },
      });

      assertAffected(count, 1, 'BROADCAST_NOT_PENDING_APPROVAL');

      await this.audit.append(tx, admin, {
        action: AuditAction.BROADCAST_APPROVED,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: `공지 승인: ${before.titleKo}`,
      });

      return tx.broadcast.findUniqueOrThrow({ where: { id: broadcastId }, select: BROADCAST_SELECT });
    });
  }

  /** 예약 발송 시각 지정/변경. 이미 발송이 시작된 뒤에는 못 바꾼다. */
  async schedule(admin: AuthenticatedUser, broadcastId: string, dto: ScheduleBroadcastDto) {
    const scheduledAt = new Date(dto.scheduledAt);

    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('예약 시각은 현재보다 뒤여야 합니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.BROADCAST));

      const { count } = await tx.broadcast.updateMany({
        where: {
          id: broadcastId,
          deletedAt: null,
          status: { in: [BroadcastStatus.DRAFT, BroadcastStatus.SCHEDULED] },
        },
        data: { status: BroadcastStatus.SCHEDULED, scheduledAt },
      });

      assertAffected(count, 1, 'BROADCAST_NOT_SCHEDULABLE');

      await this.audit.append(tx, admin, {
        action: AuditAction.BROADCAST_CREATED,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: `공지 예약: ${scheduledAt.toISOString()}`,
        after: { scheduledAt: scheduledAt.toISOString() },
      });

      return tx.broadcast.findUniqueOrThrow({ where: { id: broadcastId }, select: BROADCAST_SELECT });
    });
  }

  /** 취소. 이미 나간 쪽지를 회수하지는 못하므로 SENT 는 취소 대상이 아니다. */
  async cancel(admin: AuthenticatedUser, broadcastId: string, dto: OptionalAdminReasonDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.BROADCAST));

      const { count } = await tx.broadcast.updateMany({
        where: {
          id: broadcastId,
          deletedAt: null,
          status: {
            in: [
              BroadcastStatus.DRAFT,
              BroadcastStatus.PENDING_APPROVAL,
              BroadcastStatus.SCHEDULED,
            ],
          },
        },
        data: {
          status: BroadcastStatus.CANCELED,
          canceledAt: new Date(),
          canceledByUserId: admin.id,
        },
      });

      assertAffected(count, 1, 'BROADCAST_NOT_CANCELABLE');

      await this.audit.append(tx, admin, {
        action: AuditAction.BROADCAST_CANCELED,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: `공지 취소${dto.reason ? `: ${dto.reason}` : ''}`,
        reasonMemo: dto.reason ?? null,
      });

      return tx.broadcast.findUniqueOrThrow({ where: { id: broadcastId }, select: BROADCAST_SELECT });
    });
  }

  /**
   * 발송(팬아웃).
   *
   * 상태를 먼저 `SENDING` 으로 **조건부 UPDATE 로 선점**한다. 두 운영자가 동시에 눌러도
   * 한쪽만 1행을 얻으므로, 같은 공지가 두 번 확장되는 일이 없다(IC-01).
   * 그 다음 배치를 돌며 `Message` → `Notification` → `EmailDelivery` 순으로 물질화하고,
   * 마지막 배치의 User.id 를 `expansionCursor` 에 남긴다.
   *
   * 한 호출에서 다 끝내지 않는 이유는 함수 타임아웃이다. 남았으면 SENDING 으로 두고
   * `hasMore: true` 를 돌려준다 — 콘솔(또는 크론)이 같은 엔드포인트를 다시 때리면 이어서 간다.
   */
  async send(admin: AuthenticatedUser, broadcastId: string) {
    const claimed = await this.prisma.broadcast.updateMany({
      where: {
        id: broadcastId,
        deletedAt: null,
        // SENDING 을 포함하는 이유: 중단된 발송을 이어서 돌리는 것이 정상 경로다.
        // 대가로 두 운영자가 동시에 눌렀을 때 `totalRecipients` 가 부풀 수 있다.
        // 알림·쪽지는 skipDuplicates 라 실제 발송이 겹치지는 않으므로, 카운터의 오차보다
        // "중단된 공지를 이어 보낼 수 없음"이 더 나쁘다고 판단한 트레이드오프다.
        status: { in: [BroadcastStatus.DRAFT, BroadcastStatus.SCHEDULED, BroadcastStatus.SENDING] },
      },
      data: { status: BroadcastStatus.SENDING, audienceSnapshotAt: new Date() },
    });

    assertAffected(claimed.count, 1, 'BROADCAST_NOT_SENDABLE');

    const broadcast = await this.prisma.broadcast.findUniqueOrThrow({
      where: { id: broadcastId },
      select: {
        id: true,
        segment: true,
        segmentFilter: true,
        applicationStatuses: true,
        eventId: true,
        titleKo: true,
        bodyKo: true,
        channels: true,
        category: true,
        expansionCursor: true,
        senderUserId: true,
        sender: { select: { displayName: true } },
      },
    });

    const audience = this.buildAudienceWhere(broadcast);
    const wantsEmail = broadcast.channels.includes(NotificationChannel.EMAIL);

    let cursor = broadcast.expansionCursor;
    let delivered = 0;
    let exhausted = false;

    for (let batch = 0; batch < MAX_BATCHES_PER_CALL; batch += 1) {
      const recipients = await this.prisma.user.findMany({
        where: {
          ...audience,
          deletedAt: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        // id 오름차순이 커서의 전순서다. createdAt 으로 잡으면 같은 밀리초에서 사람이 빠진다.
        orderBy: { id: 'asc' },
        take: FANOUT_BATCH_SIZE,
        select: { id: true },
      });

      if (recipients.length === 0) {
        exhausted = true;
        break;
      }

      const userIds = recipients.map((r) => r.id);
      // 커서는 이 배치의 마지막 User.id 다. 배치 안에서 커밋되므로, 함수가 다음 배치에서
      // 죽어도 여기까지는 남는다 — 재호출이 처음부터 다시 돌지 않는 유일한 근거다.
      const nextCursor = userIds[userIds.length - 1];
      if (!nextCursor) {
        exhausted = true;
        break;
      }
      cursor = nextCursor;

      delivered += await this.materializeBatch(broadcast, userIds, nextCursor, wantsEmail);

      if (recipients.length < FANOUT_BATCH_SIZE) {
        exhausted = true;
        break;
      }
    }

    if (!exhausted) {
      this.logger.log(`공지 ${broadcastId} 팬아웃이 남았습니다. 같은 엔드포인트를 다시 호출하세요.`);

      return { broadcastId, status: BroadcastStatus.SENDING, deliveredThisCall: delivered, hasMore: true };
    }

    return this.finishSend(admin, broadcastId, delivered);
  }

  /**
   * 배치 1개분 물질화. 배치마다 커밋하는 이유는 함수가 중간에 죽어도
   * 이미 보낸 만큼은 커서와 함께 남아야 하기 때문이다 — 전부 롤백되면 재시도가 처음부터 다시 돈다.
   */
  private async materializeBatch(
    broadcast: {
      id: string;
      titleKo: string;
      bodyKo: string;
      eventId: string | null;
      category: NotificationCategory;
      senderUserId: string;
      sender: { displayName: string };
    },
    userIds: string[],
    cursor: string,
    wantsEmail: boolean,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const messages = await this.outbox.fanoutBroadcastMessages(tx, userIds, {
        id: broadcast.id,
        titleKo: broadcast.titleKo,
        bodyKo: broadcast.bodyKo,
        eventId: broadcast.eventId,
        senderUserId: broadcast.senderUserId,
        senderDisplayName: broadcast.sender.displayName,
      });

      // 알림함 행. dedupeKey 가 공지 단위라 재실행해도 사람당 1행이다.
      await this.outbox.fanoutNotifications(tx, userIds, {
        type: NotificationType.ADMIN_ANNOUNCEMENT,
        category: broadcast.category,
        priority: NotificationPriority.NORMAL,
        titleKo: broadcast.titleKo,
        bodyKo: broadcast.bodyKo,
        dedupeKey: `BROADCAST:${broadcast.id}`,
        deepLinkPath: '/notifications',
        eventId: broadcast.eventId,
      });

      if (wantsEmail) {
        await this.outbox.fanoutBroadcastEmails(tx, broadcast.id, userIds);
      }

      await tx.broadcast.update({
        where: { id: broadcast.id },
        data: {
          expansionCursor: cursor,
          totalRecipients: { increment: userIds.length },
          sentCount: { increment: messages },
        },
      });

      return messages;
    });
  }

  /** 마지막 배치 뒤 마무리. 감사 행은 여기서 **한 번만** 쓴다(IC-61 의 집계 1행). */
  private async finishSend(admin: AuthenticatedUser, broadcastId: string, deliveredThisCall: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.BROADCAST));

      const { count } = await tx.broadcast.updateMany({
        where: { id: broadcastId, status: BroadcastStatus.SENDING },
        data: { status: BroadcastStatus.SENT },
      });

      assertAffected(count, 1, 'BROADCAST_NOT_SENDING');

      const final = await tx.broadcast.findUniqueOrThrow({
        where: { id: broadcastId },
        select: BROADCAST_SELECT,
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.BROADCAST_SENT,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: `공지 발송 완료: 수신자 ${final.totalRecipients}명`,
        after: { totalRecipients: final.totalRecipients, sentCount: final.sentCount },
      });

      return { ...final, deliveredThisCall, hasMore: false };
    });
  }

  /** 세그먼트별 필수 입력 검증 + 저장할 필터. 여기서 막지 못하면 발송 시점에 대상이 0명이 된다. */
  private buildSegmentFilter(dto: CreateBroadcastDto): Record<string, unknown> {
    if (EVENT_SCOPED_SEGMENTS.includes(dto.segment) && !dto.eventId) {
      throw new BadRequestException('이 세그먼트는 eventId 가 필요합니다.');
    }

    switch (dto.segment) {
      case BroadcastSegment.EVENT_APPLICANTS_BY_STATUS:
        if (!dto.applicationStatuses?.length) {
          throw new BadRequestException('applicationStatuses 가 필요합니다.');
        }
        return { eventId: dto.eventId, applicationStatuses: dto.applicationStatuses };

      case BroadcastSegment.REGION:
        if (!dto.regionCode) throw new BadRequestException('regionCode 가 필요합니다.');
        return { regionCode: dto.regionCode };

      case BroadcastSegment.CATEGORY_INTEREST:
        if (!dto.categoryId) throw new BadRequestException('categoryId 가 필요합니다.');
        return { categoryId: dto.categoryId };

      case BroadcastSegment.INACTIVE_USERS:
        if (!dto.inactiveDays) throw new BadRequestException('inactiveDays 가 필요합니다.');
        return { inactiveDays: dto.inactiveDays };

      case BroadcastSegment.EXPLICIT_USER_LIST:
        if (!dto.userIds?.length) throw new BadRequestException('userIds 가 필요합니다.');
        return { userIds: dto.userIds };

      default:
        return dto.eventId ? { eventId: dto.eventId } : {};
    }
  }

  /**
   * 세그먼트를 실제 조회 조건으로 편다.
   *
   * 저장된 `segmentFilter` 를 읽어 쓰는 것이 핵심이다 — 작성 시점의 조건이 그대로 재생되어야
   * 중단된 발송을 이어 붙일 때 대상 집합이 바뀌지 않는다.
   * (`INACTIVE_USERS` 만은 시간에 의존해 미세하게 움직이는데, 그건 세그먼트 정의 자체가 상대 시각이라 그렇다.)
   */
  private buildAudienceWhere(broadcast: {
    segment: BroadcastSegment;
    segmentFilter: Prisma.JsonValue;
    applicationStatuses: ApplicationStatus[];
    eventId: string | null;
  }): Prisma.UserWhereInput {
    const filter = (broadcast.segmentFilter ?? {}) as Record<string, unknown>;
    const eventId = broadcast.eventId ?? (filter.eventId as string | undefined);

    // eventId 가 없는 채로 EVENT_* 세그먼트를 펴면 `some: { eventId: undefined }` 가 되어
    // **전체 신청자**가 대상이 된다. 작성 시 검증하지만, 여기서도 한 번 더 막는다 —
    // 조용히 전 사용자에게 나가는 실수는 되돌릴 수 없다.
    if (EVENT_SCOPED_SEGMENTS.includes(broadcast.segment) && !eventId) {
      throw new BadRequestException('세그먼트에 eventId 가 없습니다.');
    }

    switch (broadcast.segment) {
      case BroadcastSegment.ALL_USERS:
        return { status: 'ACTIVE' };

      case BroadcastSegment.ALL_PARTNERS:
        return { status: 'ACTIVE', roles: { has: UserRole.PARTNER } };

      case BroadcastSegment.APPROVED_PARTNERS:
        return { status: 'ACTIVE', partnerProfile: { approvalStatus: 'APPROVED', deletedAt: null } };

      case BroadcastSegment.PENDING_PARTNER_APPLICANTS:
        return { status: 'ACTIVE', partnerProfile: { approvalStatus: 'PENDING', deletedAt: null } };

      case BroadcastSegment.EVENT_APPLICANTS:
        return { applications: { some: { eventId } } };

      case BroadcastSegment.EVENT_APPLICANTS_BY_STATUS:
        return {
          applications: {
            some: {
              eventId,
              status: { in: broadcast.applicationStatuses.length ? broadcast.applicationStatuses : undefined },
            },
          },
        };

      case BroadcastSegment.EVENT_SELECTED:
        return { selectionEntries: { some: { eventId, status: SelectionStatus.SELECTED } } };

      case BroadcastSegment.EVENT_NOT_SELECTED:
        return { selectionEntries: { some: { eventId, status: SelectionStatus.NOT_SELECTED } } };

      case BroadcastSegment.REGION:
        return { status: 'ACTIVE', preferredRegionCode: filter.regionCode as string };

      case BroadcastSegment.CATEGORY_INTEREST:
        return {
          status: 'ACTIVE',
          categoryInterests: { some: { categoryId: filter.categoryId as string } },
        };

      case BroadcastSegment.INACTIVE_USERS:
        return {
          status: 'ACTIVE',
          lastLoginAt: {
            lt: new Date(Date.now() - Number(filter.inactiveDays ?? 90) * 86_400_000),
          },
        };

      case BroadcastSegment.EXPLICIT_USER_LIST:
        return { id: { in: (filter.userIds as string[] | undefined) ?? [] } };

      default:
        // 열거형이 늘었는데 여기를 안 고치면 전체 발송이 되어버린다. 0명으로 막는다.
        throw new BadRequestException('지원하지 않는 세그먼트입니다.');
    }
  }
}
