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
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/**
 * 운영자 세그먼트 공지. (D-10)
 *
 * 세그먼트 파라미터를 자유 형식 JSON 으로 받지 않고 필드로 펼쳐 놓은 이유:
 * 전역 ValidationPipe 가 `forbidNonWhitelisted` 라 선언되지 않은 키는 애초에 못 들어오고,
 * 그래야 "REGION 공지인데 regionCode 를 안 보냈다" 같은 실수가 **발송 전에** 400 으로 잡힌다.
 * 확장 크론이 그걸 발견하면 이미 상태가 EXPANDING 이라 되돌리기가 훨씬 성가시다.
 */
export class CreateBroadcastDto {
  @ApiProperty({ enum: BroadcastSegment })
  @IsEnum(BroadcastSegment)
  segment!: BroadcastSegment;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  titleKo!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  bodyKo!: string;

  @ApiPropertyOptional({
    enum: NotificationCategory,
    default: NotificationCategory.ANNOUNCEMENT,
    description: 'MARKETING 이면 광고 수신 동의자에게만 나가고 제목에 (광고)가 붙는다.',
  })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ enum: NotificationChannel, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(2)
  @IsEnum(NotificationChannel, { each: true })
  channels?: NotificationChannel[];

  @ApiPropertyOptional({ description: 'EVENT_* 세그먼트에 필요' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  eventId?: string;

  @ApiPropertyOptional({ enum: ApplicationStatus, isArray: true, description: 'EVENT_APPLICANTS_BY_STATUS 에 필요' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.keys(ApplicationStatus).length)
  @IsEnum(ApplicationStatus, { each: true })
  applicationStatuses?: ApplicationStatus[];

  @ApiPropertyOptional({ description: 'REGION 세그먼트에 필요. 법정동코드 10자리.' })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  regionCode?: string;

  @ApiPropertyOptional({ description: 'CATEGORY_INTEREST 세그먼트에 필요' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  categoryId?: string;

  @ApiPropertyOptional({ description: 'EXPLICIT_USER_LIST 세그먼트에 필요', maxItems: 1000 })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({ default: 90, description: 'INACTIVE_USERS 기준일수' })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(3650)
  inactiveSinceDays?: number;

  @ApiPropertyOptional({ description: '예약 발송 시각(ISO). 비우면 즉시 확장을 시작한다.' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiProperty({ description: '재시도 안전장치. 같은 키로 두 번 부르면 같은 공지를 돌려준다.' })
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;
}

export class BroadcastListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: BroadcastStatus })
  @IsOptional()
  @IsEnum(BroadcastStatus)
  status?: BroadcastStatus;
}

export class BroadcastSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: BroadcastSegment }) segment!: BroadcastSegment;
  @ApiProperty({ enum: BroadcastStatus }) status!: BroadcastStatus;
  @ApiProperty() titleKo!: string;
  @ApiProperty({ nullable: true }) eventId!: string | null;
  @ApiProperty() totalRecipients!: number;
  @ApiProperty() sentCount!: number;
  @ApiProperty() failedCount!: number;
  @ApiProperty() suppressedCount!: number;
  @ApiProperty({ nullable: true }) moderationNote!: string | null;
  @ApiProperty() createdAt!: Date;
}
