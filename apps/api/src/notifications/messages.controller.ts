import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { MessageInboxService } from './message-inbox.service';
import { MessageItemDto, MessageListQueryDto } from './dto/message.dto';

/**
 * 내 쪽지함. (D-10)
 *
 * 상세 조회가 읽음 처리를 겸하지 않는다 — 목록에서 미리보기로 이 API 를 호출하는 화면이
 * 하나만 생겨도 안 읽은 쪽지가 전부 사라진다. 읽음은 별도 엔드포인트다.
 */
@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(private readonly inbox: MessageInboxService) {}

  @Get()
  @ApiOperation({ summary: '내 쪽지 목록 (커서 페이지네이션)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: MessageListQueryDto) {
    return this.inbox.list(user.id, query);
  }

  @Post('read-all')
  @ApiOperation({ summary: '쪽지 전체 읽음' })
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.markAllRead(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '쪽지 상세 — 읽음 처리하지 않는다' })
  @ApiOkResponse({ type: MessageItemDto })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inbox.get(user.id, id);
  }

  @Post(':id/read')
  @ApiOperation({ summary: '쪽지 읽음' })
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inbox.markRead(user.id, id);
  }
}
