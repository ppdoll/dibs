import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ChangeUserRolesDto,
  ReinstateUserDto,
  SuspendUserDto,
  UserSearchQueryDto,
} from './dto/user-admin.dto';
import { AdminUsersService } from './services/admin-users.service';

/**
 * 계정 관리.
 *
 * 목록은 이메일을 마스킹해서 내려주고, 원본은 상세에서만 나간다.
 * 운영자 권한이 있다는 것과 수백 명의 연락처를 한 화면에 띄워도 된다는 것은 다른 이야기다.
 */
@ApiTags('admin-users')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: '계정 검색 (이메일은 마스킹되어 나간다)' })
  search(@Query() query: UserSearchQueryDto) {
    return this.users.search(query);
  }

  @Get(':userId')
  @ApiOperation({ summary: '계정 상세 — PII_ACCESSED 감사 행이 남는다' })
  detail(@CurrentUser() admin: AuthenticatedUser, @Param('userId') userId: string) {
    return this.users.getDetail(admin, userId);
  }

  @Post(':userId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '계정 정지',
    description: 'tokenVersion 을 올려 발급된 JWT 를 즉시 전부 무효화한다.',
  })
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.users.suspend(admin, userId, dto);
  }

  @Post(':userId/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '계정 정지 해제 (SUSPENDED → ACTIVE)' })
  reinstate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: ReinstateUserDto,
  ) {
    return this.users.reinstate(admin, userId, dto);
  }

  @Post(':userId/roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '역할 교체 (부분 갱신이 아니라 전체 집합 교체)',
    description: 'tokenVersion 을 올리므로 대상 사용자는 다시 로그인해야 한다.',
  })
  changeRoles(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: ChangeUserRolesDto,
  ) {
    return this.users.changeRoles(admin, userId, dto);
  }
}
