import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * 커서 페이지네이션.
 *
 * offset이 아니라 커서를 쓰는 이유: 목록이 신청 순으로 계속 늘어나므로
 * offset 방식은 페이지를 넘기는 사이 항목이 밀려 중복·누락이 생긴다.
 */
export class CursorPaginationDto {
  @ApiPropertyOptional({ description: '이전 응답의 nextCursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * limit + 1개를 조회해 넘겨받으면 다음 페이지 유무를 알 수 있다.
 * 별도 count 쿼리를 돌리지 않는다 — 큰 테이블에서 COUNT는 비싸다.
 */
export function toCursorPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    hasMore,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}
