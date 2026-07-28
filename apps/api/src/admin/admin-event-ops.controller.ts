import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventOpsQueryDto, ExtendDeadlineDto, ForceCloseEventDto } from './dto/event-ops-admin.dto';
import { AdminEventsService } from './services/admin-events.service';

/**
 * 운영자의 이벤트 개입 — 강제 마감과 마감 연장.
 *
 * 같은 `admin/events` 프리픽스 아래에 이벤트 모듈의 운영자 컨트롤러가 이미 있고,
 * 거기에 정지(`/suspend`)·해제(`/unsuspend`)·강제 취소(`/cancel`)가 들어 있다.
 * 그 셋을 여기 복제하지 않는 이유는 IC-62 다 — `statusBeforeSuspend` 왕복을 다루는 코드가
 * 두 곳이면 한쪽만 고쳐지는 날이 오고, 그날 해제는 이벤트를 엉뚱한 상태로 되살린다.
 *
 * 낙관적 락 토큰을 헤더가 아니라 **본문**으로 받는다(IC-63 / admin-common.dto.ts).
 * 두 조치 모두 되돌릴 수 없어서 If-Match 를 요구한다 — 운영자가 보던 화면과 실제 상태가
 * 어긋난 채로 나가면 복구할 방법이 없다.
 */
@ApiTags('admin-event-ops')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/events')
export class AdminEventOpsController {
  constructor(private readonly events: AdminEventsService) {}

  @Get('ops')
  @ApiOperation({ summary: '이벤트 목록 (운영 관점 — 정원·마감·버전)' })
  list(@Query() query: EventOpsQueryDto) {
    return this.events.list(query);
  }

  @Get('ops/:eventId')
  @ApiOperation({ summary: '이벤트 운영 상세 (파트너·시설·소프트클로즈 상태 포함)' })
  detail(@Param('eventId') eventId: string) {
    return this.events.getDetail(eventId);
  }

  @Post(':eventId/force-close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '강제 마감 (OPEN → CLOSED)',
    description:
      'applyEndAt 은 당기지 않는다. 이미 돌고 있는 예약금 시계는 남은 시간만큼 그대로 흐른다.',
  })
  forceClose(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: ForceCloseEventDto,
  ) {
    return this.events.forceClose(admin, eventId, dto);
  }

  @Post(':eventId/extend-deadline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '마감 연장',
    description:
      'applyEndAt 과 rankingLockAt 을 같은 문장에서 함께 민다. 신청자에게 연장 사실만 통보된다(금액·순위 없음).',
  })
  extendDeadline(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: ExtendDeadlineDto,
  ) {
    return this.events.extendDeadline(admin, eventId, dto);
  }
}
