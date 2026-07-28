import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AdminReasonDto } from './dto/admin-common.dto';
import {
  HideVenueDto,
  QuarantineImageDto,
  RestoreVenueDto,
  VenueModerationQueryDto,
} from './dto/moderation-admin.dto';
import { AdminVenuesService } from './services/admin-venues.service';

/**
 * 매장 검수와 콘텐츠 모더레이션.
 *
 * 파트너 쪽에도 hide/unhide 가 있지만 그건 자기 매장을 잠시 내리는 것이고,
 * 여기의 hide 는 파트너가 스스로 풀 수 없는 강제 조치다. 경로를 나눠 둔 이유가 그것이다.
 */
@ApiTags('admin-venues')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/venues')
export class AdminVenuesController {
  constructor(private readonly venues: AdminVenuesService) {}

  @Get()
  @ApiOperation({ summary: '매장 검수 큐 (기본 PENDING_REVIEW · 제출 순)' })
  list(@Query() query: VenueModerationQueryDto) {
    return this.venues.list(query);
  }

  @Get(':venueId')
  @ApiOperation({ summary: '매장 상세 (이미지 목록 포함)' })
  detail(@Param('venueId') venueId: string) {
    return this.venues.getDetail(venueId);
  }

  @Post(':venueId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '검수 승인 (PENDING_REVIEW → ACTIVE)',
    description: '사업자가 VERIFIED 여야 통과한다. publishedAt 은 최초 1회만 찍힌다.',
  })
  approve(@CurrentUser() admin: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.venues.approve(admin, venueId);
  }

  @Post(':venueId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '검수 반려 (PENDING_REVIEW → DRAFT)' })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.venues.reject(admin, venueId, dto);
  }

  @Post(':venueId/hide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '강제 비공개 (ACTIVE → HIDDEN)' })
  hide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: HideVenueDto,
  ) {
    return this.venues.hide(admin, venueId, dto);
  }

  @Post(':venueId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '비공개 해제 (HIDDEN → ACTIVE)' })
  restore(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: RestoreVenueDto,
  ) {
    return this.venues.restore(admin, venueId, dto);
  }

  @Post(':venueId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '매장 정지 (ACTIVE/HIDDEN/PENDING_REVIEW → SUSPENDED)' })
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.venues.suspend(admin, venueId, dto);
  }

  @Post(':venueId/unsuspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '매장 정지 해제',
    description: '공개 이력(publishedAt)이 있으면 ACTIVE, 없으면 DRAFT 로 돌아간다.',
  })
  unsuspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: RestoreVenueDto,
  ) {
    return this.venues.unsuspend(admin, venueId, dto);
  }

  @Post(':venueId/images/:imageId/quarantine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이미지 격리 (대표 이미지였다면 대표 지정도 함께 푼다)' })
  quarantineImage(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Param('imageId') imageId: string,
    @Body() dto: QuarantineImageDto,
  ) {
    return this.venues.quarantineImage(admin, venueId, imageId, dto);
  }

  @Post(':venueId/images/:imageId/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이미지 격리 해제 (대표 지정은 복원하지 않는다)' })
  releaseImage(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.venues.releaseImage(admin, venueId, imageId);
  }
}
