import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { EventMode, EventStatus } from '@prisma/client';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/** 파트너의 내 이벤트 목록. 상태 필터는 자기 이벤트에 대해서만 의미가 있다. */
export class PartnerEventListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ description: '특정 시설의 이벤트만' })
  @IsOptional()
  @IsString()
  venueId?: string;
}

/**
 * 공개 목록. 상태 필터가 없는 게 의도다 —
 * 무엇이 보이는지는 PUBLIC_EVENT_WHERE 하나가 정하고 클라이언트가 넓힐 수 없다(IC-51).
 */
export class PublicEventListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: EventMode })
  @IsOptional()
  @IsEnum(EventMode)
  mode?: EventMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '행정표준코드 시군구 5자리(예: 11680)' })
  @IsOptional()
  @IsString()
  @Length(5, 5)
  sigunguCode?: string;
}
