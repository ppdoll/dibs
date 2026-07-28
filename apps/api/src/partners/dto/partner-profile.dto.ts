import { ApiProperty } from '@nestjs/swagger';
import {
  BusinessVerificationStatus,
  PartnerApprovalStatus,
  PartnerRejectionCode,
  VenueStatus,
} from '@prisma/client';

/**
 * 파트너 콘솔 첫 화면이 읽는 값들. **응답 전용**이다 — 이 모듈에 PartnerProfile 쓰기는 없다.
 * 신청서 제출은 AuthModule(`POST /auth/partner-application`), 승인·정지는 운영자 모듈이 갖는다.
 */
export class PartnerBusinessCountsDto {
  @ApiProperty({ description: '삭제되지 않은 사업자 수' }) total!: number;
  @ApiProperty({ description: '심사 승인된 사업자 수. 0이면 시설을 심사에 올릴 수 없다.' })
  verified!: number;
  @ApiProperty({ description: '심사 대기 중' }) pending!: number;
  @ApiProperty({ description: '반려·승인취소되어 손봐야 하는 것' }) actionRequired!: number;
}

export class PartnerVenueCountsDto {
  @ApiProperty() total!: number;
  @ApiProperty({ description: '작성 중' }) draft!: number;
  @ApiProperty({ description: '심사 대기' }) pendingReview!: number;
  @ApiProperty({ description: '노출 중' }) active!: number;
  @ApiProperty({ description: '숨김' }) hidden!: number;
  @ApiProperty({ description: '운영자 정지' }) suspended!: number;
  @ApiProperty({ description: '보관' }) archived!: number;
}

export class PartnerProfileResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PartnerApprovalStatus }) approvalStatus!: PartnerApprovalStatus;

  @ApiProperty() contactName!: string;
  @ApiProperty() contactEmail!: string;
  @ApiProperty({ nullable: true }) contactPhone!: string | null;

  @ApiProperty({ nullable: true }) submittedAt!: Date | null;
  @ApiProperty({
    nullable: true,
    description: '운영자 심사 SLA 기한. 지났다면 문의할 근거가 된다.',
  })
  slaDueAt!: Date | null;
  @ApiProperty({ nullable: true }) approvedAt!: Date | null;

  @ApiProperty({ nullable: true }) rejectedAt!: Date | null;
  @ApiProperty({ enum: PartnerRejectionCode, nullable: true })
  rejectionCode!: PartnerRejectionCode | null;
  @ApiProperty({ nullable: true, description: '반려 사유. 이걸 못 보면 무엇을 고쳐야 할지 알 수 없다.' })
  rejectionReason!: string | null;
  @ApiProperty() resubmitCount!: number;

  @ApiProperty({ nullable: true }) suspendedAt!: Date | null;
  @ApiProperty({ nullable: true }) suspensionReason!: string | null;
  @ApiProperty({ nullable: true }) revokedAt!: Date | null;

  @ApiProperty({ nullable: true }) partnerTermsVersion!: string | null;
  @ApiProperty({ nullable: true }) partnerTermsAgreedAt!: Date | null;

  @ApiProperty({
    description: '사업자·시설을 만들고 고칠 수 있는지. 역할(PARTNER)이 있어도 승인 전이면 false다. (D-09)',
  })
  canOperate!: boolean;

  @ApiProperty({ type: PartnerBusinessCountsDto }) businesses!: PartnerBusinessCountsDto;
  @ApiProperty({ type: PartnerVenueCountsDto }) venues!: PartnerVenueCountsDto;

  @ApiProperty() createdAt!: Date;
}

/** 집계에서 쓰는 판정 묶음. 응답 필드와 1:1 로 대응시켜 두 곳이 어긋나지 않게 한다. */
export const BUSINESS_ACTION_REQUIRED_STATUSES: BusinessVerificationStatus[] = [
  BusinessVerificationStatus.REJECTED,
  BusinessVerificationStatus.REVOKED,
];

export const VENUE_STATUS_KEYS: Record<VenueStatus, keyof Omit<PartnerVenueCountsDto, 'total'>> = {
  [VenueStatus.DRAFT]: 'draft',
  [VenueStatus.PENDING_REVIEW]: 'pendingReview',
  [VenueStatus.ACTIVE]: 'active',
  [VenueStatus.HIDDEN]: 'hidden',
  [VenueStatus.SUSPENDED]: 'suspended',
  [VenueStatus.ARCHIVED]: 'archived',
};
