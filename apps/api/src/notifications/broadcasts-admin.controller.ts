import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { BroadcastService } from './broadcast.service';
import {
  BroadcastListQueryDto,
  BroadcastSummaryDto,
  CreateBroadcastDto,
} from './dto/broadcast.dto';

/**
 * 운영자 세그먼트 공지. (D-10)
 *
 * 생성 요청은 `Broadcast` 행 하나를 만들고 첫 페이지만 펼친 뒤 돌아온다. 나머지는 확장 크론이
 * 이어 간다 — 전체 유저 세그먼트를 요청 안에서 다 펼치려다 함수가 죽으면 절반만 나간 공지가 남는다.
 * 응답의 `totalRecipients` 는 그래서 **그 시점까지 펼친 수**이지 최종 수가 아니다.
 */
@ApiTags('admin-broadcasts')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/broadcasts')
export class BroadcastsAdminController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Post()
  @ApiOperation({ summary: '세그먼트 공지 생성 및 발송 시작' })
  @ApiCreatedResponse({ type: BroadcastSummaryDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.createBroadcast(user, dto);
  }

  @Get()
  @ApiOperation({ summary: '공지 목록' })
  list(@Query() query: BroadcastListQueryDto) {
    return this.broadcasts.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '공지 상세 (발송 통계 포함)' })
  @ApiOkResponse({ type: BroadcastSummaryDto })
  get(@Param('id') id: string) {
    return this.broadcasts.get(id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: '보류된 공지 승인 — 발송을 재개한다' })
  @ApiOkResponse({ type: BroadcastSummaryDto })
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.broadcasts.approve(user, id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: '공지 취소 — 아직 안 나간 메일만 멈춘다. 이미 도착한 쪽지는 회수되지 않는다.',
  })
  @ApiOkResponse({ type: BroadcastSummaryDto })
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.broadcasts.cancel(user, id);
  }
}
