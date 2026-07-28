import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AdminModule } from './admin/admin.module';
import { ApplicationsModule } from './applications/applications.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { PartnersModule } from './partners/partners.module';
import { PrismaModule } from './prisma/prisma.module';
import { SearchModule } from './search/search.module';
import { SelectionModule } from './selection/selection.module';
import { envSchemaWithProdChecks } from './config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchemaWithProdChecks.parse(raw),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    PartnersModule,
    EventsModule,
    ApplicationsModule,
    SelectionModule,
    NotificationsModule,
    SearchModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    // 가드는 등록 순서대로 돈다. 인증 → 역할 → 레이트리밋.
    // RolesGuard가 request.user를 읽으므로 JwtAuthGuard보다 뒤여야 한다.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
