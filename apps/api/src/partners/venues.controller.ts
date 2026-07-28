import {
  BadRequestException,
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
import { UserRole } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireApprovedPartner, Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  CreateVenueDto,
  HideVenueDto,
  ListVenuesQueryDto,
  UpdateVenueDto,
  VenueDetailDto,
  VenueSummaryDto,
} from './dto/venue.dto';
import { VenueService } from './venue.service';

/**
 * 시설(매장/공간) 관리.
 *
 * 상태 전이는 PATCH 한 방에 몰아넣지 않고 동사별 엔드포인트로 쪼갰다.
 * 상태마다 전제 조건이 다르고(심사 요청은 대표 이미지·사업자 승인을 요구한다),
 * 그걸 PATCH body 의 status 필드 하나로 받으면 전제 검사가 서비스 안 if 문으로 흩어진다.
 */
@ApiTags('partner-venues')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@Controller('partner/venues')
export class VenuesController {
  constructor(private readonly venues: VenueService) {}

  @Post()
  @RequireApprovedPartner()
  @ApiOperation({ summary: '시설 생성 (DRAFT)' })
  @ApiOkResponse({ type: VenueDetailDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVenueDto) {
    return this.venues.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: '내 시설 목록' })
  @ApiOkResponse({ type: [VenueSummaryDto] })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListVenuesQueryDto) {
    return this.venues.list(user, query);
  }

  @Get(':venueId')
  @ApiOperation({ summary: '시설 상세 (작성 중인 시설 포함)' })
  @ApiParam({ name: 'venueId' })
  @ApiOkResponse({ type: VenueDetailDto })
  get(@CurrentUser() user: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.venues.getDetail(user, venueId);
  }

  @Patch(':venueId')
  @RequireApprovedPartner()
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: '직전에 조회한 시설의 version. 낡았으면 412 로 거절된다.',
  })
  @ApiOperation({ summary: '시설 수정' })
  @ApiOkResponse({ type: VenueDetailDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdateVenueDto,
  ) {
    return this.venues.update(user, venueId, parseIfMatch(ifMatch), dto);
  }

  @Post(':venueId/review-request')
  @RequireApprovedPartner()
  @ApiOperation({
    summary: '시설 심사 요청 (DRAFT → PENDING_REVIEW)',
    description: '사업자 심사 승인 + 대표 이미지 1장 이상이 필요하다.',
  })
  @ApiOkResponse({ type: VenueDetailDto })
  submitForReview(@CurrentUser() user: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.venues.submitForReview(user, venueId);
  }

  @Post(':venueId/hide')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '노출 중단 (ACTIVE → HIDDEN)' })
  @ApiOkResponse({ type: VenueDetailDto })
  hide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: HideVenueDto,
  ) {
    return this.venues.hide(user, venueId, dto);
  }

  @Post(':venueId/unhide')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '노출 재개 (HIDDEN → ACTIVE)' })
  @ApiOkResponse({ type: VenueDetailDto })
  unhide(@CurrentUser() user: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.venues.unhide(user, venueId);
  }

  @Post(':venueId/archive')
  @RequireApprovedPartner()
  @ApiOperation({
    summary: '보관 (DRAFT/HIDDEN → ARCHIVED)',
    description: '진행 중인 이벤트가 없어야 한다.',
  })
  @ApiOkResponse({ type: VenueDetailDto })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.venues.archive(user, venueId);
  }

  @Post(':venueId/restore')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '보관 해제 (ARCHIVED → DRAFT)' })
  @ApiOkResponse({ type: VenueDetailDto })
  restore(@CurrentUser() user: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.venues.restore(user, venueId);
  }

  @Delete(':venueId')
  @RequireApprovedPartner()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '시설 삭제',
    description: '이벤트가 한 번도 걸린 적 없는 DRAFT/ARCHIVED 시설만 삭제된다.',
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.venues.remove(user, venueId);
  }
}

/**
 * `If-Match` 를 버전 정수로 읽는다.
 *
 * 따옴표와 `W/` 접두사를 벗기는 이유: HTTP 표준 ETag 형태로 보내는 클라이언트가 흔하고,
 * 그걸 그대로 parseInt 하면 NaN 이 되어 항상 412 가 난다 — 원인을 찾기 어려운 종류의 실패다.
 */
function parseIfMatch(raw: string | undefined): number {
  const normalized = raw?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');

  if (!normalized) {
    throw new BadRequestException('If-Match 헤더가 필요합니다. 조회 응답의 version 을 넣어 주세요.');
  }

  const version = Number(normalized);

  if (!Number.isInteger(version) || version < 0) {
    throw new BadRequestException('If-Match 값이 올바르지 않습니다.');
  }

  return version;
}
