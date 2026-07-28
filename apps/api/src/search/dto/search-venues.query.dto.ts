import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export const VENUE_SORTS = ['relevance', 'popular', 'newest', 'name'] as const;
export type VenueSort = (typeof VENUE_SORTS)[number];

export class SearchVenuesQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: '검색어. 매장명·검색 텍스트를 본다.', maxLength: 40 })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 40)
  keyword?: string;

  @ApiPropertyOptional({
    description: '행정표준코드 시군구 5자리. Region 을 거쳐 Venue.regionCode(법정동 10자리)로 좁힌다.',
    example: '11680',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: '시군구 코드는 숫자 5자리입니다.' })
  sigunguCode?: string;

  @ApiPropertyOptional({ description: 'Category.id — 시설의 대표 업종으로만 거른다.' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  categoryId?: string;

  @ApiPropertyOptional({
    enum: VENUE_SORTS,
    default: 'relevance',
    description: 'relevance 는 검색어가 있을 때만 의미가 있다(유사도순). 없으면 popular 로 떨어진다.',
  })
  @IsOptional()
  @IsIn(VENUE_SORTS)
  sort: VenueSort = 'relevance';
}
