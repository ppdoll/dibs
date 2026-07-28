import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationStatus, MessageKind, NotificationChannel } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class MessageListQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ default: false, description: '안 읽은 것만' })
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;
}

export class MessageItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: MessageKind }) kind!: MessageKind;
  @ApiProperty({ nullable: true }) eventId!: string | null;
  @ApiProperty({ nullable: true, description: '보낼 당시의 발신자 표시명 스냅샷' })
  senderDisplayName!: string | null;
  @ApiProperty() titleKo!: string;
  @ApiProperty() bodyKo!: string;
  @ApiProperty({ nullable: true }) readAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

/**
 * 파트너 → 자기 이벤트 신청자 발송. (D-10)
 *
 * 상태 필터를 두는 이유는 실무다 — "선정되신 분들께 준비물 안내" 와
 * "예약금 미납자에게 리마인드" 는 대상이 완전히 다르다. 비우면 전체 신청자다.
 *
 * 문구는 파트너가 직접 쓰므로 기계가 D-07 을 강제할 수 없다. 커트라인·순위를 암시하는
 * 표현이 감지되면 발송 대신 운영자 승인 큐로 보낸다(BroadcastStatus.PENDING_APPROVAL).
 */
export class SendEventMessageDto {
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
    enum: ApplicationStatus,
    isArray: true,
    description: '비우면 전체 신청자',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.keys(ApplicationStatus).length)
  @IsEnum(ApplicationStatus, { each: true })
  applicationStatuses?: ApplicationStatus[];

  @ApiPropertyOptional({
    enum: NotificationChannel,
    isArray: true,
    default: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    description:
      '쪽지(Message) 행은 채널과 무관하게 항상 만들어진다 — 그게 수신자 스냅샷이다. ' +
      'EMAIL 을 넣으면 메일도 함께 나간다.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(2)
  @IsEnum(NotificationChannel, { each: true })
  channels?: NotificationChannel[];

  @ApiProperty({ description: '재시도 안전장치. 같은 키로 두 번 부르면 같은 발송을 돌려준다.' })
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;
}
