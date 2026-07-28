import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * 낙관적 락 토큰. (IC-63)
 *
 * 헤더 If-Match 가 아니라 본문 필드로 받는 이유: 운영자 콘솔의 모든 상태 전이가
 * POST 본문을 이미 보내고 있고, 본문이면 ValidationPipe 가 타입까지 검증해 준다.
 * 값의 의미는 IC-63 그대로 — `Event.version` 이지 `policyVersion` 이 아니다.
 */
export class IfMatchVersionDto {
  @ApiProperty({ description: '직전에 읽은 Event.version. 다르면 412가 아니라 409로 되돌린다.' })
  @IsInt()
  @Min(0)
  ifMatchVersion!: number;
}

/** 운영 조치의 사유. 감사 로그 reasonMemo 로 들어간다. */
export class AdminReasonDto {
  @ApiProperty({ maxLength: 500, description: '왜 이 조치를 했는지. 감사 로그에 그대로 남는다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class OptionalAdminReasonDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
