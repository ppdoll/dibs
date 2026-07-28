import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApplicationStatus, DepositStatus, SelectionEntrySource, SelectionStatus } from '@prisma/client';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/** 정원보다 훨씬 큰 값을 받아도 서비스가 정원+허용치로 잘라내지만, 입력 자체에도 상한을 둔다. */
const MAX_PRESELECT_TOP_N = 10_000;

/**
 * 상위 N명 자동 예비선정.
 *
 * `topN` 을 생략하면 라운드의 남은 정원(`remainingSeats`)을 쓴다. 파트너가 굳이 더 적게 뽑고
 * 싶을 때만 값을 넣는다 — 정원보다 크게 넣어도 `allowSelectOverCapacity` 가 꺼져 있으면
 * 서비스가 정원 + `overCapacityTolerance` 로 자른다.
 */
export class AutoPreselectDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PRESELECT_TOP_N,
    description: '생략하면 남은 정원만큼 뽑는다.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRESELECT_TOP_N)
  topN?: number;
}

/**
 * 파트너 수동 조정의 공통 입력.
 *
 * 사유가 옵셔널인 이유는 라운드마다 `requireReasonOnOverride` 로 정하기 때문이다.
 * 켜져 있으면 서비스가 400 으로 막는다 — DTO 에서 필수로 박으면 그 스위치가 의미를 잃는다.
 */
export class SelectionOverrideDto {
  @ApiPropertyOptional({ maxLength: 500, description: '조정 사유. 감사 로그와 엔트리에 함께 남는다.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** 결원 승계. 누구의 자리를 물려받는지 근거를 남긴다. */
export class PromoteEntryDto extends SelectionOverrideDto {
  @ApiProperty({ description: '자리가 비게 된 엔트리 id (제외·취소된 엔트리여야 한다)' })
  @IsString()
  fromEntryId!: string;
}

/**
 * 명단 확정.
 *
 * 확정은 되돌리기 가장 비싼 연산이다 — 신청 상태가 종결되고 전원에게 결과 알림이 나간다.
 * 그래서 If-Match(Selection.version)를 헤더로 따로 요구하고, 여기서는 메모만 받는다.
 */
export class FinalizeSelectionDto {
  @ApiPropertyOptional({ maxLength: 1000, description: '파트너 메모. 유저에게는 나가지 않는다.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  memo?: string;
}

/**
 * 라운드 후보 목록 필터.
 *
 * `cursor` 는 `rankNo` 문자열이다 — id 커서를 쓰면 순위 순서와 커서 순서가 달라져 페이지를
 * 넘기는 사이 항목이 중복·누락된다. 순위는 라운드 안에서 유일하므로(selection_entry_round_rank_uq)
 * 안정적인 커서가 된다.
 */
export class SelectionEntryQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: SelectionStatus })
  @IsOptional()
  @IsEnum(SelectionStatus)
  status?: SelectionStatus;

  @ApiPropertyOptional({ description: '제외된 후보를 숨긴다.' })
  @IsOptional()
  @IsBoolean()
  eligibleOnly?: boolean;
}

/**
 * 파트너·운영자에게만 나가는 후보 행.
 *
 * 금액과 순위가 그대로 들어 있다 — D-07 이 감추는 대상은 **이용자**이고, 파트너는 자기 이벤트의
 * 금액·순위를 항상 전부 본다. 이 타입이 유저 응답에 재사용되지 않도록 이름에 Partner 를 박아 둔다.
 */
export class PartnerSelectionEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: Number }) rankNo!: number | null;
  @ApiProperty({ description: '신청 금액(원). 실제 낸 예약금이 아니라 순위 기준 금액이다.' })
  amount!: number;
  @ApiProperty({ description: '그 금액에 도달한 시각 (D-04 의 2순위 키)' }) lastBidAt!: Date;
  @ApiProperty() appliedAt!: Date;
  @ApiProperty() rebidCount!: number;
  @ApiProperty() depositStatus!: string;
  @ApiProperty() depositPaid!: number;
  @ApiProperty() withinCapacity!: boolean;
  @ApiProperty() isEligible!: boolean;
  @ApiProperty({ nullable: true, type: String }) exclusionReason!: string | null;
  @ApiProperty({ enum: SelectionStatus }) status!: SelectionStatus;
  @ApiProperty({ enum: SelectionEntrySource }) source!: SelectionEntrySource;
  @ApiProperty() isOverride!: boolean;
  @ApiProperty({ nullable: true, type: String }) tieGroupKey!: string | null;
  @ApiProperty({ nullable: true, type: Number }) tieOrdinal!: number | null;
  @ApiProperty() version!: number;
}

/** 라운드 요약 + 커트라인. 커트라인이 붙는 유일한 응답이고, 파트너 전용 경로에서만 만든다(IC-35). */
export class PartnerSelectionRoundDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() roundNo!: number;
  @ApiProperty() status!: string;
  @ApiProperty() capacitySnapshot!: number;
  @ApiProperty() remainingSeats!: number;
  @ApiProperty() eligibleCount!: number;
  @ApiProperty() excludedCount!: number;
  @ApiProperty() preselectedCount!: number;
  @ApiProperty() selectedCount!: number;
  @ApiProperty({ nullable: true, type: Date }) rankingComputedAt!: Date | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '순위 스냅샷 해시. 분쟁 시 DB 에서 그대로 재현할 수 있어야 하는 값이다.',
  })
  rankingSnapshotHash!: string | null;
  @ApiProperty({ nullable: true, type: Date }) finalizedAt!: Date | null;
  @ApiProperty() version!: number;
  @ApiProperty({
    nullable: true,
    type: Object,
    description: '★ 커트라인. 파트너 화면 밖으로 절대 나가지 않는다 (D-07 / IC-35).',
  })
  cutoff!: { amount: number | null; lastBidAt: Date | null; hasTie: boolean } | null;
}

// ─── 진행 중 신청자 (잠정 순위) ───────────────────────────────────────

/**
 * 목록을 나누는 두 묶음.
 *
 * `RANKED` 는 순위 집계에 들어가는 신청(`VALID`/`CONFIRMED`)이고, `PENDING_DEPOSIT` 은
 * 아직 예약금을 안 낸 신청이다. 두 묶음을 한 목록에 섞어 보여주되 순위는 앞쪽에만 매긴다 —
 * 미납자를 아예 빼면 파트너가 "신청은 47명이라는데 왜 39명만 보이지"를 설명할 수 없다(D-05).
 */
export const LIVE_APPLICANT_BUCKETS = ['RANKED', 'PENDING_DEPOSIT'] as const;
export type LiveApplicantBucket = (typeof LIVE_APPLICANT_BUCKETS)[number];

/**
 * 진행 중 신청자 목록 필터.
 *
 * `cursor` 는 목록 안의 일련번호(정수 문자열)다. id 커서를 쓰면 커서 순서와 정렬(금액순)이
 * 달라져 페이지를 넘기는 사이 항목이 중복·누락되고, 이 목록은 정렬 키가 아직 얼지 않아
 * (금액이 계속 올라간다) 얼어붙은 라운드보다 그 위험이 크다.
 */
export class LiveApplicantQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    // 스프레드로 복사한다 — `readonly` 튜플은 Swagger 의 `enum: any[]` 에 그대로 못 들어간다.
    enum: [...LIVE_APPLICANT_BUCKETS],
    description: '비우면 둘 다. RANKED=순위 집계 대상, PENDING_DEPOSIT=예약금 미납.',
  })
  @IsOptional()
  @IsIn(LIVE_APPLICANT_BUCKETS)
  bucket?: LiveApplicantBucket;
}

/**
 * 신청자 한 명. 파트너·운영자 전용이라 금액이 그대로 들어 있다 (D-07 은 이용자를 막는 규칙이다).
 *
 * ★ `provisionalPosition` 은 **잠정 순위**다. 확정 순위가 아니다.
 * 마감 전까지 상향 입찰(D-06)과 예약금 만료(D-05)로 계속 바뀌고, 확정 순위는 예약금 마감
 * (`rankingLockAt`)이 지난 뒤 라운드가 얼린 `SelectionEntry.rankNo` 다. 이름을 `rankNo` 로
 * 짓지 않은 것도 그 때문이다 — 두 값이 같은 이름을 쓰면 화면이 언젠가 둘을 섞는다.
 */
export class LiveApplicantDto {
  @ApiProperty() applicationId!: string;
  @ApiProperty({ description: '마스킹된 표시명. 실명 전체는 명단 확정 화면·CSV 에서만 본다.' })
  displayName!: string;
  @ApiProperty({ description: '신청 금액(원). 순위 기준 금액이고 낸 예약금이 아니다.' })
  amount!: number;
  @ApiProperty({ description: '최초 신청 시각' }) appliedAt!: Date;
  @ApiProperty({ description: '그 금액에 도달한 시각 (D-04 의 2순위 키)' }) lastBidAt!: Date;
  @ApiProperty({ enum: ApplicationStatus }) status!: ApplicationStatus;
  @ApiProperty({ enum: DepositStatus }) depositStatus!: DepositStatus;
  @ApiProperty({ description: '지금까지 납부된 예약금(원)' }) depositPaid!: number;
  @ApiProperty({ description: '내야 하는 예약금(원). 0이면 예약금 없는 이벤트다.' })
  depositRequired!: number;
  @ApiProperty({ description: '예약금을 다 냈는가. 순위 집계 자격의 게이트다 (D-05).' })
  depositSettled!: boolean;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      '★ 잠정 순위(1부터). 예약금 미납자는 null 이고 목록 맨 뒤에 온다. 확정 순위가 아니다.',
  })
  provisionalPosition!: number | null;
}

/** 목록 위에 붙는 요약. 파트너가 가장 먼저 보는 네 숫자다. */
export class LiveApplicantSummaryDto {
  @ApiProperty({ description: '정원' }) capacity!: number;
  @ApiProperty({ description: '유효 신청 수 (VALID/CONFIRMED). 순위 집계에 들어가는 인원.' })
  validCount!: number;
  @ApiProperty({ description: '예약금 미납 수 (PENDING_DEPOSIT). 시간이 지나면 무효가 된다.' })
  pendingDepositCount!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '경쟁률 ×10. 47명/10석이면 47. 정원이 0이면 null.',
  })
  competitionRatioX10!: number | null;
  @ApiProperty({ description: '이벤트 상태' }) eventStatus!: string;
  @ApiProperty({ description: '신청 마감 시각' }) applyEndAt!: Date;
  @ApiProperty({
    nullable: true,
    type: Date,
    description: '순위 확정 시각. 이 시각이 지나야 선정 라운드가 열린다 (D-04).',
  })
  rankingLockAt!: Date | null;
  @ApiProperty({
    description:
      '★ 순위 확정 시각이 지났는가. false 면 목록의 순위는 전부 잠정이고 화면이 그렇게 말해야 한다.',
  })
  rankingLocked!: boolean;
}

/** 진행 중 신청자 페이지. 커서 페이지네이션 + 요약 블록. */
export class LiveApplicantPageDto {
  @ApiProperty({ type: LiveApplicantSummaryDto }) summary!: LiveApplicantSummaryDto;
  @ApiProperty({ type: [LiveApplicantDto] }) items!: LiveApplicantDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
