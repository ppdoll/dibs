import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { BUSINESS_DOC_CONTENT_TYPES } from '../internal/partner-blob.service';

/** 하이픈은 받아주되 저장은 10자리 숫자로 정규화한다(internal/brn.ts). */
const BRN_PATTERN = /^\d{3}-?\d{2}-?\d{5}$/;
/** 국내 전화번호. 지역번호·휴대폰·대표번호를 모두 받는다. */
const PHONE_PATTERN = /^0\d{1,2}-?\d{3,4}-?\d{4}$|^1\d{3}-?\d{4}$/;
const POSTAL_PATTERN = /^\d{5}$/;

export class CreateBusinessDto {
  @ApiProperty({ maxLength: 60, description: '브랜드/상호' })
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiProperty({ maxLength: 60, description: '사업자등록증상 법인/개인 상호' })
  @IsString()
  @Length(1, 60)
  legalName!: string;

  @ApiProperty({ example: '123-45-67890', description: '하이픈 유무 무관. 저장은 10자리로 정규화된다.' })
  @Matches(BRN_PATTERN, { message: '사업자등록번호 형식이 올바르지 않습니다.' })
  businessRegistrationNumber!: string;

  @ApiProperty({ enum: BusinessType })
  @IsEnum(BusinessType)
  businessType!: BusinessType;

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @Length(1, 30)
  representativeName!: string;

  @ApiProperty({ maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  contactEmail!: string;

  @ApiProperty({ example: '02-1234-5678' })
  @Matches(PHONE_PATTERN, { message: '전화번호 형식이 올바르지 않습니다.' })
  contactPhone!: string;

  @ApiPropertyOptional({ example: '06236' })
  @IsOptional()
  @Matches(POSTAL_PATTERN, { message: '우편번호는 5자리 숫자입니다.' })
  postalCode?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  roadAddress?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  detailAddress?: string;
}

/**
 * 수정 가능한 필드만 담는다.
 *
 * 사업자등록번호·업종·대표자명은 심사 대상 정보라 심사 중(PENDING)·승인 후(VERIFIED)에는
 * 잠긴다. 잠금은 서비스 검사가 아니라 UPDATE 의 WHERE 절에서 한다.
 */
export class UpdateBusinessDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  legalName?: string;

  @ApiPropertyOptional({ example: '123-45-67890', description: '심사 중/승인 상태에서는 변경할 수 없다.' })
  @IsOptional()
  @Matches(BRN_PATTERN, { message: '사업자등록번호 형식이 올바르지 않습니다.' })
  businessRegistrationNumber?: string;

  @ApiPropertyOptional({ enum: BusinessType, description: '심사 중/승인 상태에서는 변경할 수 없다.' })
  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  @ApiPropertyOptional({ maxLength: 30, description: '심사 중/승인 상태에서는 변경할 수 없다.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  representativeName?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: '전화번호 형식이 올바르지 않습니다.' })
  contactPhone?: string;

  @ApiPropertyOptional({ example: '06236' })
  @IsOptional()
  @Matches(POSTAL_PATTERN, { message: '우편번호는 5자리 숫자입니다.' })
  postalCode?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  roadAddress?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  detailAddress?: string;
}

export class BusinessDocUploadTokenDto {
  @ApiProperty({ enum: BUSINESS_DOC_CONTENT_TYPES })
  @IsIn(BUSINESS_DOC_CONTENT_TYPES as readonly string[])
  contentType!: string;
}

export class AttachBusinessDocDto {
  @ApiProperty({ description: '업로드 티켓으로 받은 pathname. 이 값만 저장한다(URL 은 저장하지 않는다).' })
  @IsString()
  @MaxLength(500)
  pathname!: string;

  @ApiProperty({ description: '업로드 응답의 blob URL. 존재 확인에만 쓰고 응답으로 되돌려주지 않는다.' })
  @IsString()
  @MaxLength(500)
  blobUrl!: string;
}

/** 심사 제출. 별도 입력은 없지만 확인 문구를 남겨 실수 제출을 줄인다. */
export class SubmitBusinessVerificationDto {
  @ApiPropertyOptional({ maxLength: 500, description: '심사자에게 남기는 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

export class BusinessResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() legalName!: string;
  @ApiProperty({ description: '하이픈 없는 10자리' }) businessRegistrationNumber!: string;
  @ApiProperty({ enum: BusinessType }) businessType!: BusinessType;
  @ApiProperty() representativeName!: string;
  @ApiProperty() verificationStatus!: string;
  @ApiProperty({ nullable: true }) verificationSubmittedAt!: Date | null;
  @ApiProperty({ nullable: true }) verifiedAt!: Date | null;
  @ApiProperty({ nullable: true }) verificationRejectionReason!: string | null;
  @ApiProperty({ description: '사본이 올라와 있는지. 경로·URL 자체는 내려주지 않는다.' })
  hasRegistrationDoc!: boolean;
  @ApiProperty() contactEmail!: string;
  @ApiProperty() contactPhone!: string;
  @ApiProperty({ nullable: true }) postalCode!: string | null;
  @ApiProperty({ nullable: true }) roadAddress!: string | null;
  @ApiProperty({ nullable: true }) detailAddress!: string | null;
  @ApiProperty() venueCount!: number;
  @ApiProperty() createdAt!: Date;
}
