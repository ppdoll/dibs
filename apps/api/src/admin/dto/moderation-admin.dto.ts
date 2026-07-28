import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VenueStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class VenueModerationQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: VenueStatus })
  @IsOptional()
  @IsEnum(VenueStatus)
  status?: VenueStatus;

  @ApiPropertyOptional({ maxLength: 80, description: '매장명 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  /**
   * 이 업종을 쓰는 시설만. 업종 관리 화면의 "시설 N곳"이 여기로 넘어온다.
   *
   * 대표 업종(categoryId)과 보조 업종(secondaryCategories) 둘 다 본다 — 업종을 지울 수
   * 있는지 판단할 때 두 쪽을 모두 막으므로, 목록도 같은 기준이어야 "왜 못 지우지"를
   * 화면에서 납득할 수 있다.
   */
  @ApiPropertyOptional({ description: '이 업종을 쓰는 시설만 (대표·보조 모두 포함)' })
  @IsOptional()
  @IsString()
  categoryId?: string;
}

export class HideVenueDto {
  @ApiProperty({ maxLength: 500, description: '비공개 전환 사유. 파트너에게 통보된다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class RestoreVenueDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class QuarantineImageDto {
  @ApiProperty({ maxLength: 500, description: '격리 사유. VenueImage.quarantineReason 에 저장된다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
