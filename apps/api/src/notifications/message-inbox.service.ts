import { Injectable, NotFoundException } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { CursorPage } from '../common/dto/pagination.dto';
import type { MessageListQueryDto } from './dto/message.dto';
import { MESSAGE_INBOX_SELECT, type MessageInboxRow } from './internal/inbox-view';

/**
 * 내 쪽지함. (D-10)
 *
 * 알림함과 나누어 둔 이유: 쪽지는 **사람이 쓴 글**이고 알림은 시스템이 만든 통보다.
 * 한 테이블로 합치면 파트너가 쓴 자유 문구와 zod 검증을 통과한 템플릿 문구가 같은
 * 파이프를 타게 되고, D-07 검사를 어디에 걸어야 하는지가 흐려진다.
 *
 * `status = DELIVERED` 만 보여준다. SKIPPED/BLOCKED 행은 "왜 이 사람에게 안 갔는가"를
 * 남긴 발송 기록이지 수신함 항목이 아니다 — 수신자에게 보이면 안 되는 것도 있다
 * (운영정책 위반으로 차단된 파트너 공지가 대표적이다).
 */
@Injectable()
export class MessageInboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: MessageListQueryDto): Promise<CursorPage<MessageInboxRow>> {
    const rows = await this.prisma.message.findMany({
      where: {
        recipientUserId: userId,
        status: MessageStatus.DELIVERED,
        deletedAt: null,
        archivedAt: null,
        ...(query.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: MESSAGE_INBOX_SELECT,
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
   * 상세. 열었다고 자동으로 읽음 처리하지 않는다.
   *
   * 목록에서 미리보기로 이 API 를 호출하는 화면이 하나만 생겨도 안 읽은 쪽지가 전부 사라진다.
   * 읽음은 사용자의 명시적 동작이므로 엔드포인트를 따로 둔다.
   */
  async get(userId: string, messageId: string): Promise<MessageInboxRow> {
    const row = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        recipientUserId: userId,
        status: MessageStatus.DELIVERED,
        deletedAt: null,
      },
      select: MESSAGE_INBOX_SELECT,
    });

    if (!row) throw new NotFoundException('쪽지를 찾을 수 없습니다.');

    return row;
  }

  /** 읽음 처리. 소유자 검사는 WHERE 절 안에 있다. */
  async markRead(
    userId: string,
    messageId: string,
  ): Promise<{ id: string; readAt: Date | null; alreadyRead: boolean }> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "Message"
      SET "readAt" = now(), "updatedAt" = now()
      WHERE id = ${messageId}
        AND "recipientUserId" = ${userId}
        AND "readAt" IS NULL
        AND "deletedAt" IS NULL
        AND status = 'DELIVERED'
    `;

    const row = await this.prisma.message.findFirst({
      where: { id: messageId, recipientUserId: userId, deletedAt: null },
      select: { id: true, readAt: true },
    });

    if (!row) throw new NotFoundException('쪽지를 찾을 수 없습니다.');

    return { id: row.id, readAt: row.readAt, alreadyRead: affected === 0 };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "Message"
      SET "readAt" = now(), "updatedAt" = now()
      WHERE "recipientUserId" = ${userId}
        AND "readAt" IS NULL
        AND "deletedAt" IS NULL
        AND status = 'DELIVERED'
    `;

    return { updated };
  }
}
