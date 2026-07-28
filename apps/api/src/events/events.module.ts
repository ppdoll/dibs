import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { EventImagesController } from './event-images.controller';
import { EventImagesService } from './event-images.service';
import { EventLifecycleService } from './event-lifecycle.service';
import { EventStatsService } from './event-stats.service';
import { EventUpdateService } from './event-update.service';
import { EventsAdminController } from './events-admin.controller';
import { EventsCronController } from './events-cron.controller';
import { EventsPublicController } from './events-public.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventAuditService } from './internal/event-audit.service';
import { EventBlobService } from './internal/event-blob.service';

/**
 * 이벤트(오퍼) 애그리게이트. INSTANT/BID 두 모드를 한 모델로 담는다. (D-02)
 *
 * 서비스를 다섯으로 쪼갠 기준은 "무엇을 잠그는가"다:
 *  - EventsService        생성·조회 (락 없음)
 *  - EventUpdateService   If-Match 낙관적 락 (IC-63) + 진행 중 잠금 (IC-64, IC-26)
 *  - EventLifecycleService 상태 전이. 감사 체인 자문 락을 잡는다 (IC-02, IC-61, IC-62)
 *  - EventImagesService   Blob 핸드셰이크 + 부분 유니크 아래의 2단계 순서 재배치
 *  - EventStatsService    크론 전용 집계 캐시. 신청 hot path 는 절대 건드리지 않는다(IC-53)
 *
 * 다른 모듈의 서비스는 주입하지 않는다. 알림은 아웃박스 행(IC-42), 감사는 같은 트랜잭션의
 * AuditLog 행(IC-61), 다른 애그리게이트 조회는 Prisma 직접 — 결합은 전부 DB 를 통해서만 생긴다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    EventsController,
    EventsPublicController,
    EventImagesController,
    EventsAdminController,
    EventsCronController,
  ],
  providers: [
    EventsService,
    EventUpdateService,
    EventLifecycleService,
    EventImagesService,
    EventStatsService,
    EventAuditService,
    EventBlobService,
  ],
  // 검색·선정 모듈이 공개 노출 술어(PUBLIC_EVENT_WHERE)를 상수로 import 하므로
  // 서비스는 내보내지 않는다 — 서비스를 내보내는 순간 모듈 간 결합이 생긴다.
  exports: [],
})
export class EventsModule {}
