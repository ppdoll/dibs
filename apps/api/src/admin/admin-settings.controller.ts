import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { UpsertSettingDto } from './dto/setting-admin.dto';
import { AdminSettingsService } from './services/admin-settings.service';

/**
 * 런타임 설정과 피처 플래그. (IC-65)
 *
 * PUT 인 이유: 키가 곧 자원이고, 같은 값을 두 번 써도 결과가 같아야 한다.
 * 값이 실제로 바뀌지 않으면 감사 행도 남기지 않는다 — 저장 버튼을 두 번 누른 것이
 * "두 번 바꿈"으로 기록되면 체인이 의미 없는 행으로 부푼다.
 */
@ApiTags('admin-settings')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @ApiOperation({
    summary: '설정 목록',
    description: '저장된 행이 없는 키도 "기본값 사용 중"으로 함께 보여준다.',
  })
  list() {
    return this.settings.list();
  }

  @Get(':key')
  @ApiOperation({ summary: '설정 1건' })
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @Put(':key')
  @ApiOperation({
    summary: '설정 쓰기',
    description:
      '피처 플래그는 FEATURE_FLAG_TOGGLED, 나머지는 SETTING_CHANGED 감사 행이 before/after JSON 과 함께 남는다.',
  })
  upsert(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
  ) {
    return this.settings.upsert(admin, key, dto);
  }
}
