import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireApprovedPartner, Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { BusinessService } from './business.service';
import {
  AttachBusinessDocDto,
  BusinessDocUploadTokenDto,
  BusinessResponseDto,
  CreateBusinessDto,
  SubmitBusinessVerificationDto,
  UpdateBusinessDto,
} from './dto/business.dto';

/**
 * 사업자(브랜드/법인) 관리.
 *
 * 조회에는 `@RequireApprovedPartner()` 를 붙이지 않는다 — 파트너 승인 대기 중에도
 * 자기가 써 둔 내용을 다시 볼 수 있어야 한다(D-09 / RolesGuard 주석과 같은 이유).
 * 바깥에 영향을 주는 쓰기에만 승인을 요구한다.
 */
@ApiTags('partner-businesses')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@Controller('partner/businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessService) {}

  @Post()
  @RequireApprovedPartner()
  @ApiOperation({ summary: '사업자 등록' })
  @ApiOkResponse({ type: BusinessResponseDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBusinessDto) {
    return this.businesses.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: '내 사업자 목록' })
  @ApiOkResponse({ type: [BusinessResponseDto] })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.businesses.list(user);
  }

  @Get(':businessId')
  @ApiOperation({ summary: '사업자 상세' })
  @ApiParam({ name: 'businessId' })
  @ApiOkResponse({ type: BusinessResponseDto })
  get(@CurrentUser() user: AuthenticatedUser, @Param('businessId') businessId: string) {
    return this.businesses.get(user, businessId);
  }

  @Patch(':businessId')
  @RequireApprovedPartner()
  @ApiOperation({
    summary: '사업자 수정',
    description: '등록번호·업종·대표자명은 심사 중/승인 상태에서 변경할 수 없다.',
  })
  @ApiOkResponse({ type: BusinessResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('businessId') businessId: string,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businesses.update(user, businessId, dto);
  }

  @Post(':businessId/registration-doc/upload-ticket')
  @RequireApprovedPartner()
  @ApiOperation({
    summary: '사업자등록증 업로드 티켓 발급',
    description:
      '파일 본문은 서버를 거치지 않는다. 이 토큰으로 Vercel Blob 에 직접 올린 뒤 등록을 호출한다.',
  })
  createDocTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('businessId') businessId: string,
    @Body() dto: BusinessDocUploadTokenDto,
  ) {
    return this.businesses.createDocUploadTicket(user, businessId, dto);
  }

  @Post(':businessId/registration-doc')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '사업자등록증 업로드 완료 등록' })
  @ApiOkResponse({ type: BusinessResponseDto })
  attachDoc(
    @CurrentUser() user: AuthenticatedUser,
    @Param('businessId') businessId: string,
    @Body() dto: AttachBusinessDocDto,
  ) {
    return this.businesses.attachDoc(user, businessId, dto);
  }

  @Get(':businessId/registration-doc')
  @ApiOperation({
    summary: '사업자등록증 열람 URL',
    description: '만료가 짧은 URL 을 발급하고 열람 사실을 감사 로그에 남긴다.',
  })
  resolveDoc(@CurrentUser() user: AuthenticatedUser, @Param('businessId') businessId: string) {
    return this.businesses.resolveDoc(user, businessId);
  }

  @Post(':businessId/verification')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '사업자 심사 제출' })
  @ApiOkResponse({ type: BusinessResponseDto })
  submitVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('businessId') businessId: string,
    @Body() dto: SubmitBusinessVerificationDto,
  ) {
    return this.businesses.submitVerification(user, businessId, dto);
  }

  @Delete(':businessId')
  @RequireApprovedPartner()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '사업자 삭제',
    description: '살아 있는 시설이 없고 심사 중이 아닐 때만 가능하다.',
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('businessId') businessId: string) {
    return this.businesses.remove(user, businessId);
  }
}
