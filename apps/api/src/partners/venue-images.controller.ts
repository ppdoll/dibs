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
  Put,
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
import {
  RegisterVenueImageDto,
  ReorderVenueImagesDto,
  UpdateVenueImageDto,
  VenueImageResponseDto,
  VenueImageTicketResponseDto,
  VenueImageUploadTicketDto,
} from './dto/venue-image.dto';
import { VenueImageService } from './venue-image.service';

/**
 * 시설 이미지.
 *
 * 업로드는 2단계다: 티켓 발급(자리 예약) → 클라이언트가 Blob 에 직접 업로드 → 등록.
 * 파일 본문이 서버 함수를 통과하지 않는 이유는 partner-blob.service.ts 주석에 있다.
 */
@ApiTags('partner-venue-images')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@ApiParam({ name: 'venueId' })
@Controller('partner/venues/:venueId/images')
export class VenueImagesController {
  constructor(private readonly images: VenueImageService) {}

  @Get()
  @ApiOperation({ summary: '시설 이미지 목록' })
  @ApiOkResponse({ type: [VenueImageResponseDto] })
  list(@CurrentUser() user: AuthenticatedUser, @Param('venueId') venueId: string) {
    return this.images.list(user, venueId);
  }

  @Post('upload-ticket')
  @RequireApprovedPartner()
  @ApiOperation({
    summary: '이미지 업로드 티켓 발급',
    description: '경로는 서버가 정한다. 발급과 동시에 순서 자리(sortOrder)가 예약된다.',
  })
  @ApiOkResponse({ type: VenueImageTicketResponseDto })
  createTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: VenueImageUploadTicketDto,
  ) {
    return this.images.createUploadTicket(user, venueId, dto);
  }

  @Post(':imageId/register')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '업로드 완료 등록 (PENDING → READY)' })
  @ApiOkResponse({ type: VenueImageResponseDto })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Param('imageId') imageId: string,
    @Body() dto: RegisterVenueImageDto,
  ) {
    return this.images.register(user, venueId, imageId, dto);
  }

  @Patch('order')
  @RequireApprovedPartner()
  @ApiOperation({
    summary: '이미지 순서 재배치',
    description: '살아 있는 이미지 전체를 원하는 순서대로 보낸다.',
  })
  @ApiOkResponse({ type: [VenueImageResponseDto] })
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Body() dto: ReorderVenueImagesDto,
  ) {
    return this.images.reorder(user, venueId, dto);
  }

  @Patch(':imageId')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '대체 텍스트 수정' })
  @ApiOkResponse({ type: VenueImageResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateVenueImageDto,
  ) {
    return this.images.updateAltText(user, venueId, imageId, dto);
  }

  @Put(':imageId/cover')
  @RequireApprovedPartner()
  @ApiOperation({ summary: '대표 이미지 지정' })
  @ApiOkResponse({ type: [VenueImageResponseDto] })
  setCover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.setCover(user, venueId, imageId);
  }

  @Delete(':imageId')
  @RequireApprovedPartner()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '이미지 삭제' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('venueId') venueId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.remove(user, venueId, imageId);
  }
}
