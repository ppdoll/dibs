import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  PartnerApprovalStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { toCursorPage } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertAffected, auditChainKey } from '../admin.internals';
import type {
  ApprovePartnerDto,
  PartnerQueueQueryDto,
  RejectPartnerDto,
  RequestResubmitDto,
  SuspendPartnerDto,
} from '../dto/partner-admin.dto';
import type { OptionalAdminReasonDto, AdminReasonDto } from '../dto/admin-common.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminOutboxService } from './admin-outbox.service';

type Tx = Prisma.TransactionClient;

/** 심사 큐 행. 신청서 본문은 상세에서만 보여준다 — 목록에 담으면 PII 노출 면이 넓어진다. */
const QUEUE_SELECT = {
  id: true,
  userId: true,
  contactName: true,
  contactEmail: true,
  approvalStatus: true,
  submittedAt: true,
  slaDueAt: true,
  resubmitCount: true,
  rejectionCode: true,
  createdAt: true,
} satisfies Prisma.PartnerProfileSelect;

const DETAIL_SELECT = {
  ...QUEUE_SELECT,
  contactPhone: true,
  rejectionReason: true,
  rejectedAt: true,
  approvedAt: true,
  approvedByUserId: true,
  suspendedAt: true,
  suspensionReason: true,
  revokedAt: true,
  partnerTermsVersion: true,
  partnerTermsAgreedAt: true,
  user: { select: { id: true, email: true, displayName: true, status: true, roles: true } },
  businesses: {
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      legalName: true,
      businessType: true,
      verificationStatus: true,
      verificationSubmittedAt: true,
    },
  },
} satisfies Prisma.PartnerProfileSelect;

/**
 * 파트너 승인 큐. (D-09)
 *
 * 모든 전이가 같은 모양이다 — 자문 락(첫 문장) → 조건부 UPDATE(영향 행 수 단언) →
 * 감사 행 → 아웃박스 알림. 이 순서가 IC-02 의 락 순서이자 IC-42 의 아웃박스 규칙이다.
 * 알림 모듈의 서비스를 주입하지 않고 `AdminOutboxService` 로 같은 트랜잭션에 행을 넣는 이유는,
 * 커밋이 실패해도 메일은 이미 나가 있는 상황을 만들지 않기 위해서다.
 */
@Injectable()
export class AdminPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly outbox: AdminOutboxService,
  ) {}

  /**
   * 심사 큐. 기본 정렬이 `slaDueAt` 인 것이 이 화면의 전부다 —
   * 생성순으로 보면 재제출로 다시 들어온 건이 큐 끝으로 밀려 SLA 를 넘긴다.
   * partner_sla_overdue_idx(approvalStatus, slaDueAt)가 그대로 쓰인다.
   */
  async listQueue(query: PartnerQueueQueryDto) {
    // all=true 는 "전체 파트너 명부" 모드다. 상태 필터를 빼고 최근 등록순으로 보여준다 —
    // 전체 목록에서 slaDueAt 정렬은 의미가 없다(승인된 건은 대부분 NULL 이라 몰려 있다).
    const showAll = query.all === true;
    const status = query.status ?? PartnerApprovalStatus.PENDING;

    const rows = await this.prisma.partnerProfile.findMany({
      where: {
        deletedAt: null,
        ...(showAll ? {} : { approvalStatus: status }),
        ...(query.overdueOnly ? { slaDueAt: { lte: new Date() } } : {}),
        ...(query.q
          ? {
              OR: [
                { contactName: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
                { contactEmail: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
              ],
            }
          : {}),
      },
      // 큐 모드: slaDueAt 이 NULL 인 행(DRAFT 등)은 Postgres 기본 NULLS LAST 로 뒤에 온다 — 큐의 의도와 맞다.
      // 전체 모드: 최근 등록순. 커서 페이지네이션이 id 기준이라 두 번째 키는 항상 id 다.
      orderBy: showAll ? [{ createdAt: 'desc' }, { id: 'asc' }] : [{ slaDueAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: QUEUE_SELECT,
    });

    return toCursorPage(rows, query.limit);
  }

  async getDetail(partnerProfileId: string) {
    const profile = await this.prisma.partnerProfile.findFirst({
      where: { id: partnerProfileId, deletedAt: null },
      select: DETAIL_SELECT,
    });

    if (!profile) throw new NotFoundException('파트너 신청서를 찾을 수 없습니다.');

    return profile;
  }

  /**
   * 승인. PENDING 에서만 넘어간다.
   *
   * 역할(PARTNER) 부여를 여기서 다시 하는 이유: 신청서 제출 경로가 역할을 붙여 주지만,
   * 시드·운영자 대행 생성처럼 그 경로를 타지 않은 프로필이 존재할 수 있다.
   * `array_append` 를 조건부로 돌려 이미 있으면 0행이 되게 한다(중복 역할은 RolesGuard 를 통과시키지만
   * 목록 화면에서 'PARTNER, PARTNER' 로 보인다).
   *
   * tokenVersion 을 올리지 않는다: JwtStrategy 가 매 요청 approvalStatus 를 다시 읽으므로
   * 승인은 다음 요청부터 즉시 유효하다. 여기서 올리면 승인 축하 알림과 함께 강제 로그아웃이 나간다.
   */
  async approve(admin: AuthenticatedUser, partnerProfileId: string, dto: ApprovePartnerDto) {
    return this.transition(admin, partnerProfileId, {
      from: [PartnerApprovalStatus.PENDING],
      conflictCode: 'PARTNER_NOT_PENDING',
      action: AuditAction.PARTNER_APPLICATION_APPROVED,
      summary: `파트너 승인${dto.memo ? `: ${dto.memo}` : ''}`,
      reasonMemo: dto.memo ?? null,
      data: {
        approvalStatus: PartnerApprovalStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: admin.id,
        slaDueAt: null,
        rejectedAt: null,
        rejectionCode: null,
        rejectionReason: null,
      },
      afterUpdate: async (tx, profile) => {
        await tx.$executeRaw`
          UPDATE "User" SET
            roles = array_append(roles, 'PARTNER'::"UserRole"),
            "updatedAt" = now()
          WHERE id = ${profile.userId}
            AND NOT ('PARTNER'::"UserRole" = ANY(roles))
        `;
      },
      notification: {
        type: NotificationType.PARTNER_APPROVAL_APPROVED,
        category: NotificationCategory.PARTNER_OPS,
        priority: NotificationPriority.HIGH,
        titleKo: '파트너 승인이 완료되었습니다',
        bodyKo:
          '이제 매장과 이벤트를 등록할 수 있습니다. 매장은 등록 후 운영자 검수를 거쳐 공개됩니다.',
        deepLinkPath: '/partner',
      },
    });
  }

  /** 반려. 화면은 문구가 아니라 rejectionCode 로 분기한다. */
  async reject(admin: AuthenticatedUser, partnerProfileId: string, dto: RejectPartnerDto) {
    return this.transition(admin, partnerProfileId, {
      from: [PartnerApprovalStatus.PENDING],
      conflictCode: 'PARTNER_NOT_PENDING',
      action: AuditAction.PARTNER_APPLICATION_REJECTED,
      summary: `파트너 반려(${dto.rejectionCode}): ${dto.reason}`,
      reasonCode: dto.rejectionCode,
      reasonMemo: dto.reason,
      data: {
        approvalStatus: PartnerApprovalStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionCode: dto.rejectionCode,
        rejectionReason: dto.reason,
        slaDueAt: null,
      },
      notification: {
        type: NotificationType.PARTNER_APPROVAL_REJECTED,
        category: NotificationCategory.PARTNER_OPS,
        priority: NotificationPriority.HIGH,
        titleKo: '파트너 신청이 반려되었습니다',
        bodyKo: `사유: ${dto.reason}\n보완 후 다시 신청하실 수 있습니다.`,
        deepLinkPath: '/partner/apply',
      },
    });
  }

  /**
   * 보완 요청. 반려와 달리 신청서를 살려둔 채 파트너에게 공을 넘긴다.
   * `resubmitCount` 는 파트너가 실제로 다시 제출할 때 올라가므로 여기서 건드리지 않는다.
   */
  async requestResubmit(
    admin: AuthenticatedUser,
    partnerProfileId: string,
    dto: RequestResubmitDto,
  ) {
    return this.transition(admin, partnerProfileId, {
      from: [PartnerApprovalStatus.PENDING],
      conflictCode: 'PARTNER_NOT_PENDING',
      action: AuditAction.PARTNER_APPLICATION_MORE_INFO,
      summary: `보완 요청: ${dto.reason}`,
      reasonMemo: dto.reason,
      data: {
        approvalStatus: PartnerApprovalStatus.RESUBMIT_REQUIRED,
        rejectionReason: dto.reason,
      },
      notification: {
        type: NotificationType.PARTNER_APPROVAL_REJECTED,
        category: NotificationCategory.PARTNER_OPS,
        priority: NotificationPriority.HIGH,
        titleKo: '파트너 신청서 보완이 필요합니다',
        bodyKo: `${dto.reason}\n보완 후 다시 제출해 주세요.`,
        deepLinkPath: '/partner/apply',
      },
    });
  }

  /**
   * 파트너 활동 정지.
   *
   * 계정 정지(User.status)와 분리한다: 파트너 자격만 멈추고 이용자로는 계속 쓸 수 있어야 하는
   * 사안이 대부분이고, 반대로 계정 정지는 파트너 자격까지 자동으로 무력화한다.
   * tokenVersion 을 올리지 않아도 즉시 반영되는 이유는 JwtStrategy 가 매 요청
   * approvalStatus 를 다시 읽어 `partnerApproved` 를 만들기 때문이다(@RequireApprovedPartner 가 그 값을 본다).
   */
  async suspend(admin: AuthenticatedUser, partnerProfileId: string, dto: SuspendPartnerDto) {
    return this.transition(admin, partnerProfileId, {
      from: [PartnerApprovalStatus.APPROVED],
      conflictCode: 'PARTNER_NOT_APPROVED',
      action: AuditAction.PARTNER_SUSPENDED,
      summary: `파트너 정지: ${dto.reason}`,
      reasonMemo: dto.reason,
      data: {
        approvalStatus: PartnerApprovalStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: dto.reason,
      },
      notification: {
        type: NotificationType.PARTNER_SUSPENDED,
        category: NotificationCategory.PARTNER_OPS,
        priority: NotificationPriority.CRITICAL,
        titleKo: '파트너 활동이 정지되었습니다',
        bodyKo: `사유: ${dto.reason}\n진행 중인 이벤트에 대한 문의는 고객센터로 연락해 주세요.`,
        deepLinkPath: '/partner',
      },
    });
  }

  /** 정지 해제. 정지 컬럼 두 개를 NULL 로 되돌려야 "정지 이력"과 "현재 정지"가 섞이지 않는다. */
  async reinstate(
    admin: AuthenticatedUser,
    partnerProfileId: string,
    dto: OptionalAdminReasonDto,
  ) {
    return this.transition(admin, partnerProfileId, {
      from: [PartnerApprovalStatus.SUSPENDED],
      conflictCode: 'PARTNER_NOT_SUSPENDED',
      action: AuditAction.PARTNER_REINSTATED,
      summary: `파트너 정지 해제${dto.reason ? `: ${dto.reason}` : ''}`,
      reasonMemo: dto.reason ?? null,
      data: {
        approvalStatus: PartnerApprovalStatus.APPROVED,
        suspendedAt: null,
        suspensionReason: null,
      },
      notification: {
        type: NotificationType.PARTNER_REINSTATED,
        category: NotificationCategory.PARTNER_OPS,
        priority: NotificationPriority.HIGH,
        titleKo: '파트너 활동 정지가 해제되었습니다',
        bodyKo: '다시 매장과 이벤트를 운영하실 수 있습니다.',
        deepLinkPath: '/partner',
      },
    });
  }

  /**
   * 자격 박탈. 정지와 달리 되돌리는 경로를 두지 않는다 —
   * 되살릴 일이 생기면 새 신청서를 받는 것이 맞다(그래야 약관 동의도 다시 받는다).
   */
  async revoke(admin: AuthenticatedUser, partnerProfileId: string, dto: AdminReasonDto) {
    return this.transition(admin, partnerProfileId, {
      from: [
        PartnerApprovalStatus.APPROVED,
        PartnerApprovalStatus.SUSPENDED,
        PartnerApprovalStatus.REJECTED,
      ],
      conflictCode: 'PARTNER_NOT_REVOCABLE',
      action: AuditAction.PARTNER_REVOKED,
      summary: `파트너 자격 박탈: ${dto.reason}`,
      reasonMemo: dto.reason,
      data: {
        approvalStatus: PartnerApprovalStatus.REVOKED,
        revokedAt: new Date(),
        suspensionReason: dto.reason,
      },
      notification: {
        type: NotificationType.PARTNER_SUSPENDED,
        category: NotificationCategory.PARTNER_OPS,
        priority: NotificationPriority.CRITICAL,
        titleKo: '파트너 자격이 해지되었습니다',
        bodyKo: `사유: ${dto.reason}`,
        deepLinkPath: '/partner',
      },
    });
  }

  /**
   * 전이 본체. 상태 전이 여섯 개가 문장 순서까지 같아서 하나로 묶었다.
   *
   * `from` 을 WHERE 에 넣고 영향 행 수를 단언하는 것이 핵심이다(IC-01).
   * 읽고 검사한 뒤 쓰면 두 문장 사이에 다른 운영자가 같은 건을 처리할 수 있고,
   * 그러면 승인 알림과 반려 알림이 같은 파트너에게 함께 나간다.
   */
  private async transition(
    admin: AuthenticatedUser,
    partnerProfileId: string,
    spec: {
      from: PartnerApprovalStatus[];
      conflictCode: string;
      action: AuditAction;
      summary: string;
      reasonCode?: string | null;
      reasonMemo?: string | null;
      // Unchecked 쪽을 쓰는 이유: updateMany 는 관계 연결을 못 하므로 approvedByUserId 같은
      // 스칼라 FK 를 직접 넣어야 하는데, Checked 입력 타입에는 그 컬럼이 없다.
      data: Prisma.PartnerProfileUncheckedUpdateManyInput;
      afterUpdate?: (tx: Tx, profile: { id: string; userId: string }) => Promise<void>;
      notification: {
        type: NotificationType;
        category: NotificationCategory;
        priority: NotificationPriority;
        titleKo: string;
        bodyKo: string;
        deepLinkPath: string;
      };
    },
  ) {
    const correlationId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.PARTNER_PROFILE));

      const before = await tx.partnerProfile.findFirst({
        where: { id: partnerProfileId, deletedAt: null },
        select: { id: true, userId: true, approvalStatus: true, contactName: true },
      });

      if (!before) throw new NotFoundException('파트너 신청서를 찾을 수 없습니다.');

      const { count } = await tx.partnerProfile.updateMany({
        where: { id: partnerProfileId, deletedAt: null, approvalStatus: { in: spec.from } },
        data: spec.data,
      });

      assertAffected(count, 1, spec.conflictCode);

      await spec.afterUpdate?.(tx, before);

      await this.audit.append(tx, admin, {
        action: spec.action,
        targetType: AuditTargetType.PARTNER_PROFILE,
        targetId: partnerProfileId,
        targetOwnerUserId: before.userId,
        summary: spec.summary,
        before: { approvalStatus: before.approvalStatus },
        after: { approvalStatus: spec.data.approvalStatus },
        reasonCode: spec.reasonCode ?? null,
        reasonMemo: spec.reasonMemo ?? null,
        correlationId,
      });

      await this.outbox.enqueue(tx, {
        userId: before.userId,
        type: spec.notification.type,
        category: spec.notification.category,
        priority: spec.notification.priority,
        titleKo: spec.notification.titleKo,
        bodyKo: spec.notification.bodyKo,
        deepLinkPath: spec.notification.deepLinkPath,
        // 조치마다 새 correlationId 라 같은 파트너가 정지→해제→정지를 겪어도 알림이 눌리지 않는다.
        dedupeKey: `${spec.notification.type}:${correlationId}`,
      });

      return tx.partnerProfile.findUniqueOrThrow({
        where: { id: partnerProfileId },
        select: DETAIL_SELECT,
      });
    });
  }
}
