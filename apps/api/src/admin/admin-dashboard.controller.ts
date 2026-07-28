import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { AdminDashboardService } from './services/admin-dashboard.service';

/**
 * 운영 대시보드. 콘솔에 들어오면 처음 보는 화면이다.
 *
 * 여기 있는 숫자는 전부 "지금 사람이 개입해야 하는가"를 답하는 것들이다 —
 * 누적 지표(총 가입자 등)를 섞지 않는다. 섞이는 순간 화면이 대시보드가 아니라 통계가 되고,
 * 밀린 심사 큐가 큰 숫자들 사이에 묻힌다.
 */
@ApiTags('admin-dashboard')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: '대시보드 카운트 (심사 대기 · 진행 이벤트 · 오늘 신청 · 임박 홀드)' })
  stats() {
    return this.dashboard.stats();
  }

  @Get('expiring-holds')
  @ApiOperation({ summary: '30분 내 만료 예정 예약금 홀드 (금액은 싣지 않는다)' })
  expiringHolds(@Query('limit') limit?: number) {
    return this.dashboard.expiringHolds(limit ? Number(limit) : undefined);
  }

  @Get('overdue-partners')
  @ApiOperation({ summary: 'SLA 를 넘긴 파트너 심사 건' })
  overduePartners(@Query('limit') limit?: number) {
    return this.dashboard.overduePartnerQueue(limit ? Number(limit) : undefined);
  }
}
