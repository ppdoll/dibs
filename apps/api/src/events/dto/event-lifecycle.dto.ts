import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EventCancelReason } from '@prisma/client';

/**
 * 조기 마감.
 *
 * 사유를 굳이 받지 않는 이유: 파트너가 직접 닫으면 항상 PARTNER_EARLY_CLOSE 다.
 * 나머지 사유(PERIOD_ENDED / ADMIN_FORCED / VENUE_SUSPENDED)는 각각 크론·운영자·시설 정지가 쓴다 —
 * 클라이언트가 고를 수 있게 두면 파트너가 자기 조기 마감을 "기간 종료"로 위장할 수 있다.
 */
export class CloseEventDto {
  @ApiPropertyOptional({ maxLength: 500, description: '파트너 메모. 감사 로그에만 남고 유저에게 가지 않는다.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

export class CancelEventDto {
  @ApiProperty({ enum: EventCancelReason })
  @IsEnum(EventCancelReason)
  reason!: EventCancelReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

/** 운영자 정지. 해제는 statusBeforeSuspend 로 되돌리므로 별도 입력이 없다. (IC-62) */
export class SuspendEventDto {
  @ApiProperty({ maxLength: 500, description: '정지 사유. 파트너 화면에 그대로 노출된다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
