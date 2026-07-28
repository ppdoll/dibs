import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { OptionalAdminReasonDto } from './dto/admin-common.dto';
import {
  BroadcastListQueryDto,
  CreateBroadcastDto,
  ScheduleBroadcastDto,
} from './dto/broadcast-admin.dto';
import { AdminBroadcastsService } from './services/admin-broadcasts.service';

/**
 * 운영자 공지. (D-10)
 *
 * 발송은 배치로 나뉜다 — 한 번의 호출이 다 못 끝내면 `hasMore: true` 를 돌려주고
 * 상태를 SENDING 으로 남긴다. 같은 엔드포인트를 다시 부르면 커서부터 이어간다.
 * 그래서 이 엔드포인트는 **여러 번 불려도 안전해야** 하고, 실제로 팬아웃 전 구간이
 * skipDuplicates 로 되어 있다(IC-41).
 */
@ApiTags('admin-broadcasts')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/broadcasts')
export class AdminBroadcastsController {
  constructor(private readonly broadcasts: AdminBroadcastsService) {}

  @Get()
  @ApiOperation({ summary: '공지 목록' })
  list(@Query() query: BroadcastListQueryDto) {
    return this.broadcasts.list(query);
  }

  @Get(':broadcastId')
  @ApiOperation({ summary: '공지 상세 (세그먼트 조건 · 진행 상황)' })
  detail(@Param('broadcastId') broadcastId: string) {
    return this.broadcasts.getDetail(broadcastId);
  }

  @Post()
  @ApiOperation({ summary: '공지 작성 — 세그먼트 조건을 segmentFilter 로 굳힌다' })
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.create(admin, dto);
  }

  @Post(':broadcastId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '공지 승인 (작성자 본인은 승인할 수 없다)' })
  approve(@CurrentUser() admin: AuthenticatedUser, @Param('broadcastId') broadcastId: string) {
    return this.broadcasts.approve(admin, broadcastId);
  }

  @Post(':broadcastId/schedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '예약 발송 시각 지정/변경' })
  schedule(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('broadcastId') broadcastId: string,
    @Body() dto: ScheduleBroadcastDto,
  ) {
    return this.broadcasts.schedule(admin, broadcastId, dto);
  }

  @Post(':broadcastId/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '발송(팬아웃)',
    description:
      '배치로 나눠 처리한다. hasMore 가 true 면 같은 엔드포인트를 다시 호출해 이어서 보낸다.',
  })
  send(@CurrentUser() admin: AuthenticatedUser, @Param('broadcastId') broadcastId: string) {
    return this.broadcasts.send(admin, broadcastId);
  }

  @Post(':broadcastId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '공지 취소 (이미 발송된 건은 회수할 수 없다)' })
  cancel(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('broadcastId') broadcastId: string,
    @Body() dto: OptionalAdminReasonDto,
  ) {
    return this.broadcasts.cancel(admin, broadcastId, dto);
  }
}
