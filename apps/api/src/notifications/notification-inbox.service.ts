import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { CursorPage } from '../common/dto/pagination.dto';
import type { NotificationListQueryDto } from './dto/notification.dto';
import {
  NOTIFICATION_INBOX_SELECT,
  type NotificationInboxRow,
} from './internal/inbox-view';

/**
 * 내 알림함. (D-07)
 *
 * 읽기 전용에 가까운 서비스지만 지켜야 하는 게 둘 있다.
 *
 * 1. **payload 를 내보내지 않는다.** 이유는 `internal/inbox-view.ts` 에 적어 두었다.
 * 2. **읽음 처리는 조건부 UPDATE 다.** `findUnique` 로 남의 알림인지 확인한 뒤 update 하면
 *    그 사이가 경합 창이고, 무엇보다 소유자 검사를 WHERE 절 밖에 두는 순간
 *    새 핸들러 하나가 그 검사를 빠뜨려도 아무도 모른다. userId 는 언제나 WHERE 안에 있다.
 */
@Injectable()
export class NotificationInboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    query: NotificationListQueryDto,
  ): Promise<CursorPage<NotificationInboxRow>> {
    const rows = await this.prisma.notification.findMany({
      where: this.inboxWhere(userId, query),
      // (userId, createdAt DESC) 인덱스를 그대로 탄다. id 는 같은 밀리초 동점을 깨는 보조 키다.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: NOTIFICATION_INBOX_SELECT,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * 배지 숫자. 알림과 쪽지를 함께 센다 — 사용자에게는 종 아이콘 하나뿐이라
   * 둘을 따로 세면 "1개 있다는데 눌러도 없다"가 된다.
   */
  async unreadCount(userId: string): Promise<{ notifications: number; messages: number; total: number }> {
    const now = new Date();

    const [notifications, messages] = await Promise.all([
      this.prisma.notification.count({
        where: {
          userId,
          readAt: null,
          deletedAt: null,
          archivedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      this.prisma.message.count({
        where: {
          recipientUserId: userId,
          readAt: null,
          deletedAt: null,
          archivedAt: null,
          status: 'DELIVERED',
        },
      }),
    ]);

    return { notifications, messages, total: notifications + messages };
  }

  /**
   * 한 건 읽음.
   *
   * 여기서 `assertAffected` 를 쓰지 않는 유일한 이유: 이미 읽은 알림을 다시 읽음 처리하는 것은
   * **경합이 아니라 정상 동작**이다(목록에서 두 번 탭). 409 를 돌려주면 클라이언트가
   * 에러 토스트를 띄운다. 대신 0행이면 존재 여부를 되짚어 404 와 "이미 읽음"을 구분한다.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<{ id: string; readAt: Date | null; alreadyRead: boolean }> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "Notification"
      SET "readAt" = now(), "updatedAt" = now()
      WHERE id = ${notificationId}
        AND "userId" = ${userId}
        AND "readAt" IS NULL
        AND "deletedAt" IS NULL
    `;

    const row = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId, deletedAt: null },
      select: { id: true, readAt: true },
    });

    if (!row) throw new NotFoundException('알림을 찾을 수 없습니다.');

    return { id: row.id, readAt: row.readAt, alreadyRead: affected === 0 };
  }

  /** 전부 읽음. 반환값은 이번 호출로 바뀐 행 수라 재호출하면 0이다. */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "Notification"
      SET "readAt" = now(), "updatedAt" = now()
      WHERE "userId" = ${userId} AND "readAt" IS NULL AND "deletedAt" IS NULL
    `;

    return { updated };
  }

  /**
   * 보관(숨기기). 삭제가 아니다 — 알림은 "언제 무엇을 통보했는가"의 증거라,
   * 예약금 미납 안내처럼 분쟁이 붙는 건은 물리 삭제하면 안 된다.
   */
  async archive(userId: string, notificationId: string): Promise<{ archived: boolean }> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "Notification"
      SET "archivedAt" = now(), "updatedAt" = now()
      WHERE id = ${notificationId}
        AND "userId" = ${userId}
        AND "archivedAt" IS NULL
        AND "deletedAt" IS NULL
    `;

    if (affected === 0) {
      const exists = await this.prisma.notification.count({
        where: { id: notificationId, userId, deletedAt: null },
      });
      if (exists === 0) throw new NotFoundException('알림을 찾을 수 없습니다.');
    }

    return { archived: true };
  }

  private inboxWhere(userId: string, query: NotificationListQueryDto): Prisma.NotificationWhereInput {
    return {
      userId,
      deletedAt: null,
      archivedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.unreadOnly ? { readAt: null } : {}),
      // 만료된 알림은 목록에서 뺀다. 지우지는 않는다 — 통보 사실 자체는 남아야 한다.
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };
  }
}
