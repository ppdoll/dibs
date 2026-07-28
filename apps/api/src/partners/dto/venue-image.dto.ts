import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { VENUE_IMAGE_CONTENT_TYPES } from '../internal/partner-blob.service';

/** 시설 1개가 가질 수 있는 이미지 수. 재배치 트랜잭션이 훑는 행 수의 상한이기도 하다. */
export const MAX_VENUE_IMAGES = 20;

export class VenueImageUploadTicketDto {
  @ApiProperty({ enum: VENUE_IMAGE_CONTENT_TYPES })
  @IsIn(VENUE_IMAGE_CONTENT_TYPES as readonly string[])
  contentType!: string;
}

export class VenueImageTicketResponseDto {
  @ApiProperty({ description: '이 id 로 업로드 완료 후 등록(register)을 호출한다.' })
  imageId!: string;

  @ApiProperty({ description: '클라이언트가 upload() 의 pathname 으로 그대로 쓴다.' })
  pathname!: string;

  @ApiProperty({ description: 'upload() 의 token. 이 경로·타입·크기로만 쓸 수 있다.' })
  clientToken!: string;

  @ApiProperty() expiresAt!: Date;
  @ApiProperty() maxBytes!: number;
  @ApiProperty({ type: [String] }) allowedContentTypes!: readonly string[];
}

/**
 * 업로드가 끝났다는 통보.
 *
 * width/height 를 클라이언트가 보내는 이유: 서버가 이미지를 디코딩하려면 sharp 같은
 * 네이티브 의존성이 필요한데, Vercel 함수 번들에 그걸 넣는 순간 콜드스타트가 배로 뛴다.
 * 크기·타입은 서버가 blob 메타로 직접 확인하므로(그쪽이 과금·저장에 영향을 준다)
 * 신뢰가 필요한 값은 클라이언트에서 오지 않는다. 해상도는 레이아웃 힌트일 뿐이다.
 */
export class RegisterVenueImageDto {
  @ApiProperty({ description: 'upload() 응답의 blob URL' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  blobUrl!: string;

  @ApiProperty({ minimum: 1, maximum: 20000 })
  @IsInt()
  @Min(1)
  @Max(20_000)
  width!: number;

  @ApiProperty({ minimum: 1, maximum: 20000 })
  @IsInt()
  @Min(1)
  @Max(20_000)
  height!: number;

  @ApiPropertyOptional({ maxLength: 120, description: '대체 텍스트(접근성)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  altText?: string;
}

export class UpdateVenueImageDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  altText?: string;
}

/**
 * 순서 재배치. **살아 있는 이미지 전체**를 원하는 순서대로 보낸다.
 *
 * 일부만 보내지 못하게 하는 이유: `venue_image_order_live_uq` 는 부분 유니크라
 * DEFERRABLE 이 될 수 없고(001_constraints.sql §10), 그래서 재배치가
 * "전부 음수로 대피 → 최종값 쓰기" 2단계다. 부분 집합만 옮기면 대피하지 않은 행이
 * 최종값과 충돌한다. 전체를 받으면 그 충돌 자체가 생기지 않는다.
 */
export class ReorderVenueImagesDto {
  @ApiProperty({ type: [String], maxItems: MAX_VENUE_IMAGES })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(MAX_VENUE_IMAGES)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  imageIds!: string[];
}

export class VenueImageResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() venueId!: string;
  @ApiProperty() blobUrl!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
  @ApiProperty({ nullable: true }) altText!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isCover!: boolean;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) quarantineReason!: string | null;
  @ApiProperty() createdAt!: Date;
}
