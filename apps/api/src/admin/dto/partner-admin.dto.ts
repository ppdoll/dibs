import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartnerApprovalStatus, PartnerRejectionCode } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class PartnerQueueQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: PartnerApprovalStatus,
    default: PartnerApprovalStatus.PENDING,
    description: '기본값은 심사 대기(PENDING). 반려 목록을 보려면 REJECTED 를 넘긴다.',
  })
  @IsOptional()
  @IsEnum(PartnerApprovalStatus)
  status?: PartnerApprovalStatus;

  /**
   * 상태 필터를 빼고 **모든 파트너**를 본다.
   *
   * status 를 생략하면 PENDING 으로 떨어지므로, "전체"를 뜻할 방법이 따로 필요하다.
   * 이 기본값은 일부러 유지한다 — 이 엔드포인트의 주 용도는 심사 큐이고,
   * 실수로 전체가 나오는 것보다 대기 건만 나오는 편이 안전하다.
   *
   * true 면 정렬도 바뀐다. 전체 목록에서는 SLA 순서가 의미 없고 최근 등록순이 자연스럽다.
   */
  @ApiPropertyOptional({ description: '상태와 무관하게 전체 파트너를 조회한다. status 보다 우선한다.' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @ApiPropertyOptional({ description: 'SLA 기한이 지난 건만. 큐의 기본 정렬이 slaDueAt 인 이유다.' })
  @IsOptional()
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional({ maxLength: 80, description: '담당자명·연락 이메일 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class ApprovePartnerDto {
  @ApiPropertyOptional({ maxLength: 500, description: '승인 메모. 감사 로그에만 남고 파트너에게는 안 간다.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

export class RejectPartnerDto {
  @ApiProperty({ enum: PartnerRejectionCode, description: '반려 코드. 화면이 문구가 아니라 이 값으로 분기한다.' })
  @IsEnum(PartnerRejectionCode)
  rejectionCode!: PartnerRejectionCode;

  @ApiProperty({ maxLength: 500, description: '파트너에게 그대로 보이는 반려 사유.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class RequestResubmitDto {
  @ApiProperty({ maxLength: 500, description: '무엇을 보완해야 하는지. 파트너에게 그대로 보인다.' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class SuspendPartnerDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
