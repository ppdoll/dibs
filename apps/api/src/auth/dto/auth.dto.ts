import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/** 가입 시 고르는 계정 종류 (D-09) */
export const SIGNUP_INTENTS = ['USER', 'PARTNER'] as const;
export type SignupIntent = (typeof SIGNUP_INTENTS)[number];

export class GoogleLoginQueryDto {
  @ApiPropertyOptional({
    enum: SIGNUP_INTENTS,
    description: '처음 가입하는 경우 어떤 계정으로 시작할지. 기존 회원이면 무시된다.',
  })
  @IsOptional()
  @IsIn(SIGNUP_INTENTS)
  intent?: SignupIntent;

  @ApiPropertyOptional({ description: '로그인 후 돌아갈 경로. 우리 도메인 내부 경로만 허용한다.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  redirect?: string;
}

/** 파트너 전환/신청서 제출 */
export class SubmitPartnerApplicationDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @Length(1, 50)
  contactName!: string;

  @ApiProperty({ maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  contactEmail!: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @ApiProperty({ description: '동의한 파트너 약관 버전' })
  @IsString()
  @MaxLength(20)
  partnerTermsVersion!: string;
}

export class MeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty() displayName!: string;
  @ApiProperty({ isArray: true }) roles!: string[];
  @ApiProperty() status!: string;
  @ApiProperty({ description: '파트너로 활동 가능한지. 역할만 있고 승인 전이면 false.' })
  partnerApproved!: boolean;
  @ApiProperty({ nullable: true }) partnerApprovalStatus!: string | null;
  @ApiProperty({ nullable: true }) partnerProfileId!: string | null;
}
