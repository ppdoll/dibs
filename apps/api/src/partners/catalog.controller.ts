import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import {
  CategoryResponseDto,
  ListCategoriesQueryDto,
  ListRegionsQueryDto,
  RegionResponseDto,
} from './dto/catalog.dto';

/**
 * 업종·지역 마스터 조회.
 *
 * 공개로 여는 이유: 시설 등록 폼과 로그인 전 탐색 화면의 필터가 **같은 목록**을 쓴다.
 * 인증을 걸면 프론트가 목록을 복제해서 갖게 되고, 그 사본은 반드시 원본과 어긋난다.
 */
@ApiTags('catalog')
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: '업종 분류 목록 (활성 항목만, 최대 2단계 트리)' })
  @ApiOkResponse({ type: [CategoryResponseDto] })
  listCategories(@Query() query: ListCategoriesQueryDto) {
    return this.catalog.listCategories(query);
  }

  @Get('regions')
  @ApiOperation({ summary: '행정구역 목록 (기본 SIDO, parentCode 로 하위 조회)' })
  @ApiOkResponse({ type: [RegionResponseDto] })
  listRegions(@Query() query: ListRegionsQueryDto) {
    return this.catalog.listRegions(query);
  }
}
