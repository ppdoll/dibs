import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  BusinessVerificationStatus,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { toCursorPage } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertAffected, auditChainKey } from '../admin.internals';
import type { AdminReasonDto } from '../dto/admin-common.dto';
import type { BusinessQueueQueryDto, VerifyBusinessDto } from '../dto/business-admin.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminOutboxService } from './admin-outbox.service';

/**
 * 사업자등록번호는 목록에서 뒤 4자리만 노출한다.
 * 심사 목록은 여러 운영자가 동시에 열어두는 화면이라, 전체 번호가 필요한 순간은
 * 상세 조회 하나뿐이고 그 조회는 PII_ACCESSED 로 감사된다.
 */
const QUEUE_SELECT = {
  id: true,
  partnerProfileId: true,
  name: true,
  legalName: true,
  businessType: true,
  verificationStatus: true,
  verificationSubmittedAt: true,
  createdAt: true,
} satisfies Prisma.BusinessSelect;

const DETAIL_SELECT = {
  ...QUEUE_SELECT,
  businessRegistrationNumber: true,
  representativeName: true,
  contactEmail: true,
  contactPhone: true,
  postalCode: true,
  roadAddress: true,
  detailAddress: true,
  verifiedAt: true,
  verifiedByUserId: true,
  verificationRejectionReason: true,
  registrationDocPathname: true,
  partner: { select: { id: true, userId: true, contactName: true, approvalStatus: true } },
} satisfies Prisma.BusinessSelect;

/**
 * 사업자 진위 확인. UNSUBMITTED → PENDING 은 파트너가, 그 다음은 운영자가 움직인다.
 *
 * 등록증 원본(registrationDocPathname)은 어떤 응답에도 싣지 않는다 — 파트너 모듈이
 * 60초 서명 URL 로만 내주고 그때 REGISTRATION_DOC_VIEWED 감사 행을 남기기 때문에,
 * 여기서 경로를 그대로 노출하면 그 감사가 우회된다.
 */
@Injectable()
export class AdminBusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly outbox: AdminOutboxService,
  ) {}

  async listQueue(query: BusinessQueueQueryDto) {
    const status = query.status ?? BusinessVerificationStatus.PENDING;

    const rows = await this.prisma.business.findMany({
      where: {
        deletedAt: null,
        verificationStatus: status,
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
                { legalName: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
                { businessRegistrationNumber: { contains: query.q.replace(/\D/g, '') } },
              ],
            }
          : {}),
      },
      // 제출 순서가 곧 처리 순서다. business_verify_queue_idx 가 이 정렬을 그대로 받는다.
      orderBy: [{ verificationSubmittedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: QUEUE_SELECT,
    });

    return toCursorPage(rows, query.limit);
  }

  /**
   * 상세. 사업자등록번호·대표자명·연락처가 함께 나가므로 PII_ACCESSED 를 남긴다.
   *
   * 조회에 감사 행을 쓰는 것이 비싸 보이지만, 개인정보 열람 기록은 사후에 만들 수 없다.
   * 등록증 파일 경로는 응답에서 지우고 "있음/없음"만 알려 준다.
   */
  async getDetail(admin: AuthenticatedUser, businessId: string) {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: DETAIL_SELECT,
    });

    if (!business) throw new NotFoundException('사업자 정보를 찾을 수 없습니다.');

    await this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.BUSINESS));
      await this.audit.append(tx, admin, {
        action: AuditAction.PII_ACCESSED,
        targetType: AuditTargetType.BUSINESS,
        targetId: businessId,
        targetOwnerUserId: business.partner.userId,
        summary: '사업자 상세 열람(사업자등록번호·대표자명 포함)',
      });
    });

    const { registrationDocPathname, ...rest } = business;

    return { ...rest, hasRegistrationDoc: registrationDocPathname !== null };
  }

  /** 확인 완료. PENDING 에서만 넘어간다. */
  verify(admin: AuthenticatedUser, businessId: string, dto: VerifyBusinessDto) {
    return this.transition(admin, businessId, {
      from: [BusinessVerificationStatus.PENDING],
      conflictCode: 'BUSINESS_NOT_PENDING',
      action: AuditAction.BUSINESS_VERIFIED,
      summary: `사업자 확인 완료${dto.memo ? `: ${dto.memo}` : ''}`,
      reasonMemo: dto.memo ?? null,
      data: {
        verificationStatus: BusinessVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
        verifiedByUserId: admin.id,
        verificationRejectionReason: null,
      },
      notification: {
        type: NotificationType.BUSINESS_VERIFICATION_APPROVED,
        priority: NotificationPriority.HIGH,
        titleKo: '사업자 확인이 완료되었습니다',
        bodyKo: '이제 이 사업자로 매장을 등록하고 검수를 요청할 수 있습니다.',
      },
    });
  }

  /** 반려. 사유는 파트너에게 그대로 보인다. */
  reject(admin: AuthenticatedUser, businessId: string, dto: AdminReasonDto) {
    return this.transition(admin, businessId, {
      from: [BusinessVerificationStatus.PENDING],
      conflictCode: 'BUSINESS_NOT_PENDING',
      action: AuditAction.BUSINESS_REJECTED,
      summary: `사업자 확인 반려: ${dto.reason}`,
      reasonMemo: dto.reason,
      data: {
        verificationStatus: BusinessVerificationStatus.REJECTED,
        verificationRejectionReason: dto.reason,
        verifiedAt: null,
        verifiedByUserId: null,
      },
      notification: {
        type: NotificationType.BUSINESS_VERIFICATION_REJECTED,
        priority: NotificationPriority.HIGH,
        titleKo: '사업자 확인이 반려되었습니다',
        bodyKo: `사유: ${dto.reason}\n서류를 보완한 뒤 다시 제출해 주세요.`,
      },
    });
  }

  /**
   * 확인 취소(REVOKED).
   *
   * 이미 VERIFIED 였던 사업자를 되돌리는 조치라 REJECTED 와 구분한다 —
   * BRN 부분 유니크 인덱스가 REJECTED 만 제외하므로, 취소된 번호는 여전히 점유 상태로 남는다.
   * 그게 의도다: 확인까지 통과했던 번호를 다른 계정이 곧바로 가져가면 안 된다.
   */
  revoke(admin: AuthenticatedUser, businessId: string, dto: AdminReasonDto) {
    return this.transition(admin, businessId, {
      from: [BusinessVerificationStatus.VERIFIED],
      conflictCode: 'BUSINESS_NOT_VERIFIED',
      action: AuditAction.BUSINESS_REVOKED,
      summary: `사업자 확인 취소: ${dto.reason}`,
      reasonMemo: dto.reason,
      data: {
        verificationStatus: BusinessVerificationStatus.REVOKED,
        verificationRejectionReason: dto.reason,
      },
      notification: {
        type: NotificationType.BUSINESS_VERIFICATION_REJECTED,
        priority: NotificationPriority.CRITICAL,
        titleKo: '사업자 확인이 취소되었습니다',
        bodyKo: `사유: ${dto.reason}\n확인이 다시 완료될 때까지 신규 매장 검수가 중단됩니다.`,
      },
    });
  }

  private async transition(
    admin: AuthenticatedUser,
    businessId: string,
    spec: {
      from: BusinessVerificationStatus[];
      conflictCode: string;
      action: AuditAction;
      summary: string;
      reasonMemo: string | null;
      // Unchecked 입력이어야 verifiedByUserId(스칼라 FK)를 직접 쓸 수 있다 — updateMany 는
      // 관계 connect 를 지원하지 않는다.
      data: Prisma.BusinessUncheckedUpdateManyInput;
      notification: {
        type: NotificationType;
        priority: NotificationPriority;
        titleKo: string;
        bodyKo: string;
      };
    },
  ) {
    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.BUSINESS));

      const before = await tx.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: {
          id: true,
          name: true,
          verificationStatus: true,
          partner: { select: { userId: true } },
        },
      });

      if (!before) throw new NotFoundException('사업자 정보를 찾을 수 없습니다.');

      const { count } = await tx.business.updateMany({
        where: { id: businessId, deletedAt: null, verificationStatus: { in: spec.from } },
        data: spec.data,
      });

      assertAffected(count, 1, spec.conflictCode);

      await this.audit.append(tx, admin, {
        action: spec.action,
        targetType: AuditTargetType.BUSINESS,
        targetId: businessId,
        targetOwnerUserId: before.partner.userId,
        summary: spec.summary,
        before: { verificationStatus: before.verificationStatus },
        after: { verificationStatus: spec.data.verificationStatus },
        reasonMemo: spec.reasonMemo,
        correlationId,
      });

      await this.outbox.enqueue(tx, {
        userId: before.partner.userId,
        type: spec.notification.type,
        category: NotificationCategory.PARTNER_OPS,
        priority: spec.notification.priority,
        titleKo: spec.notification.titleKo,
        bodyKo: `[${before.name}] ${spec.notification.bodyKo}`,
        deepLinkPath: `/partner/businesses/${businessId}`,
        dedupeKey: `${spec.notification.type}:${correlationId}`,
      });

      return tx.business.findUniqueOrThrow({ where: { id: businessId }, select: QUEUE_SELECT });
    });
  }
}
