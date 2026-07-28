import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VenueStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/** 국내 전화번호. 지역번호·휴대폰·대표번호를 모두 받는다. (business.dto.ts 와 같은 규칙) */
const PHONE_PATTERN = /^0\d{1,2}-?\d{3,4}-?\d{4}$|^1\d{3}-?\d{4}$/;
const POSTAL_PATTERN = /^\d{5}$/;
/** KST 벽시계. Timestamptz 가 아니라 "매주 반복되는 영업시간"이라 날짜가 없다. */
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** 시설 1개가 가질 수 있는 부가 카테고리 수. 검색 필터가 OR 로 퍼지는 걸 막는다. */
export const MAX_SECONDARY_CATEGORIES = 5;

/**
 * 요일별 영업시간 1줄.
 *
 * `timezone` 컬럼이 따로 있는데도 벽시계 문자열로 저장하는 이유:
 * "매주 화요일 11:00 오픈"은 서머타임·시간대 변경과 무관한 **규칙**이지 시각이 아니다.
 * UTC 로 환산해 저장하면 규칙이 아니라 그 시점의 계산 결과가 굳어버린다.
 */
export class DayHoursDto {
  @ApiProperty({ enum: WEEKDAYS })
  @IsIn(WEEKDAYS as readonly string[])
  day!: string;

  @ApiProperty({ description: '휴무일이면 true. 이때 open/close 는 무시된다.' })
  @IsBoolean()
  closed!: boolean;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @Matches(CLOCK_PATTERN, { message: '영업 시작시각은 HH:mm 형식입니다.' })
  open?: string;

  @ApiPropertyOptional({ example: '22:00', description: '익일 영업은 24:00 을 넘겨 적지 말고 다음 요일로 나눠 적는다.' })
  @IsOptional()
  @Matches(CLOCK_PATTERN, { message: '영업 종료시각은 HH:mm 형식입니다.' })
  close?: string;

  @ApiPropertyOptional({ example: '21:00' })
  @IsOptional()
  @Matches(CLOCK_PATTERN, { message: '라스트오더는 HH:mm 형식입니다.' })
  lastOrder?: string;
}

/** 특정 날짜의 예외(공휴일·정기휴무). 요일 규칙보다 우선한다. */
export class SpecialHoursDto {
  @ApiProperty({ example: '2026-09-28' })
  @Matches(DATE_PATTERN, { message: '날짜는 YYYY-MM-DD 형식입니다.' })
  date!: string;

  @ApiProperty()
  @IsBoolean()
  closed!: boolean;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @Matches(CLOCK_PATTERN)
  open?: string;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @Matches(CLOCK_PATTERN)
  close?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  note?: string;
}

export class CreateVenueDto {
  @ApiProperty({ description: '내 사업자 id. 시설은 사업자 아래에서만 만들어진다.' })
  @IsString()
  @Length(1, 40)
  businessId!: string;

  @ApiProperty({ maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiPropertyOptional({ maxLength: 60, description: '목록 카드 한 줄 소개' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  summary?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    maxLength: 60,
    description: 'slug 로 쓸 문자열. 어차피 무작위 꼬리가 붙으므로 중복을 걱정하지 않아도 된다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  slugBase?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 40)
  primaryCategoryId!: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_SECONDARY_CATEGORIES })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_SECONDARY_CATEGORIES)
  @IsString({ each: true })
  secondaryCategoryIds?: string[];

  @ApiProperty({
    maxLength: 10,
    description: '법정동코드 10자리. SIGUNGU 레벨만 허용된다(001_constraints.sql 12-3).',
  })
  @IsString()
  @Length(1, 10)
  regionCode!: string;

  @ApiProperty({ example: '06236' })
  @Matches(POSTAL_PATTERN, { message: '우편번호는 5자리 숫자입니다.' })
  postalCode!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Length(1, 255)
  roadAddress!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  detailAddress?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiProperty({ example: '02-1234-5678' })
  @Matches(PHONE_PATTERN, { message: '전화번호 형식이 올바르지 않습니다.' })
  phone!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'dibs.gangnam', maxLength: 40 })
  @IsOptional()
  @Matches(/^[A-Za-z0-9._]{1,30}$/, { message: '인스타그램 아이디 형식이 올바르지 않습니다.' })
  instagramHandle?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  seatCount?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reservationNotice?: string;

  @ApiPropertyOptional({ type: [DayHoursDto], maxItems: 7 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  businessHours?: DayHoursDto[] | null;

  @ApiPropertyOptional({ type: [SpecialHoursDto], maxItems: 60 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SpecialHoursDto)
  specialHours?: SpecialHoursDto[] | null;
}

/**
 * 수정 가능한 필드.
 *
 * `businessId` 가 없는 이유: 시설을 다른 사업자로 옮기는 것은 **소유권 이동**이다.
 * 이 모듈의 모든 권한 검사가 `venue.business.partnerProfileId` 를 타고 내려가므로,
 * 그 링크를 바꾸는 순간 이미 걸린 이벤트·신청의 소유자가 통째로 바뀐다.
 * 필요해지면 운영자 전용 이관 엔드포인트로 만들어야 한다.
 *
 * `slug` 도 없다. 공개된 주소가 바뀌면 이미 공유된 링크가 전부 깨진다.
 */
export class UpdateVenueDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  summary?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  primaryCategoryId?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_SECONDARY_CATEGORIES })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_SECONDARY_CATEGORIES)
  @IsString({ each: true })
  secondaryCategoryIds?: string[];

  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  regionCode?: string;

  @ApiPropertyOptional({ example: '06236' })
  @IsOptional()
  @Matches(POSTAL_PATTERN, { message: '우편번호는 5자리 숫자입니다.' })
  postalCode?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  roadAddress?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  detailAddress?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: '전화번호 형식이 올바르지 않습니다.' })
  phone?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @Matches(/^[A-Za-z0-9._]{1,30}$/, { message: '인스타그램 아이디 형식이 올바르지 않습니다.' })
  instagramHandle?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  seatCount?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reservationNotice?: string;

  @ApiPropertyOptional({ type: [DayHoursDto], maxItems: 7, description: 'null 을 보내면 지운다.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  businessHours?: DayHoursDto[] | null;

  @ApiPropertyOptional({ type: [SpecialHoursDto], maxItems: 60, description: 'null 을 보내면 지운다.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SpecialHoursDto)
  specialHours?: SpecialHoursDto[] | null;
}

export class ListVenuesQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: VenueStatus })
  @IsOptional()
  @IsEnum(VenueStatus)
  status?: VenueStatus;

  @ApiPropertyOptional({ description: '특정 사업자의 시설만' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  businessId?: string;
}

export class HideVenueDto {
  @ApiPropertyOptional({ maxLength: 200, description: '내부 메모. 이용자에게 노출되지 않는다.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

// --- 응답 ---

export class VenueImageBriefDto {
  @ApiProperty() id!: string;
  @ApiProperty() blobUrl!: string;
  @ApiProperty({ nullable: true }) altText!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isCover!: boolean;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) quarantineReason!: string | null;
}

export class VenueSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: VenueStatus }) status!: VenueStatus;
  @ApiProperty({ nullable: true }) summary!: string | null;
  @ApiProperty() sido!: string;
  @ApiProperty() sigungu!: string;
  @ApiProperty() imageCount!: number;
  @ApiProperty() openEventCount!: number;
  @ApiProperty({ nullable: true }) coverImageUrl!: string | null;
  @ApiProperty({ description: 'PATCH 의 If-Match 값' }) version!: number;
  @ApiProperty() createdAt!: Date;
}

export class VenueDetailDto extends VenueSummaryDto {
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() primaryCategoryId!: string;
  @ApiProperty({ type: [String] }) secondaryCategoryIds!: string[];
  @ApiProperty() regionCode!: string;
  @ApiProperty() postalCode!: string;
  @ApiProperty() roadAddress!: string;
  @ApiProperty({ nullable: true }) detailAddress!: string | null;
  @ApiProperty({ nullable: true }) latitude!: number | null;
  @ApiProperty({ nullable: true }) longitude!: number | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true }) websiteUrl!: string | null;
  @ApiProperty({ nullable: true }) instagramHandle!: string | null;
  @ApiProperty({ nullable: true }) seatCount!: number | null;
  @ApiProperty({ nullable: true }) reservationNotice!: string | null;
  @ApiProperty({ nullable: true }) businessHours!: unknown;
  @ApiProperty({ nullable: true }) specialHours!: unknown;
  @ApiProperty({ nullable: true }) submittedForReviewAt!: Date | null;
  @ApiProperty({ nullable: true }) publishedAt!: Date | null;
  @ApiProperty({ nullable: true }) hiddenAt!: Date | null;
  @ApiProperty({ nullable: true }) suspendedAt!: Date | null;
  @ApiProperty({ nullable: true }) suspensionReason!: string | null;
  @ApiProperty({ type: [VenueImageBriefDto] }) images!: VenueImageBriefDto[];
}
