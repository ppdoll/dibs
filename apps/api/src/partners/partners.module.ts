import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BusinessService } from './business.service';
import { BusinessesController } from './businesses.controller';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PartnerAuditService } from './internal/partner-audit.service';
import { PartnerBlobService } from './internal/partner-blob.service';
import { PartnerProfileController } from './partner-profile.controller';
import { PartnerProfileService } from './partner-profile.service';
import { VenueImageService } from './venue-image.service';
import { VenueImagesController } from './venue-images.controller';
import { VenueService } from './venue.service';
import { VenuesController } from './venues.controller';

/**
 * 파트너 프로필 조회 · 사업자 · 시설 · 시설 이미지 · 마스터 데이터 조회.
 *
 * 다른 도메인 모듈의 서비스를 주입하지 않는다. 알림은 `tx.notification.create`(아웃박스, IC-42),
 * 감사는 `PartnerAuditService`(같은 트랜잭션, IC-61), 다른 애그리게이트 조회는 Prisma 로 직접 한다.
 * PrismaModule 은 전역이라 여기서 import 하지 않는다.
 */
@Module({
  imports: [ConfigModule],
  controllers: [
    PartnerProfileController,
    BusinessesController,
    VenuesController,
    VenueImagesController,
    CatalogController,
  ],
  providers: [
    PartnerProfileService,
    BusinessService,
    VenueService,
    VenueImageService,
    CatalogService,
    PartnerAuditService,
    PartnerBlobService,
  ],
  exports: [],
})
export class PartnersModule {}
