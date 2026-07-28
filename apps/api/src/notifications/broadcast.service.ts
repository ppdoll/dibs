import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ApplicationStatus,
  AuditAction,
  AuditActorRole,
  AuditTargetType,
  BroadcastSegment,
  BroadcastStatus,
  ModerationState,
  NotificationCategory,
  NotificationChannel,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { assertAffected } from '../common/db/assert-affected';
import type { CursorPage } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { BroadcastExpanderService } from './broadcast-expander.service';
import { renderNotification } from './templates/notification-templates';
import { screenBroadcastText } from './internal/broadcast-moderation';
import { acquireAuditChainLock, appendAuditLog, broadcastChainKey, type Tx } from './internal/audit';
import type { BroadcastListQueryDto, CreateBroadcastDto } from './dto/broadcast.dto';
import type { SendEventMessageDto } from './dto/message.dto';

const BROADCAST_SUMMARY_SELECT = {
  id: true,
  segment: true,
  status: true,
  titleKo: true,
  eventId: true,
  totalRecipients: true,
  sentCount: true,
  failedCount: true,
  suppressedCount: true,
  moderationState: true,
  moderationNote: true,
  createdAt: true,
} satisfies Prisma.BroadcastSelect;

type BroadcastSummary = Prisma.BroadcastGetPayload<{ select: typeof BROADCAST_SUMMARY_SELECT }>;

/**
 * 공지·쪽지 발송. (D-10)
 *
 * 파트너 발송과 운영자 발송이 한 서비스에 있는 이유: 둘은 **세그먼트만 다르고 나머지가 같다**.
 * 수신자 물질화·이메일 아웃박스·확장 커서·감사 기록이 전부 동일하고, 나누면 그 공통 부분이
 * 두 벌이 되어 한쪽에만 규칙을 고치는 사고가 난다. 다른 것은 진입 시점의 **권한 검사**뿐이라
 * 거기만 갈라 둔다.
 *
 * 발송 요청은 언제나 `Broadcast` 행 하나를 만들고 끝난다. 실제 팬아웃은 확장 워커가 한다 —
 * 요청 안에서 20만 행을 펼치려다 타임아웃으로 죽으면 절반만 나간 공지가 남는다.
 * 대신 첫 페이지는 여기서 바로 한 번 돌려 준다. 신청자 30명짜리 파트너 공지가
 * "잠시 후 발송됩니다"만 보고 끝나면 파트너는 실패한 줄 안다.
 */
@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expander: BroadcastExpanderService,
  ) {}

  /**
   * 파트너 → 자기 이벤트 신청자 발송.
   *
   * 소유권은 **WHERE 절 안에서** 확인한다. 별도 SELECT 로 먼저 확인하면 그 사이가 경합 창이고,
   * 무엇보다 새 핸들러를 만들 때 그 SELECT 를 빠뜨리는 순간 남의 이벤트 신청자에게 발송된다.
   */
  async sendEventMessage(user: AuthenticatedUser, eventId: string, dto: SendEventMessageDto) {
    const partnerProfileId = user.partnerProfileId;
    if (!partnerProfileId) throw new ForbiddenException('파트너 신청서를 먼저 제출해 주세요.');

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, partnerId: partnerProfileId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    const statuses = dto.applicationStatuses ?? [];
    const segment =
      statuses.length > 0
        ? BroadcastSegment.EVENT_APPLICANTS_BY_STATUS
        : BroadcastSegment.EVENT_APPLICANTS;

    return this.create(user, {
      segment,
      eventId,
      applicationStatuses: statuses,
      titleKo: dto.titleKo,
      bodyKo: dto.bodyKo,
      // 파트너 쪽지는 ANNOUNCEMENT 가 아니라 MESSAGE 범주다. 운영 공지와 같은 무게로 다루면
      // 사용자가 파트너 홍보를 끄려다 운영자 공지까지 끄게 된다.
      category: NotificationCategory.MESSAGE,
      channels: dto.channels ?? [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      segmentFilter: { partnerProfileId },
      scheduledAt: null,
      idempotencyKey: dto.idempotencyKey,
      senderRole: UserRole.PARTNER,
      // 파트너 문구는 사람이 직접 쓴다. D-07 을 기계가 강제할 수 없으므로 훑고 보류한다.
      screenText: true,
    });
  }

  /** 운영자 세그먼트 공지. */
  async createBroadcast(user: AuthenticatedUser, dto: CreateBroadcastDto) {
    this.assertSegmentInputs(dto);

    return this.create(user, {
      segment: dto.segment,
      eventId: dto.eventId ?? null,
      applicationStatuses: dto.applicationStatuses ?? [],
      titleKo: dto.titleKo,
      bodyKo: dto.bodyKo,
      category: dto.category ?? NotificationCategory.ANNOUNCEMENT,
      channels: dto.channels ?? [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      segmentFilter: {
        ...(dto.regionCode ? { regionCode: dto.regionCode } : {}),
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.userIds ? { userIds: dto.userIds } : {}),
        ...(dto.inactiveSinceDays ? { inactiveSinceDays: dto.inactiveSinceDays } : {}),
      },
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      idempotencyKey: dto.idempotencyKey,
      senderRole: UserRole.ADMIN,
      // 운영자 문구는 훑지 않는다. 커트라인 공개 여부를 판단할 권한이 있는 유일한 역할이고,
      // 자동 보류에 걸리면 승인할 사람이 자기 자신이라 절차가 무의미하다.
      screenText: false,
    });
  }

  async list(query: BroadcastListQueryDto): Promise<CursorPage<BroadcastSummary>> {
    const rows = await this.prisma.broadcast.findMany({
      where: { deletedAt: null, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: BROADCAST_SUMMARY_SELECT,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return { items, hasMore, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  async get(broadcastId: string): Promise<BroadcastSummary> {
    const row = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, deletedAt: null },
      select: BROADCAST_SUMMARY_SELECT,
    });

    if (!row) throw new NotFoundException('공지를 찾을 수 없습니다.');
    return row;
  }

  /**
   * 보류된 공지를 승인해 발송을 재개한다.
   *
   * 상태 전제를 전부 WHERE 에 넣고 행 수를 단언한다(IC-01). 두 운영자가 동시에 눌러
   * 두 번 승인되면 감사 로그에 승인 행이 둘 생기고, 어느 쪽이 진짜인지 사후에 알 수 없다.
   */
  async approve(user: AuthenticatedUser, broadcastId: string): Promise<BroadcastSummary> {
    await this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, broadcastChainKey(broadcastId));

      const { count } = await tx.broadcast.updateMany({
        where: {
          id: broadcastId,
          status: { in: [BroadcastStatus.PENDING_APPROVAL, BroadcastStatus.BLOCKED] },
          deletedAt: null,
        },
        data: {
          status: BroadcastStatus.EXPANDING,
          moderationState: ModerationState.APPROVED,
          approvedByUserId: user.id,
          approvedAt: new Date(),
        },
      });
      assertAffected(count, 1, 'BROADCAST_STATE_CHANGED');

      await appendAuditLog(tx, {
        actorUserId: user.id,
        actorRole: AuditActorRole.ADMIN,
        actorLabel: user.displayName,
        action: AuditAction.BROADCAST_APPROVED,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: '보류된 공지를 승인해 발송을 재개했습니다.',
        chainKey: broadcastChainKey(broadcastId),
      });
    });

    await this.expander.pumpOne(broadcastId);

    return this.get(broadcastId);
  }

  /**
   * 발송 취소.
   *
   * 이미 SENT 인 공지는 취소할 수 없다 — 쪽지는 회수되지 않는다. 확장 중이면 남은 페이지를
   * 멈출 수 있고, 아직 안 나간 메일(PENDING/DELAYED)은 CANCELED 로 돌려 발송을 막는다.
   * "이미 나간 것"과 "아직 안 나간 것"을 정확히 가르는 게 이 메서드의 전부다.
   */
  async cancel(user: AuthenticatedUser, broadcastId: string): Promise<BroadcastSummary> {
    await this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, broadcastChainKey(broadcastId));

      const { count } = await tx.broadcast.updateMany({
        where: {
          id: broadcastId,
          status: {
            in: [
              BroadcastStatus.DRAFT,
              BroadcastStatus.PENDING_APPROVAL,
              BroadcastStatus.SCHEDULED,
              BroadcastStatus.EXPANDING,
              BroadcastStatus.SENDING,
            ],
          },
          deletedAt: null,
        },
        data: {
          status: BroadcastStatus.CANCELED,
          canceledAt: new Date(),
          canceledByUserId: user.id,
        },
      });
      assertAffected(count, 1, 'BROADCAST_STATE_CHANGED');

      const stopped = await this.cancelPendingEmails(tx, broadcastId);

      await appendAuditLog(tx, {
        actorUserId: user.id,
        actorRole: AuditActorRole.ADMIN,
        actorLabel: user.displayName,
        action: AuditAction.BROADCAST_CANCELED,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: `공지 발송을 취소했습니다. 미발송 메일 ${stopped}건을 중단했습니다.`,
        chainKey: broadcastChainKey(broadcastId),
      });
    });

    return this.get(broadcastId);
  }

  // --- 내부 ---------------------------------------------------------------

  private async create(
    user: AuthenticatedUser,
    input: {
      segment: BroadcastSegment;
      eventId: string | null;
      applicationStatuses: ApplicationStatus[];
      titleKo: string;
      bodyKo: string;
      category: NotificationCategory;
      channels: NotificationChannel[];
      segmentFilter: Record<string, unknown>;
      scheduledAt: Date | null;
      idempotencyKey: string;
      senderRole: UserRole;
      screenText: boolean;
    },
  ): Promise<BroadcastSummary> {
    // 같은 키로 다시 들어온 요청은 새 공지를 만들지 않고 원래 것을 돌려준다.
    // 네트워크가 끊긴 뒤 파트너가 "발송" 을 다시 누르는 건 흔한 일이고, 그때마다 공지가
    // 하나씩 늘면 신청자는 같은 안내를 세 번 받는다.
    const existing = await this.prisma.broadcast.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: BROADCAST_SUMMARY_SELECT,
    });
    if (existing) return existing;

    const verdict = input.screenText
      ? screenBroadcastText(input.titleKo, input.bodyKo)
      : { flagged: false, reasonKo: null };

    // id 를 먼저 정한다 — 감사 체인 키가 트랜잭션의 **첫 문장**에 필요한데(IC-02),
    // DB 기본값에 맡기면 INSERT 가 끝나야 id 를 알 수 있어 순서가 뒤집힌다.
    const broadcastId = randomUUID();
    const chainKey = broadcastChainKey(broadcastId);

    // 보류는 BLOCKED 가 아니라 PENDING_APPROVAL 이다. BLOCKED 는 "운영자가 보고 막았다"는 뜻이고,
    // 여기서 걸린 건 정규식이 의심했을 뿐이라 아직 사람이 보지 않았다.
    const status = verdict.flagged
      ? BroadcastStatus.PENDING_APPROVAL
      : input.scheduledAt && input.scheduledAt > new Date()
        ? BroadcastStatus.SCHEDULED
        : BroadcastStatus.EXPANDING;

    try {
      await this.writeBroadcast(user, input, broadcastId, chainKey, status, verdict);
    } catch (cause) {
      // idempotencyKey 유니크 위반. 같은 키로 두 요청이 동시에 들어오면 위의 findUnique 를
      // 둘 다 통과한다 — 그 경합은 여기서만 잡힌다.
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        const raced = await this.prisma.broadcast.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: BROADCAST_SUMMARY_SELECT,
        });
        if (raced) return raced;
      }
      throw cause;
    }

    // 첫 페이지는 즉시 펼친다. 소규모 발송(대부분의 파트너 공지)은 이 한 번으로 끝난다.
    if (status === BroadcastStatus.EXPANDING) {
      await this.expander.pumpOne(broadcastId);
    }

    return this.get(broadcastId);
  }

  private async writeBroadcast(
    user: AuthenticatedUser,
    input: {
      segment: BroadcastSegment;
      eventId: string | null;
      applicationStatuses: ApplicationStatus[];
      titleKo: string;
      bodyKo: string;
      category: NotificationCategory;
      channels: NotificationChannel[];
      segmentFilter: Record<string, unknown>;
      scheduledAt: Date | null;
      idempotencyKey: string;
      senderRole: UserRole;
    },
    broadcastId: string,
    chainKey: string,
    status: BroadcastStatus,
    verdict: { flagged: boolean; reasonKo: string | null },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, chainKey);

      await tx.broadcast.create({
        data: {
          id: broadcastId,
          senderUserId: user.id,
          senderRole: input.senderRole,
          eventId: input.eventId,
          segment: input.segment,
          segmentFilter: input.segmentFilter as Prisma.InputJsonValue,
          applicationStatuses: input.applicationStatuses,
          titleKo: input.titleKo.slice(0, 120),
          bodyKo: input.bodyKo,
          channels: input.channels,
          category: input.category,
          status,
          scheduledAt: input.scheduledAt,
          moderationState: verdict.flagged
            ? ModerationState.PENDING_REVIEW
            : ModerationState.NOT_REQUIRED,
          moderationNote: verdict.reasonKo,
          requiresApproval: verdict.flagged,
          idempotencyKey: input.idempotencyKey,
        },
      });

      await appendAuditLog(tx, {
        actorUserId: user.id,
        actorRole:
          input.senderRole === UserRole.ADMIN ? AuditActorRole.ADMIN : AuditActorRole.PARTNER,
        actorLabel: user.displayName,
        action: verdict.flagged ? AuditAction.BROADCAST_MODERATION_BLOCKED : AuditAction.BROADCAST_CREATED,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: verdict.flagged
          ? `공지 발송이 보류되었습니다 — ${verdict.reasonKo ?? '운영정책 검토 필요'}`
          : `공지를 생성했습니다 — 세그먼트 ${input.segment}`,
        chainKey,
        afterJson: { segment: input.segment, eventId: input.eventId, category: input.category },
        idempotencyKey: `broadcast-created:${broadcastId}`,
      });

      // 보류되면 발신자에게 그 사실을 알린다. 아무 통보 없이 안 나가면 파트너는
      // 발송된 줄 알고 기다리다 신청자 문의를 받는다.
      if (verdict.flagged) {
        await this.notifySenderBlocked(
          tx,
          user.id,
          broadcastId,
          verdict.reasonKo ? `${verdict.reasonKo} 운영자 검토 후 발송됩니다.` : null,
        );
      }
    });
  }

  /**
   * 발송이 막힌 사실을 발신자에게 통보한다. (IC-41, IC-42)
   *
   * 단건인데도 `createMany({skipDuplicates:true})` 인 이유: `create` 는
   * `uq_notification_user_dedupe` 위반을 예외로 던지고, 그 예외가 같은 트랜잭션의
   * 공지 생성까지 롤백시킨다. 중복 알림 하나 때문에 발송 기록이 사라지는 건
   * 우선순위가 완전히 뒤집힌 것이다.
   */
  private async notifySenderBlocked(
    tx: Tx,
    senderUserId: string,
    broadcastId: string,
    reasonKo: string | null,
  ): Promise<void> {
    const rendered = renderNotification(NotificationType.PARTNER_BROADCAST_BLOCKED, {
      broadcastId,
      ...(reasonKo ? { reasonKo } : {}),
    });

    await tx.notification.createMany({
      data: [
        {
          userId: senderUserId,
          type: NotificationType.PARTNER_BROADCAST_BLOCKED,
          category: rendered.category,
          priority: rendered.priority,
          titleKo: rendered.titleKo,
          bodyKo: rendered.bodyKo,
          deepLinkPath: rendered.deepLinkPath,
          dedupeKey: `PARTNER_BROADCAST_BLOCKED:${broadcastId}`,
        },
      ],
      skipDuplicates: true,
    });

    // 아웃박스(IC-42). 주소가 없으면 행을 만들지 않는다 — PENDING 으로 넣어두면
    // 디스패처가 매번 집었다가 SKIPPED 로 되돌리는 일을 영원히 반복한다.
    await tx.$executeRaw`
      INSERT INTO "EmailDelivery" (
        "id", "notificationId", "recipientUserId", "channel", "status",
        "toAddress", "subjectKo", "bodyText", "idempotencyKey", "updatedAt"
      )
      SELECT
        gen_random_uuid()::text, n.id, n."userId",
        'EMAIL'::"NotificationChannel", 'PENDING'::"DeliveryStatus",
        COALESCE(u."notificationEmail", u.email), n."titleKo", n."bodyKo",
        gen_random_uuid()::text, now()
      FROM "Notification" n
      JOIN "User" u ON u.id = n."userId"
      WHERE n."userId" = ${senderUserId}
        AND n."dedupeKey" = ${`PARTNER_BROADCAST_BLOCKED:${broadcastId}`}
        AND COALESCE(u."notificationEmail", u.email) IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
  }

  /** 아직 프로바이더로 나가지 않은 메일만 멈춘다. SENDING 은 이미 요청이 떠난 뒤일 수 있다. */
  private async cancelPendingEmails(tx: Tx, broadcastId: string): Promise<number> {
    return tx.$executeRaw`
      UPDATE "EmailDelivery" e
      SET status = 'CANCELED', "lockedUntil" = NULL, "nextAttemptAt" = NULL, "updatedAt" = now()
      FROM "Message" m
      WHERE m.id = e."messageId"
        AND m."broadcastId" = ${broadcastId}
        AND e.status IN ('PENDING', 'QUEUED', 'DELAYED')
    `;
  }

  /**
   * 세그먼트가 요구하는 파라미터가 왔는지 본다.
   *
   * 확장 크론이 이걸 발견하면 이미 상태가 EXPANDING 이고, 수신자 0명으로 "발송 완료"가 된다.
   * 운영자는 나갔다고 믿는다. 그래서 요청 시점에 400 으로 끊는다.
   */
  private assertSegmentInputs(dto: CreateBroadcastDto): void {
    const needsEvent: BroadcastSegment[] = [
      BroadcastSegment.EVENT_APPLICANTS,
      BroadcastSegment.EVENT_APPLICANTS_BY_STATUS,
      BroadcastSegment.EVENT_SELECTED,
      BroadcastSegment.EVENT_NOT_SELECTED,
    ];

    if (needsEvent.includes(dto.segment) && !dto.eventId) {
      throw new BadRequestException('이 세그먼트에는 eventId 가 필요합니다.');
    }
    if (
      dto.segment === BroadcastSegment.EVENT_APPLICANTS_BY_STATUS &&
      (dto.applicationStatuses?.length ?? 0) === 0
    ) {
      throw new BadRequestException('상태별 세그먼트에는 applicationStatuses 가 필요합니다.');
    }
    if (dto.segment === BroadcastSegment.REGION && !dto.regionCode) {
      throw new BadRequestException('REGION 세그먼트에는 regionCode 가 필요합니다.');
    }
    if (dto.segment === BroadcastSegment.CATEGORY_INTEREST && !dto.categoryId) {
      throw new BadRequestException('CATEGORY_INTEREST 세그먼트에는 categoryId 가 필요합니다.');
    }
    if (
      dto.segment === BroadcastSegment.EXPLICIT_USER_LIST &&
      (dto.userIds?.length ?? 0) === 0
    ) {
      throw new BadRequestException('EXPLICIT_USER_LIST 세그먼트에는 userIds 가 필요합니다.');
    }
  }
}
