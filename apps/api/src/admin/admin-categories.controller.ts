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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './dto/category-admin.dto';
import { AdminCategoriesService } from './services/admin-categories.service';

/**
 * 업종(Category) 관리.
 *
 * 이용자 화면의 카테고리 칩과 시설 등록 폼의 드롭다운이 전부 여기를 본다.
 * 공개 조회는 `/api/catalog/categories` 가 따로 있고(활성 항목만), 이쪽은 비활성까지 본다.
 */
@ApiTags('admin-categories')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  @ApiOperation({
    summary: '업종 트리',
    description: '2단계 트리로 돌려준다. 각 항목에 사용 중인 시설·이벤트 수가 함께 온다.',
  })
  @ApiQuery({ name: 'includeInactive', required: false, description: '비활성 업종도 포함 (기본 true)' })
  list(@Query('includeInactive') includeInactive?: string) {
    // 관리 화면의 기본값은 "전부 보이기"다. 비활성이 안 보이면 왜 목록에서 사라졌는지
    // 알 수 없고, 다시 켜는 방법도 없어진다.
    return this.categories.listTree(includeInactive !== 'false');
  }

  @Post()
  @ApiOperation({ summary: '업종 추가' })
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(admin, dto);
  }

  @Patch(':categoryId')
  @ApiOperation({
    summary: '업종 수정',
    description: 'code 는 바꿀 수 없다 — 시드·마이그레이션의 자연키이고 검색 URL 에 실린다.',
  })
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(admin, categoryId, dto);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '순서 재배치',
    description: '같은 단계의 업종 id 를 원하는 순서대로 전부 보낸다. 보낸 순서가 sortOrder 가 된다.',
  })
  reorder(@CurrentUser() admin: AuthenticatedUser, @Body() dto: ReorderCategoriesDto) {
    return this.categories.reorder(admin, dto);
  }

  @Delete(':categoryId')
  @ApiOperation({
    summary: '업종 삭제 (소프트)',
    description: '시설·이벤트·하위 업종이 하나라도 쓰고 있으면 409. 그 경우엔 비활성으로 바꾼다.',
  })
  remove(@CurrentUser() admin: AuthenticatedUser, @Param('categoryId') categoryId: string) {
    return this.categories.remove(admin, categoryId);
  }
}
