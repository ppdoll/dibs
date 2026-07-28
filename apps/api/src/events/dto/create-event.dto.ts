import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DepositType, EventMode, VisibilityLevel } from '@prisma/client';
import { AMOUNT_MAX, DEFAULT_DEPOSIT_WINDOW_MINUTES } from '@dibs/shared';

/**
 * 이벤트 생성. 항상 DRAFT 로 만들어진다 — 공개는 publish 로 따로 한다.
 *
 * 여기에 **없는** 것들이 중요하다:
 *  - `sigunguCode` / `regionId`: 클라이언트가 못 넣는다. venue.region 에서 복사하는 경로 하나뿐이다(IC-52).
 *  - `status` / `version` / `policyVersion` / `claimedCount`: 전부 서버가 소유하는 상태다.
 *  - `rankingLockAt`: applyEndAt 과 예약금 윈도우에서 파생한다(D-04).
 * 전역 ValidationPipe 가 whitelist + forbidNonWhitelisted 라, 선언되지 않은 키는 요청 자체가 거절된다.
 */
export class CreateEventDto {
  @ApiProperty({ description: '이벤트를 여는 시설. 요청자 소유여야 한다.' })
  @IsString()
  venueId!: string;

  @ApiPropertyOptional({ description: '분류. 생략하면 시설의 대표 카테고리를 쓰지 않고 비워 둔다.' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @Length(1, 80)
  title!: string;

  @ApiPropertyOptional({ description: '주소에 쓸 슬러그. 생략하면 제목에서 만든다(항상 무작위 꼬리가 붙는다).' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(10_000)
  description!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  tags?: string[];

  @ApiProperty({ enum: EventMode, description: 'INSTANT=선착순 즉시확정(고정 금액), BID=금액 입찰형' })
  @IsEnum(EventMode)
  mode!: EventMode;

  @ApiProperty({ minimum: 1, description: '정원. 신청 자체를 막지는 않는다 — 초과 신청은 허용된다(D-03).' })
  @IsInt()
  @Min(1)
  capacity!: number;

  // ─── 금액 규칙 (모드별 배타) ────────────────────────────────────────────
  // INSTANT 는 fixedAmount 만, BID 는 min/max 만 쓴다. 두 벌이 다 채워지면 거절한다.

  @ApiPropertyOptional({ description: 'INSTANT 전용 고정 금액(원)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(AMOUNT_MAX)
  fixedAmount?: number;

  @ApiPropertyOptional({ description: 'BID 전용 최소 금액(원). max와 같게 두면 고정가.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(AMOUNT_MAX)
  minAmount?: number;

  @ApiPropertyOptional({ description: 'BID 전용 최대 금액(원)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(AMOUNT_MAX)
  maxAmount?: number;

  @ApiPropertyOptional({ default: 1, description: '입찰 금액 단위(원). 0은 DB CHECK가 막는다.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountStep?: number;

  // ─── 기간 / 이용 일시 ───────────────────────────────────────────────────

  @ApiProperty({ type: String, format: 'date-time', description: 'UTC ISO8601' })
  @Type(() => Date)
  @IsDate()
  applyStartAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  applyEndAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: '이용 시작. 마감 이후여야 한다.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  serviceStartAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  serviceEndAt?: Date;

  // ─── 예약금 정책 (D-05) ─────────────────────────────────────────────────

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  depositRequired?: boolean;

  @ApiPropertyOptional({ enum: DepositType })
  @IsOptional()
  @IsEnum(DepositType)
  depositType?: DepositType;

  @ApiPropertyOptional({ description: '정액 예약금(원). depositType=FIXED일 때 필수.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AMOUNT_MAX)
  depositFixedAmount?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10_000,
    description: '정률 예약금(베이시스포인트, 1000=10%). 부동소수를 쓰지 않으려고 bp로 받는다.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  depositPercentBp?: number;

  @ApiPropertyOptional({ default: 100, description: '예약금 절사 단위(원)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  depositRoundingUnit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  depositMinAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  depositMaxAmount?: number;

  @ApiPropertyOptional({
    default: DEFAULT_DEPOSIT_WINDOW_MINUTES,
    minimum: 1,
    maximum: 1_440,
    description: '입금 제한 시간(분). 진행 중에는 줄일 수 없다(IC-26).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_440)
  depositWindowMinutes?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  depositRefundNote?: string;

  // ─── 소프트 클로즈 (D-08, BID 전용) ─────────────────────────────────────

  @ApiPropertyOptional({ default: false, description: '마감 직전 입찰이 들어오면 마감을 미룬다. BID만.' })
  @IsOptional()
  @IsBoolean()
  softCloseEnabled?: boolean;

  @ApiPropertyOptional({ description: '마감 몇 분 전 입찰이 연장을 유발하는가' })
  @IsOptional()
  @IsInt()
  @Min(1)
  softCloseWindowMinutes?: number;

  @ApiPropertyOptional({ description: '유발되면 몇 분 미루는가' })
  @IsOptional()
  @IsInt()
  @Min(1)
  softCloseExtendMinutes?: number;

  @ApiPropertyOptional({ default: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  softCloseMaxExtensions?: number;

  @ApiPropertyOptional({ default: 2, description: '1인이 유발할 수 있는 연장 횟수 상한(IC-17)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  softCloseMaxExtensionsPerUser?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: '아무리 연장해도 넘지 않는 최종 마감. 연장을 켜면 필수다.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  softCloseHardEndAt?: Date;

  // ─── 공개 정책 (D-07) ───────────────────────────────────────────────────
  // 기본값은 전부 비공개다. 커트라인/순위 토글은 자리만 만들어 두고 아직 켜지 않는다.

  @ApiPropertyOptional({ default: true, description: '경쟁률 표시 여부. 유일하게 공개되는 경쟁 정보다.' })
  @IsOptional()
  @IsBoolean()
  showCompetitionRatio?: boolean;

  @ApiPropertyOptional({
    default: 0,
    description: '이 인원 미만이면 경쟁률을 감춘다. 신청자가 한둘일 때의 경쟁률은 사실상 개인 정보다.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  ratioMinApplicantsToShow?: number;

  @ApiPropertyOptional({ enum: VisibilityLevel, default: VisibilityLevel.HIDDEN })
  @IsOptional()
  @IsEnum(VisibilityLevel)
  cutoffVisibility?: VisibilityLevel;

  @ApiPropertyOptional({ enum: VisibilityLevel, default: VisibilityLevel.HIDDEN })
  @IsOptional()
  @IsEnum(VisibilityLevel)
  rankVisibility?: VisibilityLevel;

  @ApiPropertyOptional({ enum: VisibilityLevel, default: VisibilityLevel.HIDDEN })
  @IsOptional()
  @IsEnum(VisibilityLevel)
  amountDistributionVisibility?: VisibilityLevel;
}
