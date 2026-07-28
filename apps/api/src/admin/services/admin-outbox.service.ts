import { Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  MessageKind,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { assertNoVisibilityLeak } from '@dibs/shared';

/** 알림 1건. Notification 행 + (주소가 있으면) EmailDelivery 아웃박스 행이 함께 만들어진다. */
export interface NotificationSeed {
  userId: string;
  type: NotificationType;
  category: NotificationCategory;
  priority?: NotificationPriority;
  titleKo: string;
  bodyKo: string;
  /** 수신자별로 유니크하면 된다. 같은 이벤트 키를 여러 명에게 써도 충돌하지 않는다. */
  dedupeKey: string;
  deepLinkPath?: string | null;
  eventId?: string | null;
  applicationId?: string | null;
  payload?: Record<string, unknown> | null;
}

export type FanoutSeed = Omit<NotificationSeed, 'userId'>;

/**
 * 트랜잭셔널 아웃박스. (IC-42)
 *
 * 운영자 모듈은 알림 모듈의 서비스를 주입하지 않는다 — 모듈은 DI 가 아니라 DB 로 이어져 있다.
 * 여기서 하는 일은 도메인 쓰기와 **같은 트랜잭션**에서 Notification / Message /
 * EmailDelivery(PENDING) 행을 넣는 것뿐이고, 실제 발송은 디스패치 크론이 집어 간다.
 * 트랜잭션 안에서 Resend 를 부르면 커밋이 실패해도 메일은 이미 나가 있다.
 */
@Injectable()
export class AdminOutboxService {
  /**
   * 1명에게 보낸다.
   *
   * 단건인데도 createMany(skipDuplicates)를 쓰는 이유: create 는 uq_notification_user_dedupe
   * 위반을 예외로 던지고, 그 예외가 같은 트랜잭션의 도메인 쓰기(예: 계정 정지)까지 롤백시킨다.
   * 중복 알림 하나 때문에 정지가 실패하는 건 우선순위가 완전히 뒤집힌 것이다. (IC-41)
   */
  async enqueue(tx: Prisma.TransactionClient, seed: NotificationSeed): Promise<void> {
    // 알림 payload 는 D-07 화이트리스트를 통과해야 한다. 타인의 금액·커트라인·본인 순위는
    // 어떤 타입에도 들어갈 수 없다. (IC-44)
    assertNoVisibilityLeak(seed.payload ?? {}, `Notification(${seed.type})`);

    await tx.notification.createMany({
      data: [
        {
          userId: seed.userId,
          type: seed.type,
          category: seed.category,
          priority: seed.priority ?? NotificationPriority.NORMAL,
          titleKo: seed.titleKo.slice(0, 120),
          bodyKo: seed.bodyKo,
          dedupeKey: seed.dedupeKey.slice(0, 200),
          deepLinkPath: seed.deepLinkPath ?? null,
          eventId: seed.eventId ?? null,
          applicationId: seed.applicationId ?? null,
          payload: (seed.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      ],
      skipDuplicates: true,
    });

    const notification = await tx.notification.findUnique({
      where: { userId_dedupeKey: { userId: seed.userId, dedupeKey: seed.dedupeKey.slice(0, 200) } },
      select: { id: true },
    });
    if (!notification) return;

    const recipient = await tx.user.findUnique({
      where: { id: seed.userId },
      select: { email: true, notificationEmail: true },
    });
    const toAddress = recipient?.notificationEmail ?? recipient?.email ?? null;
    // 주소가 없으면 이메일 아웃박스 행 자체를 만들지 않는다. PENDING 으로 넣어두면
    // 디스패치 크론이 매번 집어 들었다가 SKIPPED 로 되돌리는 일을 영원히 반복한다.
    if (!toAddress) return;

    await tx.emailDelivery.createMany({
      data: [
        {
          notificationId: notification.id,
          recipientUserId: seed.userId,
          status: DeliveryStatus.PENDING,
          toAddress,
          subjectKo: seed.titleKo.slice(0, 120),
          bodyText: seed.bodyKo,
        },
      ],
      skipDuplicates: true,
    });
  }

  /**
   * 여러 명에게 같은 알림을 보낸다. 개별 create 루프를 돌리지 않는다. (IC-41)
   * 반환값은 실제로 새로 삽입된 행 수 — 재실행 시 0이 정상이다.
   */
  async fanoutNotifications(
    tx: Prisma.TransactionClient,
    userIds: readonly string[],
    seed: FanoutSeed,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    assertNoVisibilityLeak(seed.payload ?? {}, `Notification(${seed.type})`);

    const dedupeKey = seed.dedupeKey.slice(0, 200);
    const { count } = await tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: seed.type,
        category: seed.category,
        priority: seed.priority ?? NotificationPriority.NORMAL,
        titleKo: seed.titleKo.slice(0, 120),
        bodyKo: seed.bodyKo,
        dedupeKey,
        deepLinkPath: seed.deepLinkPath ?? null,
        eventId: seed.eventId ?? null,
        applicationId: seed.applicationId ?? null,
        payload: (seed.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
      skipDuplicates: true,
    });

    return count;
  }

  /**
   * 팬아웃된 알림에 대한 이메일 아웃박스 행을 한 문장으로 만든다.
   *
   * createMany 는 생성된 id 를 돌려주지 않아서 애플리케이션에서 짝을 지을 수 없다.
   * 방금 넣은 Notification 을 (userId, dedupeKey)로 되짚어 INSERT ... SELECT 한다 —
   * 왕복 없이 같은 트랜잭션에서 끝난다.
   */
  async fanoutNotificationEmails(
    tx: Prisma.TransactionClient,
    userIds: readonly string[],
    dedupeKey: string,
  ): Promise<number> {
    if (userIds.length === 0) return 0;

    return tx.$executeRaw`
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
      WHERE n."dedupeKey" = ${dedupeKey.slice(0, 200)}
        AND n."userId" IN (${Prisma.join([...userIds])})
        AND COALESCE(u."notificationEmail", u.email) IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
  }

  /**
   * 공지 수신자 스냅샷(Message)을 물질화한다.
   * uq_message_broadcast_recipient 덕분에 재실행해도 사람마다 1행이다.
   */
  async fanoutBroadcastMessages(
    tx: Prisma.TransactionClient,
    userIds: readonly string[],
    broadcast: {
      id: string;
      titleKo: string;
      bodyKo: string;
      eventId: string | null;
      senderUserId: string;
      senderDisplayName: string;
    },
  ): Promise<number> {
    if (userIds.length === 0) return 0;

    const { count } = await tx.message.createMany({
      data: userIds.map((recipientUserId) => ({
        kind: MessageKind.ADMIN_BROADCAST,
        broadcastId: broadcast.id,
        eventId: broadcast.eventId,
        senderUserId: broadcast.senderUserId,
        senderDisplayName: broadcast.senderDisplayName,
        recipientUserId,
        titleKo: broadcast.titleKo.slice(0, 120),
        bodyKo: broadcast.bodyKo,
      })),
      skipDuplicates: true,
    });

    return count;
  }

  /** 공지 쪽지에 대한 이메일 아웃박스. Message 를 되짚어 한 문장으로 만든다. */
  async fanoutBroadcastEmails(
    tx: Prisma.TransactionClient,
    broadcastId: string,
    userIds: readonly string[],
  ): Promise<number> {
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
        AND m."recipientUserId" IN (${Prisma.join([...userIds])})
        AND COALESCE(u."notificationEmail", u.email) IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
  }
}
