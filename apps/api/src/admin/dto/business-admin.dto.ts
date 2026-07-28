import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessVerificationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class BusinessQueueQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: BusinessVerificationStatus,
    default: BusinessVerificationStatus.PENDING,
    description: '기본값은 심사 대기(PENDING). business_verify_queue_idx 가 그대로 쓰인다.',
  })
  @IsOptional()
  @IsEnum(BusinessVerificationStatus)
  status?: BusinessVerificationStatus;

  @ApiPropertyOptional({ maxLength: 80, description: '상호·법인명·사업자등록번호 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class VerifyBusinessDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: '확인 메모. 감사 로그에만 남고 파트너에게는 안 간다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}
