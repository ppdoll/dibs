import { Prisma } from '@prisma/client';

/**
 * 수신함 응답 조립. (D-07, IC-05)
 *
 * ★ `payload` 를 절대 담지 않는다.
 *
 * payload 는 템플릿이 문구를 만들 때 쓰는 입력이고, 타입별 zod 스키마와
 * assertNoVisibilityLeak 을 통과한 값들이다 — 즉 **그 알림 타입 안에서는** 안전하다.
 * 하지만 수신함은 타입을 가리지 않고 전부 쏟아내는 곳이라, 새 템플릿 하나가
 * allowPayloadKeys 를 잘못 넓히는 순간 그 값이 목록 API 로 그대로 흘러나간다.
 * 사용자가 알아야 할 내용은 이미 titleKo/bodyKo 안에 렌더링돼 있으므로 payload 를
 * 내보낼 이유가 없다. 안 담는 쪽이 방어가 아니라 기본값이어야 한다.
 */
export const NOTIFICATION_INBOX_SELECT = {
  id: true,
  type: true,
  category: true,
  priority: true,
  titleKo: true,
  bodyKo: true,
  deepLinkPath: true,
  eventId: true,
  applicationId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationInboxRow = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_INBOX_SELECT;
}>;

/**
 * 쪽지는 사람이 쓴 글이라 payload 자체가 없다. 대신 발신자 표시명을 스냅샷으로 들고 있다 —
 * 파트너가 상호를 바꿔도 "보낸 당시의 이름"이 남아야 분쟁에서 대조가 된다.
 */
export const MESSAGE_INBOX_SELECT = {
  id: true,
  kind: true,
  eventId: true,
  senderDisplayName: true,
  titleKo: true,
  bodyKo: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.MessageSelect;

export type MessageInboxRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_INBOX_SELECT }>;
