import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PartnerProfileResponseDto } from './dto/partner-profile.dto';
import { PartnerProfileService } from './partner-profile.service';

/**
 * 파트너 콘솔 진입 화면.
 *
 * `@RequireApprovedPartner()` 를 붙이지 않는다 — 승인 대기·반려 상태에서 **가장 필요한**
 * 화면이 이것이다. 반려 사유와 SLA 기한을 못 보면 파트너가 할 수 있는 일이 없다.
 */
@ApiTags('partner-profile')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@Controller('partner/profile')
export class PartnerProfileController {
  constructor(private readonly profiles: PartnerProfileService) {}

  @Get()
  @ApiOperation({
    summary: '내 파트너 프로필 (심사 상태·반려 사유 + 사업자/시설 집계)',
    description: '신청서 제출은 POST /auth/partner-application 이다. 여기서는 조회만 한다.',
  })
  @ApiOkResponse({ type: PartnerProfileResponseDto })
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getMyProfile(user);
  }
}
