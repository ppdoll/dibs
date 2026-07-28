import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ApplicationStatus,
  BroadcastSegment,
  BroadcastStatus,
  NotificationCategory,
  NotificationChannel,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class BroadcastListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: BroadcastStatus })
  @IsOptional()
  @IsEnum(BroadcastStatus)
  status?: BroadcastStatus;
}

/**
 * 공지 작성.
 *
 * 세그먼트별 부가 조건을 각각 다른 컬럼으로 받지 않고 하나의 DTO 에 모아 두고,
 * 서비스가 세그먼트에 맞는 것만 골라 `Broadcast.segmentFilter` 로 굳힌다.
 * 팬아웃은 나중에(또는 재실행으로) 일어나므로, 그때 대상 정의를 다시 지어내지 않으려면
 * 조건이 행으로 남아 있어야 한다.
 */
export class CreateBroadcastDto {
  @ApiProperty({ enum: BroadcastSegment })
  @IsEnum(BroadcastSegment)
  segment!: BroadcastSegment;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  titleKo!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  bodyKo!: string;

  @ApiPropertyOptional({
    enum: NotificationChannel,
    isArray: true,
    description: '비우면 앱 내 알림만. EMAIL 을 넣으면 아웃박스 행이 함께 생긴다.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsEnum(NotificationChannel, { each: true })
  channels?: NotificationChannel[];

  @ApiPropertyOptional({ enum: NotificationCategory, default: NotificationCategory.ANNOUNCEMENT })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ description: 'EVENT_* 세그먼트에서 필수.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  eventId?: string;

  @ApiPropertyOptional({
    enum: ApplicationStatus,
    isArray: true,
    description: 'EVENT_APPLICANTS_BY_STATUS 에서만 쓴다.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(ApplicationStatus, { each: true })
  applicationStatuses?: ApplicationStatus[];

  @ApiPropertyOptional({ maxLength: 10, description: 'REGION 세그먼트의 User.preferredRegionCode' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  regionCode?: string;

  @ApiPropertyOptional({ description: 'CATEGORY_INTEREST 세그먼트의 Category.id' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;

  @ApiPropertyOptional({
    minimum: 7,
    maximum: 3650,
    description: 'INACTIVE_USERS 세그먼트: 마지막 로그인이 N일 이전인 계정.',
  })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(3650)
  inactiveDays?: number;

  @ApiPropertyOptional({
    isArray: true,
    type: String,
    maxItems: 500,
    description: 'EXPLICIT_USER_LIST 세그먼트. 한 번에 500명까지.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({ description: '예약 발송 시각(ISO8601, UTC). 비우면 DRAFT 로 만든다.' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiProperty({
    maxLength: 64,
    description:
      '클라이언트가 만드는 멱등 키. Broadcast.idempotencyKey 가 전역 유니크라 재시도가 공지를 두 번 만들지 않는다.',
  })
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;
}

export class ScheduleBroadcastDto {
  @ApiProperty({ description: '예약 발송 시각(ISO8601, UTC).' })
  @IsDateString()
  scheduledAt!: string;
}
