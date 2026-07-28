import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 기간 중 유저에게 공개되는 **유일한** 경쟁 정보 (D-07).
 * 금액 분포·개인 순위·커트라인은 이 객체 어디에도 없다.
 */
export class CompetitionRatioDto {
  @ApiProperty({ example: 10 }) capacity!: number;
  @ApiProperty({ example: 47 }) applicantCount!: number;
  @ApiProperty({ nullable: true, example: 4.7, description: '정원이 0이면 null' })
  ratio!: number | null;
  @ApiProperty({ example: '4.7:1' }) display!: string;
}

/**
 * 목록·피드에 나가는 이벤트 카드.
 *
 * minAmount/maxAmount 는 **내가 써낼 수 있는 범위**(이벤트의 규칙)다.
 * 남이 써낸 금액이 아니다 — 그건 어떤 공개 경로에도 실리지 않는다 (IC-05).
 */
export class PublicEventCardDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) slug!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ example: 'BID' }) mode!: string;
  @ApiProperty({ example: 'OPEN' }) status!: string;

  @ApiProperty({ description: '참가 금액 규칙의 하한. INSTANT 는 고정 금액이 그대로 들어온다.' })
  minAmount!: number;
  @ApiProperty({ description: '참가 금액 규칙의 상한.' })
  maxAmount!: number;

  @ApiProperty() capacity!: number;
  @ApiProperty() applyStartAt!: Date;
  @ApiProperty() applyEndAt!: Date;
  @ApiProperty({ nullable: true }) serviceDate!: Date | null;
  @ApiProperty({ nullable: true, description: 'KST 벽시계 날짜(YYYY-MM-DD). 표시 전용.' })
  serviceDateKst!: string | null;

  @ApiPropertyOptional({
    type: CompetitionRatioDto,
    nullable: true,
    description:
      '파트너가 경쟁률 공개를 껐거나 표시 최소 인원에 미달하면 null. 숨김이 곧 "0명"으로 보이면 안 되므로 0이 아니라 null 이다.',
  })
  competition!: CompetitionRatioDto | null;

  @ApiProperty({ description: 'INSTANT 정원이 찼는지. BID 는 정원 초과를 허용하므로 항상 false (D-03).' })
  soldOut!: boolean;

  @ApiProperty() venueId!: string;
  @ApiProperty() venueName!: string;
  @ApiProperty() sido!: string;
  @ApiProperty() sigungu!: string;
  @ApiProperty({ nullable: true }) sigunguCode!: string | null;

  @ApiProperty({ nullable: true }) categoryId!: string | null;
  @ApiProperty({ nullable: true }) categoryNameKo!: string | null;
  @ApiProperty({ nullable: true }) categoryIconKey!: string | null;

  @ApiProperty({ nullable: true }) thumbnailUrl!: string | null;
  @ApiProperty({ nullable: true }) thumbnailBlurDataUrl!: string | null;

  @ApiProperty({ isArray: true, type: String }) tags!: string[];
}

export class PublicEventPageDto {
  @ApiProperty({ type: PublicEventCardDto, isArray: true }) items!: PublicEventCardDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
