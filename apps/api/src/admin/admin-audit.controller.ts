import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AuditChainVerifyQueryDto, AuditLogQueryDto } from './dto/audit-admin.dto';
import { AdminAuditViewerService } from './services/admin-audit-viewer.service';

/**
 * 감사 로그 열람.
 *
 * 커서가 `seq` 인 것이 이 화면의 전부다 — AuditLog 의 전순서는 seq 이고,
 * createdAt 이나 id 로 페이징하면 같은 밀리초의 두 행이 뒤집혀 "체인 순서대로 읽는다"는
 * 존재 이유가 사라진다. 응답의 seq 는 BigInt 라 항상 문자열로 나간다.
 */
@ApiTags('admin-audit')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly viewer: AdminAuditViewerService) {}

  @Get()
  @ApiOperation({ summary: '감사 로그 조회 (행위자 · 액션 · 대상 · 기간 필터)' })
  list(@Query() query: AuditLogQueryDto) {
    return this.viewer.list(query);
  }

  @Get('verify')
  @ApiOperation({
    summary: '체인 무결성 검사',
    description:
      'prevHash ↔ rowHash 연결만 검증한다. rowHash 재계산은 하지 않는다 — 해시 원문 규칙이 모듈마다 달라 오탐이 된다.',
  })
  verify(@CurrentUser() admin: AuthenticatedUser, @Query() query: AuditChainVerifyQueryDto) {
    return this.viewer.verifyChain(admin, query);
  }

  @Get('export')
  @ApiOperation({ summary: '감사 로그 내보내기 (AUDIT_EXPORTED 감사 행이 남는다)' })
  export(@CurrentUser() admin: AuthenticatedUser, @Query() query: AuditLogQueryDto) {
    return this.viewer.export(admin, query);
  }
}
