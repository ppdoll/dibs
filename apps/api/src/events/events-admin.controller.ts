import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CancelEventDto, SuspendEventDto } from './dto/event-lifecycle.dto';
import { EventLifecycleService } from './event-lifecycle.service';
import { parseIfMatchVersion } from './internal/event-context';

/**
 * 운영자의 이벤트 개입.
 *
 * 정지/해제에 If-Match 를 요구하지 않는 것이 의도다 — 정지는 사고를 멈추는 조치이고,
 * 낡은 토큰 때문에 412 로 튕기는 동안에도 신청은 계속 들어온다.
 * 대신 두 전이 모두 version 을 올려서, 진행 중이던 파트너의 PATCH 는 확실히 무효화한다(IC-63).
 * 반대로 **취소는 되돌릴 수 없으므로** If-Match 를 요구한다 — 운영자가 보고 있던 화면과
 * 실제 상태가 어긋난 채로 취소가 나가면 복구할 방법이 없다.
 */
@ApiTags('admin-events')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/events')
export class EventsAdminController {
  constructor(private readonly lifecycle: EventLifecycleService) {}

  @Post(':eventId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '이벤트 정지',
    description: '현재 상태를 statusBeforeSuspend에 보관하고 SUSPENDED로 묶는다. 공개 목록에서 즉시 빠진다.',
  })
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: SuspendEventDto,
  ) {
    return this.lifecycle.suspend(user, eventId, dto);
  }

  @Post(':eventId/unsuspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '정지 해제 (statusBeforeSuspend로 복귀)' })
  unsuspend(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.lifecycle.unsuspend(user, eventId);
  }

  @Post(':eventId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '강제 취소 (되돌릴 수 없음)' })
  @ApiHeader({ name: 'If-Match', required: true, description: '조회로 받은 Event.version' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: CancelEventDto,
  ) {
    return this.lifecycle.cancelByAdmin(user, eventId, parseIfMatchVersion(ifMatch), dto);
  }
}
