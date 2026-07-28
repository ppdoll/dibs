import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  EVENT_IMAGE_CONTENT_TYPES,
  type EventImageContentType,
} from '../internal/event-blob.service';

/** 1단계: 업로드 티켓 발급. 서버가 경로와 imageId 를 못 박는다. */
export class CreateEventImageTicketDto {
  @ApiProperty({ enum: [...EVENT_IMAGE_CONTENT_TYPES] })
  @IsIn([...EVENT_IMAGE_CONTENT_TYPES])
  contentType!: EventImageContentType;
}

/**
 * 2단계: 업로드가 끝난 blob 을 등록한다.
 *
 * byteSize·mimeType 을 받지 않는 이유: 서버가 head() 로 실제 blob 을 조회해 채운다.
 * 클라이언트가 보낸 값을 믿으면 용량·타입 상한이 장식이 된다.
 * width/height 만 클라이언트에서 받는다 — blob 메타데이터에 없고, 보안이 아니라 레이아웃용 값이다.
 */
export class RegisterEventImageDto {
  @ApiProperty({ description: '티켓 발급 시 받은 imageId' })
  @IsString()
  imageId!: string;

  @ApiProperty({ description: 'upload() 가 돌려준 blob URL' })
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  blobUrl!: string;

  @ApiProperty({ minimum: 1, maximum: 20_000 })
  @IsInt()
  @Min(1)
  @Max(20_000)
  width!: number;

  @ApiProperty({ minimum: 1, maximum: 20_000 })
  @IsInt()
  @Min(1)
  @Max(20_000)
  height!: number;

  @ApiPropertyOptional({ maxLength: 200, description: '대체 텍스트. 접근성 때문에 받아 둔다.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @ApiPropertyOptional({ description: 'base64 blur placeholder' })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  blurDataUrl?: string;

  @ApiPropertyOptional({ default: false, description: '대표 이미지로 지정. 기존 대표는 해제된다.' })
  @IsOptional()
  @IsBoolean()
  isCover?: boolean;
}

export class UpdateEventImageDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;
}

/**
 * 순서 재배치. 살아 있는 이미지 **전체**를 원하는 순서로 보낸다.
 *
 * 부분 갱신을 받지 않는 이유: (eventId, sortOrder) 부분 유니크 아래에서 일부만 옮기면
 * 중간 상태가 반드시 충돌한다. 전체를 받으면 서버가 음수 영역으로 한 번 대피시킨 뒤
 * 최종 값으로 다시 쓰는 2단계 쓰기로 한 트랜잭션 안에서 끝낼 수 있다
 * (부분 유니크는 DEFERRABLE 이 될 수 없다 — 001_constraints.sql §10 참고).
 */
export class ReorderEventImagesDto {
  @ApiProperty({ type: [String], description: '원하는 순서대로 나열한 이미지 id 전체' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  imageIds!: string[];
}
