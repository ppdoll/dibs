import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationCancelReason, ApplicationStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AMOUNT_MAX, AMOUNT_MIN } from '@dibs/shared';

/**
 * 신청 생성. (D-02)
 *
 * 전역 ValidationPipe 가 whitelist + forbidNonWhitelisted 라, 여기 선언되지 않은 키는
 * 요청 자체가 거절된다. 그래서 여기에 **없는** 것이 곧 규칙이다:
 *  - `status` / `lastBidAt` / `depositDueAt`: 전부 서버(정확히는 DB 의 now())가 소유한다(IC-04).
 *  - INSTANT 의 `amount`: 이벤트의 고정 금액을 서버가 복사한다. 클라이언트가 정하지 않는다.
 */
export class CreateApplicationDto {
  @ApiProperty({ description: '신청할 이벤트' })
  @IsString()
  eventId!: string;

  @ApiPropertyOptional({
    minimum: AMOUNT_MIN,
    maximum: AMOUNT_MAX,
    description:
      'BID 전용 신청 금액(원). INSTANT 에서는 무시되고 이벤트의 고정 금액이 그대로 쓰인다.',
  })
  @IsOptional()
  @IsInt()
  @Min(AMOUNT_MIN)
  @Max(AMOUNT_MAX)
  amount?: number;

  @ApiPropertyOptional({ maxLength: 20, description: '동의한 이용약관 버전' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  agreedTermsVersion?: string;
}

/** 금액 상향. 내리기는 존재하지 않는다 — 엔드포인트 자체가 없다. (D-06) */
export class RaiseBidDto {
  @ApiProperty({
    minimum: AMOUNT_MIN,
    maximum: AMOUNT_MAX,
    description: '새 신청 금액(원). 현재 금액과 과거 최고 금액보다 커야 한다.',
  })
  @IsInt()
  @Min(AMOUNT_MIN)
  @Max(AMOUNT_MAX)
  amount!: number;
}

/** 취소. 사유는 사용자 요청으로 고정이고, 메모만 남긴다. */
export class CancelApplicationDto {
  @ApiPropertyOptional({ maxLength: 200, description: '취소 사유 메모(운영자 조회용)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  memo?: string;
}

/**
 * 취소 후 재신청. (IC-14)
 *
 * 새 금액을 반드시 다시 받는다. 취소 이전 금액을 서버가 이어주면
 * "취소 → 대기 → 재신청"이 아무 비용 없는 반복이 되고, 그게 D-06 이 막으려는 시계 세탁이다.
 */
export class ReapplyDto {
  @ApiProperty({
    minimum: AMOUNT_MIN,
    maximum: AMOUNT_MAX,
    description: '재신청 금액(원). 과거에 한 번이라도 불렀던 최고 금액 이상이어야 한다.',
  })
  @IsInt()
  @Min(AMOUNT_MIN)
  @Max(AMOUNT_MAX)
  amount!: number;
}

/**
 * 예약금 납부 확인. (D-05 / IC-21)
 *
 * 금액을 받지 않는다. 홀드가 청구 금액(`amountDue`)을 스냅샷으로 들고 있고
 * `deposit_paid_chk` 가 "PAID 는 완납"을 강제하므로, 부분 금액을 받아봐야 저장할 곳이 없다.
 */
export class ConfirmDepositDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description: 'PG 결제 참조값. 실제 결제 연동 전까지는 기록만 남는다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentReference?: string;
}

/** 내 신청 목록 필터. */
export class MyApplicationListQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus, isArray: false })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ description: '이전 응답의 nextCursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

/** 취소 사유 enum 을 DTO 밖에서도 쓰기 위한 재노출. 사용자 취소는 언제나 USER_REQUEST 다. */
export const USER_CANCEL_REASON = ApplicationCancelReason.USER_REQUEST;
