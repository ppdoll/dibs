import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { IfMatchVersionDto } from './admin-common.dto';

export class EventOpsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ maxLength: 80, description: '이벤트 제목 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: '특정 파트너의 이벤트만' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  partnerId?: string;

  /** 이 업종의 이벤트만. 업종 관리 화면의 "이벤트 N건"이 여기로 넘어온다. */
  @ApiPropertyOptional({ description: '이 업종의 이벤트만' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;
}

export class ForceCloseEventDto extends IfMatchVersionDto {
  @ApiProperty({ maxLength: 500, description: '강제 마감 사유. 파트너에게 통보된다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/**
 * 마감 연장. 분 단위로만 받는다.
 *
 * 절대 시각을 받지 않는 이유: 운영자 브라우저의 시계와 서버 시계가 다르면
 * "10분 연장"이 과거로 가는 연장이 될 수 있고, 그러면 이미 열려 있는 예약금 홀드가
 * 만료 시각보다 늦은 순위 확정 시각을 갖게 된다(IC-26 이 막는 상황).
 * 상한 24시간은 실수로 0 하나를 더 붙이는 것을 막는다.
 */
export class ExtendDeadlineDto extends IfMatchVersionDto {
  @ApiProperty({ minimum: 1, maximum: 1440, description: '연장할 분. 현재 applyEndAt 에 더한다.' })
  @IsInt()
  @Min(1)
  @Max(1440)
  extendMinutes!: number;

  @ApiProperty({ maxLength: 500, description: '연장 사유. 신청자 알림 본문에는 들어가지 않는다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
