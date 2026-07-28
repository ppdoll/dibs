import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * 업종 코드.
 *
 * 소문자·숫자·하이픈만 받는다. 이 값은 검색 쿼리스트링과 URL 에 그대로 실리고
 * 시드·마이그레이션이 자연키로 쓴다 — 한글이나 공백이 섞이면 인코딩 문제로
 * 조용히 다른 값이 된다.
 */
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class CreateCategoryDto {
  @ApiProperty({ example: 'fine-dining', maxLength: 40 })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(CODE_PATTERN, {
    message: '코드는 영문 소문자·숫자·하이픈만 쓸 수 있고 소문자나 숫자로 시작해야 합니다.',
  })
  code!: string;

  @ApiProperty({ example: '파인다이닝', maxLength: 40 })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nameKo!: string;

  @ApiPropertyOptional({ example: 'Fine dining', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  nameEn?: string;

  @ApiPropertyOptional({ description: 'lucide 아이콘 키', example: 'utensils', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  iconKey?: string;

  @ApiPropertyOptional({ description: '상위 업종 id. 트리는 2단계까지만 허용한다.' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ default: 0, description: '작을수록 앞. 화면 노출 순서다.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

/** 부분 수정. code 는 바꿀 수 없다 — 아래 컨트롤러 주석 참고. */
export class UpdateCategoryDto {
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  nameKo?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  nameEn?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  iconKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ description: '끄면 신규 등록·검색 필터에서 사라진다. 기존 시설은 그대로 남는다.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderCategoriesDto {
  @ApiProperty({
    type: [String],
    description: '같은 depth 의 업종 id 를 원하는 순서대로 **전부** 보낸다. 보낸 순서가 곧 sortOrder 다.',
  })
  @IsString({ each: true })
  orderedIds!: string[];
}

export class AdminCategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameKo!: string;
  @ApiProperty({ nullable: true }) nameEn!: string | null;
  @ApiProperty({ nullable: true }) iconKey!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true }) parentId!: string | null;
  @ApiProperty({ description: '이 업종을 쓰는 시설 수. 0 이 아니면 삭제할 수 없다.' })
  venueCount!: number;
  @ApiProperty({ description: '이 업종을 쓰는 이벤트 수.' })
  eventCount!: number;
  @ApiProperty({ type: [AdminCategoryDto], required: false })
  children?: AdminCategoryDto[];
}
