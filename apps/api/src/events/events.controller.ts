import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiPreconditionFailedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireApprovedPartner, Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateEventDto } from './dto/create-event.dto';
import { CancelEventDto, CloseEventDto } from './dto/event-lifecycle.dto';
import { PartnerEventListQueryDto } from './dto/event-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventLifecycleService } from './event-lifecycle.service';
import { EventUpdateService } from './event-update.service';
import { EventsService } from './events.service';
import { parseIfMatchVersion } from './internal/event-context';

/**
 * 파트너의 이벤트 관리.
 *
 * 클래스 전체에 @RequireApprovedPartner() 를 건다 — 이벤트는 유저에게 돈을 걸게 하는 물건이라
 * 승인 전 파트너가 만들 수 있으면 안 된다. 다만 그 데코레이터는 "승인된 파트너인가"만 보므로,
 * "이 이벤트가 그 파트너 것인가"는 모든 쿼리의 `partnerId` 술어가 따로 지킨다.
 */
@ApiTags('partner-events')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@RequireApprovedPartner()
@Controller('partner/events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly updates: EventUpdateService,
    private readonly lifecycle: EventLifecycleService,
  ) {}

  @Post()
  @ApiOperation({
    summary: '이벤트 생성 (항상 DRAFT)',
    description:
      'INSTANT는 fixedAmount만, BID는 minAmount/maxAmount만 쓴다. 공개는 POST /publish로 따로 한다.',
  })
  @ApiCreatedResponse({ description: '생성된 이벤트. version이 이후 PATCH의 If-Match 값이다.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEventDto) {
    return this.events.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: '내 이벤트 목록' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PartnerEventListQueryDto) {
    return this.events.listMine(user, query);
  }

  @Get(':eventId')
  @ApiOperation({ summary: '내 이벤트 상세 (금액·집계 포함, 이미지 동봉)' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.events.getMine(user, eventId);
  }

  @Patch(':eventId')
  @ApiOperation({
    summary: '이벤트 수정',
    description:
      '진행 중(SCHEDULED/OPEN/CLOSED)에는 금액 규칙이 잠기고 입금 시간을 줄일 수 없다. 마감은 앞당길 수 없다.',
  })
  @ApiHeader({ name: 'If-Match', required: true, description: '조회로 받은 Event.version' })
  @ApiPreconditionFailedResponse({ description: 'version이 낡았다. 재조회 후 다시 시도.' })
  @ApiConflictResponse({ description: '지금 상태에서 바꿀 수 없는 필드를 건드렸다.' })
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdateEventDto,
  ) {
    return this.updates.patch(user, eventId, parseIfMatchVersion(ifMatch), dto);
  }

  @Delete(':eventId')
  @ApiOperation({ summary: '초안 삭제 (DRAFT만)' })
  @ApiHeader({ name: 'If-Match', required: true })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.updates.softDelete(user, eventId, parseIfMatchVersion(ifMatch));
  }

  @Post(':eventId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '공개',
    description: '신청 시작 전이면 SCHEDULED, 이미 시작 시각이 지났으면 곧바로 OPEN이 된다.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ description: '공개된 이벤트' })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.lifecycle.publish(user, eventId, parseIfMatchVersion(ifMatch));
  }

  @Post(':eventId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '조기 마감 (OPEN → CLOSED)',
    description: '새 신청만 막는다. 이미 진행 중인 예약금 시계와 순위 확정 시각은 그대로다.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: CloseEventDto,
  ) {
    return this.lifecycle.closeEarly(user, eventId, parseIfMatchVersion(ifMatch), dto);
  }

  @Post(':eventId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '취소',
    description: '되돌릴 수 없다. 신청 전체가 종료되고 신청자 전원에게 알림이 나간다.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: CancelEventDto,
  ) {
    return this.lifecycle.cancelByPartner(user, eventId, parseIfMatchVersion(ifMatch), dto);
  }
}
