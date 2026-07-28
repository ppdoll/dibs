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
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireApprovedPartner, Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  CreateEventImageTicketDto,
  RegisterEventImageDto,
  ReorderEventImagesDto,
  UpdateEventImageDto,
} from './dto/event-image.dto';
import { EventImagesService } from './event-images.service';

/**
 * 이벤트 이미지. 시설 이미지와 같은 2단계 핸드셰이크다.
 *
 *   1) POST /upload-ticket → 서버가 imageId 와 경로를 정하고 60초짜리 클라이언트 토큰을 준다.
 *   2) 클라이언트가 Vercel Blob 으로 **직접** 올린다 (파일 본문이 서버 함수를 통과하지 않는다).
 *   3) POST / → 서버가 head() 로 실제 blob 을 확인하고 행을 만든다.
 */
@ApiTags('partner-event-images')
@ApiBearerAuth()
@Roles(UserRole.PARTNER)
@RequireApprovedPartner()
@Controller('partner/events/:eventId/images')
export class EventImagesController {
  constructor(private readonly images: EventImagesService) {}

  @Post('upload-ticket')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '업로드 티켓 발급 (60초 유효)' })
  @ApiCreatedResponse({ description: 'imageId·pathname·clientToken. 업로드 후 등록에 그대로 쓴다.' })
  createTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: CreateEventImageTicketDto,
  ) {
    return this.images.createUploadTicket(user, eventId, dto);
  }

  @Post()
  @ApiOperation({ summary: '업로드된 이미지 등록' })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: RegisterEventImageDto,
  ) {
    return this.images.register(user, eventId, dto);
  }

  @Get()
  @ApiOperation({ summary: '이미지 목록' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.images.list(user, eventId);
  }

  @Patch('order')
  @ApiOperation({
    summary: '순서 재배치',
    description: '살아 있는 이미지 전체를 원하는 순서로 보낸다. 부분 재배치는 받지 않는다.',
  })
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: ReorderEventImagesDto,
  ) {
    return this.images.reorder(user, eventId, dto);
  }

  @Patch(':imageId')
  @ApiOperation({ summary: '대체 텍스트 수정' })
  updateMeta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateEventImageDto,
  ) {
    return this.images.updateMeta(user, eventId, imageId, dto);
  }

  @Post(':imageId/cover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '대표 이미지 지정' })
  setCover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.setCover(user, eventId, imageId);
  }

  @Delete(':imageId')
  @ApiOperation({ summary: '이미지 삭제 (대표였다면 다음 장이 승계된다)' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.remove(user, eventId, imageId);
  }
}
