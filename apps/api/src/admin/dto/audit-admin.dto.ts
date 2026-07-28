import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, AuditActorRole, AuditTargetType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 감사 로그 조회.
 *
 * CursorPaginationDto 를 상속하지 않는다: 공통 커서는 `id` 기준인데 AuditLog 의 전순서는
 * `seq`(BigInt) 다. id 로 페이징하면 같은 밀리초에 들어온 두 행의 순서가 뒤집혀
 * "체인 순서대로 읽는다"는 이 화면의 유일한 존재 이유가 깨진다.
 */
export class AuditLogQueryDto {
  @ApiPropertyOptional({ description: '이 seq 보다 작은 행부터(내림차순 페이징).' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  beforeSeq?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({ description: '행위자 User.id' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  actorUserId?: string;

  @ApiPropertyOptional({ enum: AuditActorRole })
  @IsOptional()
  @IsEnum(AuditActorRole)
  actorRole?: AuditActorRole;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditTargetType })
  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;

  @ApiPropertyOptional({ description: 'targetType 과 함께 써야 idx_audit_target 을 탄다.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  targetId?: string;

  @ApiPropertyOptional({ description: '한 요청이 만든 감사 행 묶음' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;

  @ApiPropertyOptional({ description: '이 시각 이후(ISO8601, UTC)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: '이 시각 이전(ISO8601, UTC)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AuditChainVerifyQueryDto {
  @ApiPropertyOptional({
    description: "검증할 체인 샤드. 예: 'USER', 'SETTING', 'event:clx...'. 비우면 'SYSTEM'.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  chainKey?: string;

  @ApiPropertyOptional({ default: 500, minimum: 1, maximum: 2000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  limit: number = 500;
}
