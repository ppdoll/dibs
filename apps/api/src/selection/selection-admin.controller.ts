import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PartnerSelectionRoundDto, SelectionEntryQueryDto } from './dto/selection.dto';
import { RankingService } from './ranking.service';
import { SelectionService } from './selection.service';

/**
 * 운영자의 선정 라운드 조회.
 *
 * 파트너 컨트롤러를 그대로 쓰지 않는 이유는 `@RequireApprovedPartner()` 다 — 운영자는
 * `partnerApproved` 가 false 라 그 가드에 막힌다. 역할이 다르면 문이 다른 게 맞다.
 *
 * 운영자는 소유권 술어 없이 모든 이벤트를 본다(민원 처리에 필요하다). 대신 이 경로로 들어온 접근은
 * 서비스가 `ownerScopeOf` 로 구분하고, 상태를 바꾸는 조작은 전부 감사 체인에 남는다.
 * 명단 자체를 고치는 일은 파트너의 책임이므로 여기 열어 두지 않는다 —
 * 운영자가 명단을 직접 바꿔야 하는 상황은 이벤트 정지·취소(admin/events)로 처리한다.
 */
@ApiTags('admin-selections')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/selections')
export class SelectionAdminController {
  constructor(
    private readonly selection: SelectionService,
    private readonly ranking: RankingService,
  ) {}

  @Get('by-event/:eventId')
  @ApiOperation({ summary: '이벤트의 최신 선정 라운드 (커트라인 포함)' })
  @ApiOkResponse({ type: PartnerSelectionRoundDto })
  getByEvent(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.selection.getLatestRoundByEvent(user, eventId);
  }

  @Post('by-event/:eventId/open')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '선정 라운드 강제 개시',
    description: '크론이 멈춘 동안 확정이 밀린 이벤트를 손으로 밀어 올릴 때 쓴다. 게이트는 동일하다.',
  })
  openRound(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.ranking.openRoundManually(user, eventId);
  }

  @Get(':selectionId')
  @ApiOperation({ summary: '라운드 상세' })
  @ApiOkResponse({ type: PartnerSelectionRoundDto })
  getRound(@CurrentUser() user: AuthenticatedUser, @Param('selectionId') selectionId: string) {
    return this.selection.getRound(user, selectionId);
  }

  @Get(':selectionId/entries')
  @ApiOperation({ summary: '순위순 신청자 목록 (금액 포함)' })
  listEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('selectionId') selectionId: string,
    @Query() query: SelectionEntryQueryDto,
  ) {
    return this.selection.listEntries(user, selectionId, query);
  }
}
