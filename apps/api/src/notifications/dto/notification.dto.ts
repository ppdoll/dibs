import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationCategory, NotificationPriority, NotificationType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class NotificationListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: NotificationCategory, description: '범주 필터' })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ default: false, description: '안 읽은 것만' })
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;
}

/**
 * 수신함 1건.
 *
 * `payload` 가 없는 것이 이 DTO 의 핵심이다 — 사용자가 알아야 할 내용은 전부
 * titleKo/bodyKo 에 이미 렌더링돼 있고, 원본 payload 를 함께 내보내면 새 템플릿 하나가
 * 화이트리스트를 잘못 넓혔을 때 그 값이 목록 API 로 그대로 새어 나간다. (D-07 / IC-44)
 */
export class NotificationItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty({ enum: NotificationCategory }) category!: NotificationCategory;
  @ApiProperty({ enum: NotificationPriority }) priority!: NotificationPriority;
  @ApiProperty() titleKo!: string;
  @ApiProperty() bodyKo!: string;
  @ApiProperty({ nullable: true, description: 'Next.js 내부 상대경로' })
  deepLinkPath!: string | null;
  @ApiProperty({ nullable: true }) eventId!: string | null;
  @ApiProperty({ nullable: true }) applicationId!: string | null;
  @ApiProperty({ nullable: true }) readAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class UnreadCountDto {
  @ApiProperty({ description: '시스템 알림 미열람 수' }) notifications!: number;
  @ApiProperty({ description: '쪽지 미열람 수' }) messages!: number;
  @ApiProperty({ description: '배지에 찍을 합계' }) total!: number;
}

export class MarkAllReadResultDto {
  @ApiProperty({ description: '이번 호출로 읽음 처리된 건수. 재호출하면 0이다.' })
  updated!: number;
}
