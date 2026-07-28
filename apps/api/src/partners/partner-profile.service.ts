import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessVerificationStatus, PartnerApprovalStatus, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  BUSINESS_ACTION_REQUIRED_STATUSES,
  VENUE_STATUS_KEYS,
  type PartnerBusinessCountsDto,
  type PartnerVenueCountsDto,
} from './dto/partner-profile.dto';

const PROFILE_SELECT = {
  id: true,
  approvalStatus: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  submittedAt: true,
  slaDueAt: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionCode: true,
  rejectionReason: true,
  resubmitCount: true,
  suspendedAt: true,
  suspensionReason: true,
  revokedAt: true,
  partnerTermsVersion: true,
  partnerTermsAgreedAt: true,
  createdAt: true,
} satisfies Prisma.PartnerProfileSelect;

/**
 * 자기 파트너 프로필 조회. **읽기 전용**이다.
 *
 * 쓰기가 여기 없는 이유: 신청서 제출은 AuthModule 이(`POST /auth/partner-application`),
 * 승인·반려·정지는 운영자 모듈이 갖는다. 같은 행을 두 모듈이 쓰면 승인 트랜잭션과
 * 파트너의 수정이 서로를 덮어쓴다.
 *
 * 그런데 **읽기는 여기에 있어야 한다.** `/auth/me` 는 approvalStatus 만 준다 —
 * 반려당한 파트너가 `rejectionReason` 을 볼 수 없으면 무엇을 고쳐 재제출할지 알 수 없고,
 * SLA 기한이 지났는지도 확인할 수 없다.
 */
@Injectable()
export class PartnerProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `partnerProfileId` 가 아니라 `userId` 로 찾는다.
   *
   * 이 엔드포인트는 승인 전(신청서만 낸 상태)에도 열려 있어야 하는데, 그 시점의
   * 접근 제어는 "이 프로필이 내 계정의 것인가" 하나뿐이다. `userId` 가 그 술어 자체이고
   * (`PartnerProfile.userId` 는 유니크다) 별도 소유 검사가 필요 없다.
   */
  async getMyProfile(user: AuthenticatedUser) {
    const profile = await this.prisma.partnerProfile.findUnique({
      where: { userId: user.id },
      select: PROFILE_SELECT,
    });

    if (!profile) {
      throw new NotFoundException('파트너 신청서를 먼저 제출해 주세요.');
    }

    const [businesses, venues] = await Promise.all([
      this.countBusinesses(profile.id),
      this.countVenues(profile.id),
    ]);

    return {
      ...profile,
      // 역할이 아니라 승인 상태가 활동 가능 여부를 정한다. (D-09)
      canOperate: profile.approvalStatus === PartnerApprovalStatus.APPROVED,
      businesses,
      venues,
    };
  }

  /**
   * 상태별 사업자 수.
   *
   * `groupBy` 로 한 번에 세는 이유: 상태 4종을 각각 count 하면 왕복이 4번이고,
   * 그 사이에 심사가 끝나면 합계가 어느 항목과도 맞지 않는 숫자가 화면에 뜬다.
   */
  private async countBusinesses(partnerProfileId: string): Promise<PartnerBusinessCountsDto> {
    const rows = await this.prisma.business.groupBy({
      by: ['verificationStatus'],
      where: { partnerProfileId, deletedAt: null },
      _count: { _all: true },
    });

    const counts: PartnerBusinessCountsDto = {
      total: 0,
      verified: 0,
      pending: 0,
      actionRequired: 0,
    };

    for (const row of rows) {
      const n = row._count._all;
      counts.total += n;

      if (row.verificationStatus === BusinessVerificationStatus.VERIFIED) counts.verified += n;
      else if (row.verificationStatus === BusinessVerificationStatus.PENDING) counts.pending += n;
      else if (BUSINESS_ACTION_REQUIRED_STATUSES.includes(row.verificationStatus)) {
        counts.actionRequired += n;
      }
    }

    return counts;
  }

  private async countVenues(partnerProfileId: string): Promise<PartnerVenueCountsDto> {
    const rows = await this.prisma.venue.groupBy({
      by: ['status'],
      where: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
      _count: { _all: true },
    });

    const counts: PartnerVenueCountsDto = {
      total: 0,
      draft: 0,
      pendingReview: 0,
      active: 0,
      hidden: 0,
      suspended: 0,
      archived: 0,
    };

    for (const row of rows) {
      const n = row._count._all;
      counts.total += n;
      // 매핑 테이블을 쓰는 이유: VenueStatus 에 값이 추가되면 여기서 조용히 0 이 되는 게 아니라
      // 타입 검사에서 먼저 걸린다(Record<VenueStatus, ...> 가 전수 대응을 강제한다).
      counts[VENUE_STATUS_KEYS[row.status]] += n;
    }

    return counts;
  }
}
