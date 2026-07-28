import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegionLevel } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

/**
 * Category / Region 은 이 모듈에서 **읽기 전용**이다(쓰기는 운영자 모듈).
 * 여기 있는 이유는 시설 등록 폼의 드롭다운이 이 두 목록 없이는 아무것도 못 하기 때문이다.
 */
export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ description: '지정하면 그 하위 카테고리만. 생략하면 2단계 트리 전체.' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  parentId?: string;
}

export class ListRegionsQueryDto {
  @ApiPropertyOptional({
    enum: RegionLevel,
    description: '생략하면 SIDO. 시설 등록에 쓸 수 있는 건 SIGUNGU 뿐이다(001_constraints.sql 12-3).',
  })
  @IsOptional()
  @IsEnum(RegionLevel)
  level?: RegionLevel;

  @ApiPropertyOptional({ description: '상위 지역 code. SIGUNGU 를 받을 때 시/도 code 를 넣는다.' })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  parentCode?: string;
}

export class CategoryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameKo!: string;
  @ApiProperty({ nullable: true }) nameEn!: string | null;
  @ApiProperty({ nullable: true }) iconKey!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ nullable: true }) parentId!: string | null;
  // 자기 참조라 thunk 로 넘긴다. 배열 리터럴로 쓰면 클래스 정의가 끝나기 전에 평가된다.
  @ApiProperty({ type: () => [CategoryResponseDto] }) children!: CategoryResponseDto[];
}

export class RegionResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty({ enum: RegionLevel }) level!: RegionLevel;
  @ApiProperty() displayName!: string;
  @ApiProperty() sido!: string;
  @ApiProperty({ nullable: true }) sigungu!: string | null;
  @ApiProperty({ nullable: true, description: '행정표준코드 5자리. code(법정동 10자리)와 값 공간이 다르다.' })
  sigunguCode!: string | null;
  @ApiProperty({ nullable: true }) parentCode!: string | null;
}
