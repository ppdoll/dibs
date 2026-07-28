import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  AuditActorRole,
  AuditTargetType,
  BroadcastSegment,
  BroadcastStatus,
  MessageKind,
  MessageStatus,
  NotificationCategory,
  NotificationChannel,
  Prisma,
  UserRole,
  type ApplicationStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { fetchAudiencePage, type AudienceSpec } from './internal/audience';
import { acquireAuditChainLock, appendAuditLog, broadcastChainKey, type Tx } from './internal/audit';

/**
 * 한 번에 펼치는 수신자 수.
 *
 * 200 인 이유는 두 가지 상한 사이다. 너무 작으면 10만 명 공지가 크론 500번을 잡아먹고,
 * 너무 크면 createMany + INSERT..SELECT 두 문장이 함수 타임아웃(vercel.json: 30s)을 넘겨
 * 트랜잭션이 통째로 롤백된다 — 그러면 커서가 안 움직여서 **영원히 같은 페이지만 재시도한다**.
 */
const PAGE_SIZE = 200;

/** 한 번의 크론 호출이 손대는 공지 수. 공지 하나가 크론을 독점하지 못하게 한다. */
const MAX_BROADCASTS_PER_RUN = 5;

interface ClaimedBroadcast {
  id: string;
  segment: BroadcastSegment;
  status: BroadcastStatus;
  eventId: string | null;
  applicationStatuses: ApplicationStatus[];
  segmentFilter: Prisma.JsonValue | null;
  titleKo: string;
  bodyKo: string;
  category: NotificationCategory;
  channels: NotificationChannel[];
  senderUserId: string;
  senderRole: UserRole;
  senderDisplayName: string | null;
  expansionCursor: string | null;
}

export interface PumpResult {
  broadcastId: string;
  created: number;
  scanned: number;
  done: boolean;
}

/**
 * 공지 수신자 확장 워커. (D-10)
 *
 * 공지 발송을 요청-응답 안에서 끝내지 않는 이유는 하나다 — 전체 유저 세그먼트는
 * 수십만 행이고 Vercel 함수는 60초에 죽는다. 죽은 자리에서 이어갈 방법이 없으면
 * 공지가 절반만 나간 채 굳고, 다시 보내면 앞의 절반이 두 번 받는다.
 *
 * 그래서 상태를 DB 에 둔다: `expansionCursor` 가 마지막으로 처리한 userId 이고,
 * 재실행은 언제나 그 뒤부터다. 수신자 행(`Message`)은
 * `uq_message_broadcast_recipient` 로 사람당 1행이 보장되므로, 커서를 갱신하기 전에
 * 함수가 죽어 같은 페이지를 다시 펼쳐도 두 번 받지 않는다(IC-41).
 */
@Injectable()
export class BroadcastExpanderService {
  private readonly logger = new Logger(BroadcastExpanderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 크론 진입점. 예약 시각이 지났거나 확장 중인 공지를 이어서 펼친다. */
  async pumpDue(): Promise<{ processed: PumpResult[] }> {
    const due = await this.prisma.broadcast.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: BroadcastStatus.EXPANDING },
          { status: BroadcastStatus.SENDING },
          { status: BroadcastStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_BROADCASTS_PER_RUN,
      select: { id: true },
    });

    const processed: PumpResult[] = [];
    for (const row of due) {
      processed.push(await this.pumpOne(row.id));
    }

    return { processed };
  }

  /**
   * 한 공지의 다음 페이지를 펼친다. 마지막 페이지였으면 발송 완료로 닫는다.
   *
   * 페이지 작업과 완료 처리를 **다른 트랜잭션**으로 나눈 이유는 IC-02 다.
   * 완료 처리에는 감사 행이 붙고, 감사 행을 쓰는 트랜잭션은 자문 락이 첫 문장이어야 한다.
   * 그 락을 페이지 작업까지 끌고 가면 20만 행 팬아웃 내내 같은 체인의 다른 쓰기가 막힌다.
   */
  async pumpOne(broadcastId: string): Promise<PumpResult> {
    const page = await this.pumpPage(broadcastId);
    if (page.done) await this.finalize(broadcastId);

    return page;
  }

  private async pumpPage(broadcastId: string): Promise<PumpResult> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await this.claim(tx, broadcastId);
      if (!claimed) return { broadcastId, created: 0, scanned: 0, done: false };

      const rows = await fetchAudiencePage(
        tx,
        this.toSpec(claimed),
        claimed.expansionCursor,
        PAGE_SIZE,
      );

      if (rows.length === 0) return { broadcastId, created: 0, scanned: 0, done: true };

      const created = await this.materializeMessages(tx, claimed, rows);
      const emailed = claimed.channels.includes(NotificationChannel.EMAIL)
        ? await this.materializeEmails(tx, claimed.id, rows.map((row) => row.userId))
        : 0;

      const lastUserId = rows[rows.length - 1]?.userId ?? claimed.expansionCursor;

      await tx.broadcast.update({
        where: { id: claimed.id },
        data: {
          status: BroadcastStatus.SENDING,
          expansionCursor: lastUserId,
          totalRecipients: { increment: rows.length },
          sentCount: { increment: created },
        },
      });

      this.logger.log(
        `공지 ${claimed.id} 확장: 대상 ${rows.length}명, 쪽지 ${created}건, 메일 ${emailed}건`,
      );

      // 정확히 한 페이지를 채웠으면 뒤에 더 있을 수 있다. 다음 크론이 이어 간다.
      return { broadcastId, created, scanned: rows.length, done: rows.length < PAGE_SIZE };
    });
  }

  /**
   * 발송 완료로 닫는다. 자문 락이 트랜잭션의 첫 문장이다(IC-02).
   *
   * 조건부 UPDATE 의 행 수를 본다 — 0행이면 그 사이에 운영자가 취소했거나 다른 크론이
   * 먼저 닫은 것이고, 그때 감사 행을 쓰면 "취소된 공지가 발송 완료됐다"는 기록이 남는다.
   */
  private async finalize(broadcastId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await acquireAuditChainLock(tx, broadcastChainKey(broadcastId));

      const { count } = await tx.broadcast.updateMany({
        where: {
          id: broadcastId,
          status: { in: [BroadcastStatus.SENDING, BroadcastStatus.EXPANDING] },
        },
        data: { status: BroadcastStatus.SENT },
      });

      if (count !== 1) return;

      const broadcast = await tx.broadcast.findUnique({
        where: { id: broadcastId },
        select: {
          senderUserId: true,
          senderRole: true,
          segment: true,
          eventId: true,
          totalRecipients: true,
          sentCount: true,
          sender: { select: { displayName: true } },
        },
      });
      if (!broadcast) return;

      await appendAuditLog(tx, {
        actorUserId: broadcast.senderUserId,
        actorRole:
          broadcast.senderRole === UserRole.ADMIN ? AuditActorRole.ADMIN : AuditActorRole.PARTNER,
        actorLabel: broadcast.sender.displayName,
        action: AuditAction.BROADCAST_SENT,
        targetType: AuditTargetType.BROADCAST,
        targetId: broadcastId,
        summary: `공지 발송 완료 — 세그먼트 ${broadcast.segment}, 수신자 ${broadcast.totalRecipients}명`,
        chainKey: broadcastChainKey(broadcastId),
        afterJson: {
          segment: broadcast.segment,
          eventId: broadcast.eventId,
          totalRecipients: broadcast.totalRecipients,
          sentCount: broadcast.sentCount,
        },
        // 크론이 겹쳐 돌아도 완료 감사 행은 공지당 하나다.
        idempotencyKey: `broadcast-sent:${broadcastId}`,
      });
    });
  }

  /**
   * 발송 통계 대사.
   *
   * `sentCount` 는 "쪽지를 만든 수"지 "메일이 도착한 수"가 아니다. 실제 스킵·실패는
   * 디스패처가 나중에 기록하므로, 완료 시점에 세면 전부 0 이다. 최근 공지만 되짚어 채운다.
   */
  async reconcileCounters(): Promise<{ updated: number }> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "Broadcast" b
      SET "suppressedCount" = agg.skipped,
          "failedCount" = agg.failed,
          "updatedAt" = now()
      FROM (
        SELECT m."broadcastId" AS id,
               count(*) FILTER (WHERE e.status = 'SKIPPED') AS skipped,
               count(*) FILTER (WHERE e.status = 'FAILED')  AS failed
        FROM "Message" m
        JOIN "EmailDelivery" e ON e."messageId" = m.id
        WHERE m."broadcastId" IS NOT NULL
        GROUP BY m."broadcastId"
      ) agg
      WHERE b.id = agg.id
        AND b."createdAt" > now() - interval '7 days'
        AND (b."suppressedCount" <> agg.skipped OR b."failedCount" <> agg.failed)
    `;

    return { updated };
  }

  /**
   * 확장 대상을 잡는다. `FOR UPDATE SKIP LOCKED` 라 동시에 돈 크론끼리 같은 공지를 두 번 펼치지 않는다.
   * 예약 시각 검사도 여기 WHERE 안에 있다 — 서비스에서 먼저 확인하면 그 사이가 경합 창이다.
   */
  private async claim(tx: Tx, broadcastId: string): Promise<ClaimedBroadcast | null> {
    const rows = await tx.$queryRaw<ClaimedBroadcast[]>`
      SELECT b.id, b.segment, b.status, b."eventId", b."applicationStatuses", b."segmentFilter",
             b."titleKo", b."bodyKo", b.category, b.channels, b."senderUserId", b."senderRole",
             u."displayName" AS "senderDisplayName", b."expansionCursor"
      FROM "Broadcast" b
      JOIN "User" u ON u.id = b."senderUserId"
      WHERE b.id = ${broadcastId}
        AND b."deletedAt" IS NULL
        AND (
          b.status IN ('EXPANDING', 'SENDING')
          OR (b.status = 'SCHEDULED' AND (b."scheduledAt" IS NULL OR b."scheduledAt" <= now()))
        )
      FOR UPDATE OF b SKIP LOCKED
    `;

    return rows[0] ?? null;
  }

  private toSpec(broadcast: ClaimedBroadcast): AudienceSpec {
    // segmentFilter 는 Json 이라 무엇이든 들어올 수 있다. 아래 asString/asNumber 가
    // 값마다 다시 확인하므로 여기서는 통째로 넓히기만 한다.
    const filter = (broadcast.segmentFilter ?? {}) as unknown as Record<string, unknown>;

    return {
      segment: broadcast.segment,
      eventId: broadcast.eventId,
      applicationStatuses: broadcast.applicationStatuses,
      // 광고성 공지는 인앱 수신 동의자에게만 물질화한다. 이메일 쪽 동의는 발송 게이트가 따로 본다 —
      // 여기서 걸러야 쪽지함에도 광고가 안 쌓인다.
      requireMarketingConsent: broadcast.category === NotificationCategory.MARKETING,
      excludeBlockedByPartnerId: asString(filter.partnerProfileId),
      regionCode: asString(filter.regionCode),
      categoryId: asString(filter.categoryId),
      explicitUserIds: asStringArray(filter.userIds),
      inactiveSinceDays: asNumber(filter.inactiveSinceDays),
    };
  }

  /**
   * 수신자 스냅샷(Message)을 만든다. 개별 create 를 루프로 돌리지 않는다. (IC-41)
   *
   * `skipDuplicates` 가 없으면 재실행이 유니크 위반으로 터지고, 그 예외가
   * 커서 갱신까지 롤백시켜 같은 페이지를 영원히 재시도하게 만든다.
   */
  private async materializeMessages(
    tx: Tx,
    broadcast: ClaimedBroadcast,
    rows: { userId: string; applicationStatus: ApplicationStatus | null }[],
  ): Promise<number> {
    const kind =
      broadcast.senderRole === UserRole.ADMIN ? MessageKind.ADMIN_BROADCAST : MessageKind.PARTNER_EVENT;

    const { count } = await tx.message.createMany({
      data: rows.map((row) => ({
        kind,
        broadcastId: broadcast.id,
        eventId: broadcast.eventId,
        senderUserId: broadcast.senderUserId,
        senderDisplayName: broadcast.senderDisplayName,
        recipientUserId: row.userId,
        titleKo: broadcast.titleKo.slice(0, 120),
        bodyKo: broadcast.bodyKo,
        status: MessageStatus.DELIVERED,
        // "보낼 당시 신청 상태". 나중에 상태가 바뀌어도 왜 이 사람이 받았는지 되짚을 수 있다.
        applicationStatusAtSend: row.applicationStatus,
      })),
      skipDuplicates: true,
    });

    return count;
  }

  /**
   * 이메일 아웃박스를 한 문장으로 만든다.
   *
   * `createMany` 는 생성된 id 를 돌려주지 않아 애플리케이션에서 Message 와 짝지을 수 없다.
   * 방금 넣은 행을 되짚어 INSERT..SELECT 하면 왕복 없이 같은 트랜잭션에서 끝난다.
   * 수신 거부·차단 판정은 여기서 하지 않는다 — 발송 시점의 설정으로 판단해야 하므로
   * 디스패처의 게이트가 본다(그래서 SKIPPED 사유가 행에 남는다).
   */
  private async materializeEmails(tx: Tx, broadcastId: string, userIds: string[]): Promise<number> {
    if (userIds.length === 0) return 0;

    return tx.$executeRaw`
      INSERT INTO "EmailDelivery" (
        "id", "messageId", "recipientUserId", "channel", "status",
        "toAddress", "subjectKo", "bodyText", "idempotencyKey", "updatedAt"
      )
      SELECT
        gen_random_uuid()::text, m.id, m."recipientUserId",
        'EMAIL'::"NotificationChannel", 'PENDING'::"DeliveryStatus",
        COALESCE(u."notificationEmail", u.email), m."titleKo", m."bodyKo",
        gen_random_uuid()::text, now()
      FROM "Message" m
      JOIN "User" u ON u.id = m."recipientUserId"
      WHERE m."broadcastId" = ${broadcastId}
        AND m."recipientUserId" IN (${Prisma.join(userIds)})
        AND m.status = 'DELIVERED'
        AND COALESCE(u."notificationEmail", u.email) IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
