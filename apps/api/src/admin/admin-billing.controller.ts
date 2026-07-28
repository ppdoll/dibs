import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ComputeSettlementDto,
  CreatePlatformFeeDto,
  EndPlatformFeeDto,
  PlatformFeeListQueryDto,
  SettlementListQueryDto,
  UpdateSettlementStatusDto,
} from './dto/billing-admin.dto';
import { AdminBillingService } from './services/admin-billing.service';

/**
 * 수수료 정책 · 정산. **실제 이체는 하지 않는다** (D-05 보류 항목).
 *
 * 금액을 계산해 행에 적는 데까지가 범위다. `PAID` 로 넘기는 것도 밖에서 끝난 이체를
 * 사람이 기록하는 행위이지 이 API 가 돈을 옮기는 것이 아니다.
 * 지급 연동이 붙을 자리는 서비스의 `updateSettlementStatus()` 주석에 표시해 두었다.
 */
@ApiTags('admin-billing')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  @Get('fees')
  @ApiOperation({ summary: '수수료 정책 목록' })
  listFees(@Query() query: PlatformFeeListQueryDto) {
    return this.billing.listFees(query);
  }

  @Post('fees')
  @ApiOperation({ summary: '수수료 정책 생성 (기존 정책은 수정하지 않고 새로 만든다)' })
  createFee(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreatePlatformFeeDto) {
    return this.billing.createFee(admin, dto);
  }

  @Post('fees/:feeId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '수수료 정책 종료 (삭제하지 않는다 — 과거 정산의 근거다)' })
  endFee(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('feeId') feeId: string,
    @Body() dto: EndPlatformFeeDto,
  ) {
    return this.billing.endFee(admin, feeId, dto);
  }

  @Get('settlements')
  @ApiOperation({ summary: '정산 목록' })
  listSettlements(@Query() query: SettlementListQueryDto) {
    return this.billing.listSettlements(query);
  }

  @Post('settlements/compute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '정산 계산 (SETTLEMENT_ENABLED 가 켜져 있어야 한다)',
    description: '같은 (eventId, periodKstMonth) 에 다시 돌려도 같은 결과가 나온다.',
  })
  compute(@CurrentUser() admin: AuthenticatedUser, @Body() dto: ComputeSettlementDto) {
    return this.billing.computeSettlement(admin, dto);
  }

  @Post('settlements/:settlementId/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '정산 상태 전이 (전이표에 없는 조합은 400)' })
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('settlementId') settlementId: string,
    @Body() dto: UpdateSettlementStatusDto,
  ) {
    return this.billing.updateSettlementStatus(admin, settlementId, dto);
  }
}
