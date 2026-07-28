import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuditController } from './admin-audit.controller';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBroadcastsController } from './admin-broadcasts.controller';
import { AdminBusinessesController } from './admin-businesses.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminEventOpsController } from './admin-event-ops.controller';
import { AdminPartnersController } from './admin-partners.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminVenuesController } from './admin-venues.controller';
import { AdminAuditViewerService } from './services/admin-audit-viewer.service';
import { AdminAuditService } from './services/admin-audit.service';
import { AdminBillingService } from './services/admin-billing.service';
import { AdminBroadcastsService } from './services/admin-broadcasts.service';
import { AdminBusinessesService } from './services/admin-businesses.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminEventsService } from './services/admin-events.service';
import { AdminOutboxService } from './services/admin-outbox.service';
import { AdminPartnersService } from './services/admin-partners.service';
import { AdminCategoriesService } from './services/admin-categories.service';
import { AdminSettingsService } from './services/admin-settings.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminVenuesService } from './services/admin-venues.service';

/**
 * 운영자 콘솔.
 *
 * 모든 엔드포인트가 `@Roles(UserRole.ADMIN)` 이고, 전역 JwtAuthGuard 위에서 돈다.
 * 컨트롤러를 도메인별로 쪼갠 이유는 권한이 아니라 **화면**이다 — 콘솔의 탭 하나가
 * 컨트롤러 하나에 대응해야 나중에 탭 단위로 권한을 세분화할 수 있다.
 *
 * 다른 도메인 모듈의 서비스는 주입하지 않는다. 결합은 전부 DB 를 통해서만 생긴다:
 *  - 알림 → `AdminOutboxService` 가 도메인 쓰기와 **같은 트랜잭션**에 아웃박스 행을 넣는다 (IC-42)
 *  - 감사 → `AdminAuditService` 가 같은 트랜잭션에 AuditLog 행을 잇는다 (IC-61)
 *  - 다른 애그리게이트 → Prisma 로 직접 읽고 쓴다
 *
 * 서비스 두 개(`AdminAuditService`, `AdminSettingsService`)만 export 한다.
 * 감사 기록기는 나중에 크론이 시스템 감사 행을 남길 때 필요하고, 설정 접근자는
 * 예약금 홀드 생성 시 `featureFlagSnapshot` 을 찍는 쪽이 필요로 한다(IC-65).
 * 나머지는 내보내지 않는다 — 내보내는 순간 다른 모듈이 운영자 로직을 우회해서 부를 수 있다.
 *
 * 이벤트 정지/해제/강제 취소는 여기 없다. 이벤트 모듈의 운영자 컨트롤러가
 * `statusBeforeSuspend` 왕복(IC-62)을 이미 구현하고 있고, 그 코드가 두 곳에 있으면 안 된다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    AdminDashboardController,
    AdminPartnersController,
    AdminBusinessesController,
    AdminVenuesController,
    AdminUsersController,
    AdminEventOpsController,
    AdminBroadcastsController,
    AdminCategoriesController,
    AdminSettingsController,
    AdminAuditController,
    AdminBillingController,
  ],
  providers: [
    AdminAuditService,
    AdminOutboxService,
    AdminCategoriesService,
    AdminSettingsService,
    AdminDashboardService,
    AdminPartnersService,
    AdminBusinessesService,
    AdminVenuesService,
    AdminUsersService,
    AdminEventsService,
    AdminBroadcastsService,
    AdminAuditViewerService,
    AdminBillingService,
  ],
  exports: [AdminAuditService, AdminSettingsService],
})
export class AdminModule {}
