import { ApiProperty } from '@nestjs/swagger';

export class PublicVenueCardDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true }) summary!: string | null;

  @ApiProperty() sido!: string;
  @ApiProperty() sigungu!: string;
  @ApiProperty() roadAddress!: string;
  @ApiProperty({ nullable: true }) latitude!: number | null;
  @ApiProperty({ nullable: true }) longitude!: number | null;

  @ApiProperty() categoryId!: string;
  @ApiProperty() categoryNameKo!: string;
  @ApiProperty({ nullable: true }) categoryIconKey!: string | null;

  @ApiProperty({ nullable: true }) coverImageUrl!: string | null;
  @ApiProperty({ nullable: true }) seatCount!: number | null;

  @ApiProperty({ description: '현재 열려 있는 이벤트 수(비정규화 캐시).' })
  openEventCount!: number;

  @ApiProperty({
    description: '검색어와의 pg_trgm 유사도(0~1). 검색어가 없으면 0.',
  })
  score!: number;
}

export class PublicVenuePageDto {
  @ApiProperty({ type: PublicVenueCardDto, isArray: true }) items!: PublicVenueCardDto[];
  @ApiProperty({
    nullable: true,
    description:
      '다음 페이지 커서. 시설 검색은 유사도순이라 id 키셋을 쓸 수 없어 오프셋을 커서로 감싼다.',
  })
  nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
