import { Body, Controller, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireApprovedPartner, Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { BroadcastService } from './broadcast.service';
import { BroadcastSummaryDto } from './dto/broadcast.dto';
import { SendEventMessageDto } from './dto/message.dto';

/**
 * 파트너 → 자기 이벤트 신청자 발송. (D-10)
 *
 * `@RequireApprovedPartner()` 는 "승인된 파트너인가"만 본다. "이 이벤트가 그 파트너 것인가"는
 * 서비스가 WHERE 절 안에서 따로 확인한다 — 둘 다 필요하다.
 *
 * 이벤트 이미지 컨트롤러와 같은 `partner/events/:eventId/...` 아래에 붙인다.
 * 발송은 이벤트 애그리게이트의 상태를 바꾸지 않으므로 이벤트 모듈이 아니라 여기 있다.
 */
@ApiTags('partner-messages')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@RequireApprovedPartner()
@Controller('partner/events/:eventId/messages')
export class PartnerEventMessagesController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Post()
  @ApiOperation({
    summary: '자기 이벤트 신청자에게 쪽지 발송 (상태별 필터 가능)',
    description:
      '커트라인·순위를 암시하는 문구가 감지되면 발송 대신 운영자 검토로 보류된다(D-07). ' +
      '보류되면 status=BLOCKED 로 돌아오고 발신자에게 알림이 간다.',
  })
  @ApiCreatedResponse({ type: BroadcastSummaryDto })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: SendEventMessageDto,
  ) {
    return this.broadcasts.sendEventMessage(user, eventId, dto);
  }
}
