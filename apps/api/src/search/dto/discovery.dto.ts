import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { PublicEventCardDto } from './public-event.dto';

/**
 * 홈 피드 질의.
 *
 * 필터가 지역 하나뿐인 이유: 홈은 "무엇을 찾을지 아직 모르는 사람"의 화면이다.
 * 조건을 더 받기 시작하면 /search/events 와 같은 것이 되고, 정렬·페이지네이션이 없는
 * 이 응답 형태로는 그 요구를 감당할 수 없다. 좁히고 싶은 순간부터는 검색으로 보낸다.
 */
export class DiscoveryHomeQueryDto {
  @ApiPropertyOptional({
    description: '행정표준코드 시군구 5자리(예: 11680). 모든 섹션에 함께 걸린다.',
    example: '11680',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: '시군구 코드는 숫자 5자리입니다.' })
  sigunguCode?: string;
}

/** 홈 피드 섹션 키. 프론트가 이 값으로 섹션별 레이아웃을 고른다. */
export const DISCOVERY_SECTION_KEYS = [
  'DEADLINE_SOON',
  'NEWLY_OPENED',
  'POPULAR',
  'CATEGORY',
] as const;
export type DiscoverySectionKey = (typeof DISCOVERY_SECTION_KEYS)[number];

export class DiscoverySectionDto {
  @ApiProperty({ enum: DISCOVERY_SECTION_KEYS })
  key!: DiscoverySectionKey;

  @ApiProperty({ example: '마감임박' })
  titleKo!: string;

  @ApiProperty({
    nullable: true,
    description: 'CATEGORY 섹션일 때만 채워진다. 프론트가 "더보기" 링크를 만들 때 쓴다.',
  })
  categoryId!: string | null;

  @ApiProperty({ type: PublicEventCardDto, isArray: true })
  events!: PublicEventCardDto[];
}

export class DiscoveryCategoryChipDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameKo!: string;
  @ApiProperty({ nullable: true }) iconKey!: string | null;
}

export class DiscoveryHomeDto {
  @ApiProperty({ description: '이 피드를 만든 시각(UTC). 클라이언트 캐시 판단용.' })
  generatedAt!: Date;

  @ApiProperty({ type: DiscoveryCategoryChipDto, isArray: true })
  categories!: DiscoveryCategoryChipDto[];

  @ApiProperty({
    type: DiscoverySectionDto,
    isArray: true,
    description: '비어 있는 섹션은 응답에서 빠진다 — 프론트가 빈 캐러셀을 그리지 않도록.',
  })
  sections!: DiscoverySectionDto[];
}
