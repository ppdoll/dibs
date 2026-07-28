import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AdminReasonDto, OptionalAdminReasonDto } from './dto/admin-common.dto';
import {
  ApprovePartnerDto,
  PartnerQueueQueryDto,
  RejectPartnerDto,
  RequestResubmitDto,
  SuspendPartnerDto,
} from './dto/partner-admin.dto';
import { AdminPartnersService } from './services/admin-partners.service';

/**
 * 파트너 승인 큐. (D-09)
 *
 * 모든 전이가 POST 다. PATCH 로 approvalStatus 를 직접 받지 않는 이유는,
 * 그러면 "어떤 상태에서 어떤 상태로 갈 수 있는가"가 클라이언트 손에 넘어가기 때문이다.
 * 전이마다 엔드포인트가 따로면 서버가 그 표를 쥔다.
 */
@ApiTags('admin-partners')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/partners')
export class AdminPartnersController {
  constructor(private readonly partners: AdminPartnersService) {}

  @Get()
  @ApiOperation({ summary: '파트너 심사 큐 (기본 PENDING · slaDueAt 오름차순)' })
  list(@Query() query: PartnerQueueQueryDto) {
    return this.partners.listQueue(query);
  }

  @Get(':partnerProfileId')
  @ApiOperation({ summary: '파트너 신청서 상세' })
  detail(@Param('partnerProfileId') partnerProfileId: string) {
    return this.partners.getDetail(partnerProfileId);
  }

  @Post(':partnerProfileId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '승인 — 감사 로그 + 승인 알림' })
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('partnerProfileId') partnerProfileId: string,
    @Body() dto: ApprovePartnerDto,
  ) {
    return this.partners.approve(admin, partnerProfileId, dto);
  }

  @Post(':partnerProfileId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '반려 — 반려 코드 + 사유가 파트너에게 그대로 간다' })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('partnerProfileId') partnerProfileId: string,
    @Body() dto: RejectPartnerDto,
  ) {
    return this.partners.reject(admin, partnerProfileId, dto);
  }

  @Post(':partnerProfileId/request-resubmit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '보완 요청 — 신청서를 살려둔 채 파트너에게 공을 넘긴다' })
  requestResubmit(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('partnerProfileId') partnerProfileId: string,
    @Body() dto: RequestResubmitDto,
  ) {
    return this.partners.requestResubmit(admin, partnerProfileId, dto);
  }

  @Post(':partnerProfileId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '파트너 활동 정지 (계정 정지와는 별개)' })
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('partnerProfileId') partnerProfileId: string,
    @Body() dto: SuspendPartnerDto,
  ) {
    return this.partners.suspend(admin, partnerProfileId, dto);
  }

  @Post(':partnerProfileId/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '파트너 정지 해제' })
  reinstate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('partnerProfileId') partnerProfileId: string,
    @Body() dto: OptionalAdminReasonDto,
  ) {
    return this.partners.reinstate(admin, partnerProfileId, dto);
  }

  @Post(':partnerProfileId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '파트너 자격 박탈 (되돌리는 경로 없음 — 재신청만 가능)' })
  revoke(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('partnerProfileId') partnerProfileId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.partners.revoke(admin, partnerProfileId, dto);
  }
}
