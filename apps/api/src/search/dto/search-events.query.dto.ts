import { ApiPropertyOptional } from '@nestjs/swagger';
import { EventMode } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { PUBLIC_EVENT_STATUSES, type PublicEventStatus } from '../public-visibility';

/** 목록 정렬. 값은 URL 에 그대로 나가므로 kebab-case 로 고정한다. */
export const EVENT_SORTS = ['newest', 'ending-soon', 'popular', 'competition-ratio'] as const;
export type EventSort = (typeof EVENT_SORTS)[number];

/** "마감임박" 칩이 보내는 기본값. 서버는 값을 강제하지 않고 상한만 건다. */
export const DEADLINE_SOON_DEFAULT_HOURS = 48;

export class SearchEventsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: '검색어. 제목·태그·시설명을 본다.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 40)
  keyword?: string;

  @ApiPropertyOptional({
    description:
      'pg_trgm 유사도 검색을 쓴다. 오타·띄어쓰기 차이를 흡수하지만 ILIKE 보다 느리다. 기본은 ILIKE.',
    default: false,
  })
  @IsOptional()
  // enableImplicitConversion 은 Boolean('false') === true 로 뒤집힌다. 명시적으로 푼다.
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  fuzzy?: boolean;

  @ApiPropertyOptional({
    description: '행정표준코드 시군구 5자리(예: 11680). Event.sigunguCode 와 직접 비교한다.',
    example: '11680',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: '시군구 코드는 숫자 5자리입니다.' })
  sigunguCode?: string;

  @ApiPropertyOptional({ description: 'Category.id' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  categoryId?: string;

  @ApiPropertyOptional({ enum: EventMode, description: 'INSTANT(선착순) / BID(입찰형)' })
  @IsOptional()
  @IsIn(Object.values(EventMode))
  mode?: EventMode;

  @ApiPropertyOptional({
    enum: PUBLIC_EVENT_STATUSES,
    description: '공개 상태만 지정할 수 있다. 그 밖의 값은 400.',
  })
  @IsOptional()
  @IsIn(PUBLIC_EVENT_STATUSES)
  status?: PublicEventStatus;

  @ApiPropertyOptional({
    description:
      '이벤트 참가 금액 규칙의 하한 필터(원). 이 금액 이상을 써낼 수 있는 이벤트만 본다. 남이 써낸 금액과는 무관하다(D-07).',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountFrom?: number;

  @ApiPropertyOptional({
    description: '예산 상한(원). 이 금액 이하로 참가할 수 있는 이벤트만 본다.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountTo?: number;

  @ApiPropertyOptional({
    description: `마감까지 남은 시간(시간 단위). "마감임박" 칩은 ${DEADLINE_SOON_DEFAULT_HOURS} 을 보낸다.`,
    minimum: 1,
    maximum: 720,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  deadlineWithinHours?: number;

  @ApiPropertyOptional({ enum: EVENT_SORTS, default: 'ending-soon' })
  @IsOptional()
  @IsIn(EVENT_SORTS)
  sort: EventSort = 'ending-soon';
}
