import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  AuditAction,
  AuditTargetType,
  EventCloseReason,
  EventStatus,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { toCursorPage } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertVersionMatch, auditChainKey } from '../admin.internals';
import type { EventOpsQueryDto, ExtendDeadlineDto, ForceCloseEventDto } from '../dto/event-ops-admin.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminOutboxService } from './admin-outbox.service';

/** 아직 살아 있는 신청. 마감 연장 통보를 받아야 하는 사람들이기도 하다. */
const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.PENDING_DEPOSIT,
  ApplicationStatus.VALID,
  ApplicationStatus.CONFIRMED,
];

/**
 * 한 번의 연장 통보로 팬아웃할 최대 인원.
 *
 * Vercel 함수 타임아웃 안에서 끝나야 하는 트랜잭션이라 상한이 필요하다.
 * 넘치면 알림을 포기하는 대신 로그로 남긴다 — 마감 연장 자체를 실패시키는 것보다
 * "연장은 됐는데 일부에게 통보가 늦었다"가 낫다(연장은 되돌릴 수 없다).
 */
const DEADLINE_FANOUT_LIMIT = 5_000;

const EVENT_OPS_SELECT = {
  id: true,
  title: true,
  mode: true,
  status: true,
  statusBeforeSuspend: true,
  capacity: true,
  claimedCount: true,
  liveApplicantCount: true,
  applyStartAt: true,
  applyEndAt: true,
  originalApplyEndAt: true,
  rankingLockAt: true,
  closedAt: true,
  closeReason: true,
  canceledAt: true,
  suspendedAt: true,
  suspendedReason: true,
  version: true,
  policyVersion: true,
  partnerId: true,
  venueId: true,
  createdAt: true,
} satisfies Prisma.EventSelect;

/**
 * 운영자의 이벤트 개입 — 강제 마감과 마감 연장.
 *
 * 정지/해제(= 사실상의 이벤트 비공개)와 강제 취소는 이벤트 모듈의
 * `admin/events/:eventId/{suspend,unsuspend,cancel}` 이 이미 IC-62 왕복으로 구현하고 있다.
 * 같은 전이를 여기에 한 벌 더 두지 않는 이유가 바로 IC-62 다 —
 * `statusBeforeSuspend` 를 다루는 코드가 두 곳이면 한쪽만 고쳐지는 날이 오고,
 * 그날 해제는 이벤트를 엉뚱한 상태로 되살린다.
 */
@Injectable()
export class AdminEventsService {
  private readonly logger = new Logger(AdminEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly outbox: AdminOutboxService,
  ) {}

  async list(query: EventOpsQueryDto) {
    const rows = await this.prisma.event.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.partnerId ? { partnerId: query.partnerId } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.q ? { title: { contains: query.q, mode: Prisma.QueryMode.insensitive } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: EVENT_OPS_SELECT,
    });

    return toCursorPage(rows, query.limit);
  }

  async getDetail(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        ...EVENT_OPS_SELECT,
        description: true,
        depositRequired: true,
        depositWindowMinutes: true,
        softCloseEnabled: true,
        softCloseExtensionCount: true,
        softCloseHardEndAt: true,
        partner: { select: { id: true, userId: true, contactName: true } },
        venue: { select: { id: true, name: true, status: true } },
      },
    });

    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    return event;
  }

  /**
   * 강제 마감. OPEN → CLOSED.
   *
   * `applyEndAt` 을 당기지 않는다(파트너 조기 마감과 같은 이유): 막아야 하는 것은 **새 신청**이고,
   * 이미 예약금 시계가 돌고 있는 사람의 10분은 그대로 남아야 한다(D-04/D-05).
   * applyEndAt 을 now() 로 당기면 rankingLockAt 이 함께 당겨져 아직 유효한 홀드를 남긴 채
   * 순위가 확정된다 — IC-26 이 막는 바로 그 상황이다.
   *
   * If-Match 를 요구하는 이유: 마감은 되돌릴 수 없다. 운영자가 보던 화면과 실제 상태가
   * 어긋난 채로 마감이 나가면 복구할 방법이 없다.
   */
  async forceClose(admin: AuthenticatedUser, eventId: string, dto: ForceCloseEventDto) {
    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      // 이벤트에 매달린 감사 행은 event:{id} 샤드다. 락이 트랜잭션의 첫 문장이다. (IC-61 / IC-02)
      await this.audit.lockEvent(tx, eventId);

      const before = await this.loadForOps(tx, eventId);

      const affected = await tx.$executeRaw`
        UPDATE "Event" e SET
          status = 'CLOSED'::"EventStatus",
          "closedAt" = now(),
          "closeReason" = ${EventCloseReason.ADMIN_FORCED}::"EventCloseReason",
          "version" = e."version" + 1,
          "updatedAt" = now()
        WHERE e.id = ${eventId}
          AND e."deletedAt" IS NULL
          AND e.status = 'OPEN'
          AND e."version" = ${dto.ifMatchVersion}
      `;

      assertVersionMatch(affected, 'EVENT_NOT_CLOSEABLE');

      await this.audit.append(tx, admin, {
        action: AuditAction.EVENT_FORCE_CLOSED,
        targetType: AuditTargetType.EVENT,
        targetId: eventId,
        targetOwnerUserId: before.partner.userId,
        chainKey: auditChainKey(AuditTargetType.EVENT, eventId),
        summary: `운영자 강제 마감: ${dto.reason}`,
        before: { status: before.status, version: before.version },
        after: { status: EventStatus.CLOSED, closeReason: EventCloseReason.ADMIN_FORCED },
        reasonCode: EventCloseReason.ADMIN_FORCED,
        reasonMemo: dto.reason,
        correlationId,
      });

      // 신청자에게는 알리지 않는다 — 마감은 원래 예정된 일이고, 강제 마감 사유는
      // 파트너와 운영자 사이의 이야기다(D-07 의 취지와 같다).
      await this.outbox.enqueue(tx, {
        userId: before.partner.userId,
        type: NotificationType.ADMIN_ANNOUNCEMENT,
        category: NotificationCategory.EVENT_CHANGE,
        priority: NotificationPriority.CRITICAL,
        titleKo: '이벤트가 운영자에 의해 마감되었습니다',
        bodyKo: `[${before.title}] 사유: ${dto.reason}\n이미 접수된 신청은 그대로 유지되며, 예약금 시계도 남은 시간만큼 계속 흐릅니다.`,
        deepLinkPath: `/partner/events/${eventId}`,
        eventId,
        dedupeKey: `EVENT_FORCE_CLOSED:${correlationId}`,
      });

      return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: EVENT_OPS_SELECT });
    });
  }

  /**
   * 마감 연장.
   *
   * 세 값을 한 문장에서 함께 옮긴다 — `applyEndAt`, `rankingLockAt`, `version`.
   * rankingLockAt 을 같이 밀지 않으면 마감은 늦춰졌는데 순위 확정은 원래 시각에 일어나서,
   * 연장 구간에 들어온 신청이 집계에서 통째로 빠진다(D-04).
   * `originalApplyEndAt` 은 COALESCE 로 최초 1회만 남긴다 — 여러 번 연장해도
   * "원래 언제였는가"는 하나여야 한다.
   *
   * 값을 SQL 안에서 계산하는 이유는 IC-04 다. JS 의 Date 는 밀리초라
   * Timestamptz(6) 컬럼에 넣는 순간 마이크로초가 잘리고, 그 컬럼은 순위 확정 시각이다.
   */
  async extendDeadline(admin: AuthenticatedUser, eventId: string, dto: ExtendDeadlineDto) {
    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lockEvent(tx, eventId);

      const before = await this.loadForOps(tx, eventId);

      const affected = await tx.$executeRaw`
        UPDATE "Event" e SET
          "originalApplyEndAt" = COALESCE(e."originalApplyEndAt", e."applyEndAt"),
          "applyEndAt" = e."applyEndAt" + make_interval(mins => ${dto.extendMinutes}::int),
          "rankingLockAt" = e."applyEndAt" + make_interval(
            mins => ${dto.extendMinutes}::int
                  + CASE WHEN e."depositRequired" THEN e."depositWindowMinutes" ELSE 0 END
                  + 1
          ),
          "version" = e."version" + 1,
          "updatedAt" = now()
        WHERE e.id = ${eventId}
          AND e."deletedAt" IS NULL
          AND e.status IN ('SCHEDULED','OPEN')
          AND e."version" = ${dto.ifMatchVersion}
      `;

      assertVersionMatch(affected, 'EVENT_NOT_EXTENDABLE');

      const after = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
        select: { applyEndAt: true, rankingLockAt: true },
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.EVENT_DEADLINE_EXTENDED,
        targetType: AuditTargetType.EVENT,
        targetId: eventId,
        targetOwnerUserId: before.partner.userId,
        chainKey: auditChainKey(AuditTargetType.EVENT, eventId),
        summary: `운영자 마감 연장 ${dto.extendMinutes}분: ${dto.reason}`,
        before: { applyEndAt: before.applyEndAt.toISOString(), version: before.version },
        after: { applyEndAt: after.applyEndAt.toISOString() },
        reasonMemo: dto.reason,
        correlationId,
      });

      await this.notifyDeadlineExtended(tx, {
        eventId,
        title: before.title,
        partnerUserId: before.partner.userId,
        newApplyEndAt: after.applyEndAt,
        correlationId,
      });

      return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: EVENT_OPS_SELECT });
    });
  }

  /**
   * 연장 통보 팬아웃.
   *
   * 문구와 payload 에 금액·순위·커트라인이 한 글자도 들어가지 않는다(D-07 / IC-44).
   * "마감이 언제로 밀렸는가"는 모두에게 똑같이 공개되는 정보라 실어도 된다.
   */
  private async notifyDeadlineExtended(
    tx: Prisma.TransactionClient,
    input: {
      eventId: string;
      title: string;
      partnerUserId: string;
      newApplyEndAt: Date;
      correlationId: string;
    },
  ): Promise<void> {
    const applicants = await tx.application.findMany({
      where: { eventId: input.eventId, status: { in: ACTIVE_APPLICATION_STATUSES } },
      select: { userId: true },
      take: DEADLINE_FANOUT_LIMIT + 1,
    });

    if (applicants.length > DEADLINE_FANOUT_LIMIT) {
      this.logger.warn(
        `이벤트 ${input.eventId} 의 연장 통보 대상이 ${DEADLINE_FANOUT_LIMIT}명을 넘어 일부에게 보내지 않았습니다.`,
      );
    }

    const userIds = [...new Set(applicants.slice(0, DEADLINE_FANOUT_LIMIT).map((a) => a.userId))];
    const dedupeKey = `${NotificationType.DEADLINE_EXTENDED}:${input.correlationId}`;

    await this.outbox.fanoutNotifications(tx, userIds, {
      type: NotificationType.DEADLINE_EXTENDED,
      category: NotificationCategory.EVENT_CHANGE,
      priority: NotificationPriority.HIGH,
      titleKo: '신청 마감이 연장되었습니다',
      bodyKo: `[${input.title}] 신청 마감이 ${input.newApplyEndAt.toISOString()} 로 연장되었습니다.`,
      dedupeKey,
      deepLinkPath: `/events/${input.eventId}`,
      eventId: input.eventId,
      payload: { eventId: input.eventId, newApplyEndAt: input.newApplyEndAt.toISOString() },
    });

    await this.outbox.fanoutNotificationEmails(tx, userIds, dedupeKey);

    await this.outbox.enqueue(tx, {
      userId: input.partnerUserId,
      type: NotificationType.DEADLINE_EXTENDED,
      category: NotificationCategory.EVENT_CHANGE,
      priority: NotificationPriority.HIGH,
      titleKo: '운영자가 이벤트 마감을 연장했습니다',
      bodyKo: `[${input.title}] 새 마감: ${input.newApplyEndAt.toISOString()}`,
      dedupeKey: `PARTNER_${dedupeKey}`,
      deepLinkPath: `/partner/events/${input.eventId}`,
      eventId: input.eventId,
    });
  }

  private async loadForOps(tx: Prisma.TransactionClient, eventId: string) {
    const event = await tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        version: true,
        applyEndAt: true,
        partner: { select: { userId: true } },
      },
    });

    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    return event;
  }
}
