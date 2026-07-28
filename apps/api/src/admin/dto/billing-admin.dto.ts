import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventMode, FeeScope, FeeType, SettlementStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/** 원 단위 상한. Int 컬럼이라 2^31-1 을 넘길 수 없다. */
const KRW_MAX = 2_000_000_000;

export class PlatformFeeListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: FeeScope })
  @IsOptional()
  @IsEnum(FeeScope)
  scope?: FeeScope;

  @ApiPropertyOptional({ description: '종료되지 않은 정책만' })
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}

/**
 * 수수료 정책 생성. (D-05 보류 항목 / SETTLEMENT_ENABLED=false)
 *
 * 정책은 **덮어쓰지 않고 새로 만든다**. 정산은 과거 기간을 다시 계산하는 일이 잦은데,
 * 정책 행을 수정해 버리면 이미 계산된 Settlement.feePolicySnapshot 과 현재 정책이
 * 어긋나는데 그 차이를 설명할 근거가 사라진다.
 */
export class CreatePlatformFeeDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: FeeScope, default: FeeScope.GLOBAL })
  @IsEnum(FeeScope)
  scope!: FeeScope;

  @ApiPropertyOptional({ description: 'scope 가 GLOBAL 이 아닐 때의 대상 id(카테고리/지역/파트너).' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  scopeRefId?: string;

  @ApiPropertyOptional({ enum: EventMode, description: '모드별로 다르게 매길 때만.' })
  @IsOptional()
  @IsEnum(EventMode)
  eventMode?: EventMode;

  @ApiProperty({ enum: FeeType })
  @IsEnum(FeeType)
  feeType!: FeeType;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, description: '베이시스 포인트(350 = 3.5%).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  percentBps?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: KRW_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(KRW_MAX)
  fixedAmountKrw?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: KRW_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(KRW_MAX)
  minFeeKrw?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: KRW_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(KRW_MAX)
  maxFeeKrw?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  vatIncluded?: boolean;

  @ApiProperty({ description: '적용 시작(ISO8601, UTC).' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: '적용 종료(ISO8601, UTC). 비우면 무기한.' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class EndPlatformFeeDto {
  @ApiProperty({ description: '종료 시각(ISO8601, UTC).' })
  @IsDateString()
  effectiveTo!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class SettlementListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  partnerProfileId?: string;

  @ApiPropertyOptional({ description: "KST 기준 정산 월. 정확히 'YYYY-MM'." })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "periodKstMonth 는 'YYYY-MM' 형식이어야 합니다." })
  periodKstMonth?: string;
}

export class ComputeSettlementDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  eventId!: string;

  @ApiProperty({ description: "KST 기준 정산 월. 정확히 'YYYY-MM'." })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "periodKstMonth 는 'YYYY-MM' 형식이어야 합니다." })
  periodKstMonth!: string;
}

export class UpdateSettlementStatusDto {
  @ApiProperty({ enum: SettlementStatus })
  @IsEnum(SettlementStatus)
  status!: SettlementStatus;

  @ApiPropertyOptional({ maxLength: 200, description: 'ON_HOLD 로 보낼 때의 보류 사유.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  holdReason?: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
