import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DigestMode, NotificationCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, ValidateNested } from 'class-validator';

export class CategoryPreferenceDto {
  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category!: NotificationCategory;

  @ApiProperty({ description: '앱 내 수신' })
  @IsBoolean()
  inAppEnabled!: boolean;

  @ApiProperty({ description: '이메일 수신' })
  @IsBoolean()
  emailEnabled!: boolean;
}

/**
 * 알림 설정 변경.
 *
 * 필수 범주(DEPOSIT / RESULT / ACCOUNT)를 끄려는 요청은 **거절하지 않고 켠 채로 저장한다**.
 * 거절하면 프론트가 통짜 PUT 을 보낼 때마다 400 을 받아 다른 설정까지 저장이 안 되고,
 * 그렇다고 요청대로 꺼 버리면 사용자가 예약금 마감 안내를 못 받아 자리와 돈을 동시에 잃는다.
 * "저장은 되지만 필수 범주는 켜져 있다"가 유일하게 안전한 결과다. (IC-44)
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ type: [CategoryPreferenceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(Object.keys(NotificationCategory).length)
  @ValidateNested({ each: true })
  @Type(() => CategoryPreferenceDto)
  categories?: CategoryPreferenceDto[];

  @ApiPropertyOptional({ description: '마스터 이메일 스위치. CRITICAL·필수 범주는 이 값과 무관하게 나간다.' })
  @IsOptional()
  @IsBoolean()
  emailGloballyEnabled?: boolean;

  @ApiPropertyOptional({ enum: DigestMode })
  @IsOptional()
  @IsEnum(DigestMode)
  digestMode?: DigestMode;

  @ApiPropertyOptional({ description: '광고성 정보 수신 동의' })
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @ApiPropertyOptional({ description: '야간(21~08시) 광고성 정보 수신 동의' })
  @IsOptional()
  @IsBoolean()
  nightMarketingConsent?: boolean;
}

export class CategoryPreferenceViewDto extends CategoryPreferenceDto {
  @ApiProperty({ description: '필수 범주면 끌 수 없다. 코드 상수에서 파생된다(IC-44).' })
  mandatory!: boolean;
}

export class NotificationPreferencesDto {
  @ApiProperty({ type: [CategoryPreferenceViewDto] })
  categories!: CategoryPreferenceViewDto[];

  @ApiProperty() emailGloballyEnabled!: boolean;
  @ApiProperty({ enum: DigestMode }) digestMode!: DigestMode;
  @ApiProperty() marketingConsent!: boolean;
  @ApiProperty() nightMarketingConsent!: boolean;
  @ApiProperty({ nullable: true, description: '알림 수신 주소. 없으면 이메일이 나가지 않는다.' })
  notificationEmail!: string | null;
}
