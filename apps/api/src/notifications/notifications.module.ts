import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BroadcastExpanderService } from './broadcast-expander.service';
import { BroadcastService } from './broadcast.service';
import { BroadcastsAdminController } from './broadcasts-admin.controller';
import { EmailWebhookService } from './email-webhook.service';
import { MessageInboxService } from './message-inbox.service';
import { MessagesController } from './messages.controller';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsCronController } from './notifications-cron.controller';
import { PartnerEventMessagesController } from './partner-event-messages.controller';
import { ResendMailer } from './email/resend.mailer';
import { ResendWebhookController } from './resend-webhook.controller';

/**
 * 알림·쪽지 모듈. (D-10, IC-4)
 *
 * 밖으로 **아무 서비스도 export 하지 않는다.** 다른 도메인 모듈이 알림을 보내는 방법은
 * 자기 트랜잭션 안에서 `tx.notification.createMany(...)` / `tx.emailDelivery.createMany(...)` 를
 * 직접 쓰는 것뿐이다(트랜잭셔널 아웃박스, IC-42). 여기서 `NotificationService` 를 export 해
 * 주입시키면 두 가지가 동시에 깨진다 — 모듈이 DI 로 얽혀 순환이 생기고, 무엇보다 호출부가
 * 자기 트랜잭션 밖에서 알림을 만들 수 있게 되어 "커밋은 롤백됐는데 메일은 나갔다"가 가능해진다.
 *
 * 이 모듈이 하는 일은 셋이다.
 *   - 수신함 읽기(알림/쪽지)와 설정
 *   - 아웃박스를 실제 메일로 바꾸는 디스패처 + 프로바이더 웹훅 반영
 *   - 사람이 쓴 발송(운영자 공지 / 파트너 → 자기 이벤트 신청자)
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    NotificationsController,
    MessagesController,
    PartnerEventMessagesController,
    BroadcastsAdminController,
    NotificationsCronController,
    ResendWebhookController,
  ],
  providers: [
    NotificationInboxService,
    MessageInboxService,
    NotificationPreferencesService,
    NotificationDispatchService,
    EmailWebhookService,
    BroadcastService,
    BroadcastExpanderService,
    ResendMailer,
  ],
  exports: [],
})
export class NotificationsModule {}
