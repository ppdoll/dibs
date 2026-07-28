import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AdminReasonDto } from './dto/admin-common.dto';
import { BusinessQueueQueryDto, VerifyBusinessDto } from './dto/business-admin.dto';
import { AdminBusinessesService } from './services/admin-businesses.service';

/**
 * 사업자 진위 확인 큐.
 *
 * 상세 조회가 GET 인데도 감사 행을 남긴다 — 사업자등록번호·대표자명·연락처가 함께 나가는
 * 화면이라, 조회 자체가 개인정보 열람이다. 그 기록은 사후에 만들 수 없다.
 */
@ApiTags('admin-businesses')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/businesses')
export class AdminBusinessesController {
  constructor(private readonly businesses: AdminBusinessesService) {}

  @Get()
  @ApiOperation({ summary: '사업자 확인 큐 (기본 PENDING · 제출 순)' })
  list(@Query() query: BusinessQueueQueryDto) {
    return this.businesses.listQueue(query);
  }

  @Get(':businessId')
  @ApiOperation({ summary: '사업자 상세 — PII_ACCESSED 감사 행이 남는다' })
  detail(@CurrentUser() admin: AuthenticatedUser, @Param('businessId') businessId: string) {
    return this.businesses.getDetail(admin, businessId);
  }

  @Post(':businessId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '확인 완료 (PENDING → VERIFIED)' })
  verify(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('businessId') businessId: string,
    @Body() dto: VerifyBusinessDto,
  ) {
    return this.businesses.verify(admin, businessId, dto);
  }

  @Post(':businessId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '확인 반려 (PENDING → REJECTED)' })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('businessId') businessId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.businesses.reject(admin, businessId, dto);
  }

  @Post(':businessId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '확인 취소 (VERIFIED → REVOKED)' })
  revoke(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('businessId') businessId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.businesses.revoke(admin, businessId, dto);
  }
}
