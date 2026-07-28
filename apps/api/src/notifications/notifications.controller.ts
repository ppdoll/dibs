import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import {
  MarkAllReadResultDto,
  NotificationItemDto,
  NotificationListQueryDto,
  UnreadCountDto,
} from './dto/notification.dto';
import {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from './dto/preference.dto';

/**
 * 내 알림함 + 알림 설정. (D-10)
 *
 * 라우트 선언 순서가 곧 매칭 순서다. `read-all` / `preferences` 같은 고정 경로는
 * `:id` 파라미터 라우트보다 **먼저** 와야 한다 — 뒤에 두면 `:id = "preferences"` 로 먹힌다.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly inbox: NotificationInboxService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Get()
  @ApiOperation({ summary: '내 알림 목록 (커서 페이지네이션)' })
  // 실제 응답은 { items, nextCursor, hasMore } 이고 items 의 원소가 이 타입이다.
  @ApiOkResponse({ type: NotificationItemDto, isArray: true })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: NotificationListQueryDto) {
    return this.inbox.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: '미열람 수 (알림 + 쪽지)' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.unreadCount(user.id);
  }

  @Get('preferences')
  @ApiOperation({ summary: '알림 설정 조회 — 행이 없으면 기본값으로 채워 준다' })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.get(user.id);
  }

  @Put('preferences')
  @ApiOperation({
    summary: '알림 설정 변경 — 필수 범주(예약금·결과·계정)는 요청과 무관하게 켠 채로 저장된다',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.update(user.id, dto);
  }

  @Post('read-all')
  @ApiOperation({ summary: '전체 읽음' })
  @ApiOkResponse({ type: MarkAllReadResultDto })
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.markAllRead(user.id);
  }

  @Post(':id/read')
  @ApiOperation({ summary: '한 건 읽음 — 이미 읽었으면 alreadyRead=true 로 조용히 성공한다' })
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inbox.markRead(user.id, id);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: '보관 — 목록에서 내리되 통보 기록 자체는 남긴다' })
  @HttpCode(HttpStatus.OK)
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inbox.archive(user.id, id);
  }
}
