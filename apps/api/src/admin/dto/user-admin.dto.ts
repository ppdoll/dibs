import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, UserRole } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class UserSearchQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ maxLength: 100, description: '이메일·닉네임·전화번호 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class SuspendUserDto {
  @ApiProperty({ maxLength: 500, description: '정지 사유. User.statusReason 에 저장되고 알림에도 실린다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description: '자동 해제 시각(ISO8601, UTC). 비우면 무기한 — 운영자가 손으로 풀어야 한다.',
  })
  @IsOptional()
  @IsDateString()
  suspendedUntil?: string;
}

export class ReinstateUserDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ChangeUserRolesDto {
  @ApiProperty({
    enum: UserRole,
    isArray: true,
    description: '교체할 역할 전체 집합. USER 는 반드시 포함해야 한다(부분 갱신이 아니다).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(3)
  @IsEnum(UserRole, { each: true })
  roles!: UserRole[];

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
