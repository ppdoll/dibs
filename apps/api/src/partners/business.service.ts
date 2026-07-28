import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditActorRole,
  AuditTargetType,
  BusinessVerificationStatus,
  Prisma,
} from '@prisma/client';

import { assertAffected } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AttachBusinessDocDto,
  BusinessDocUploadTokenDto,
  CreateBusinessDto,
  SubmitBusinessVerificationDto,
  UpdateBusinessDto,
} from './dto/business.dto';
import { isValidBrn, normalizeBrn } from './internal/brn';
import { PartnerAuditService } from './internal/partner-audit.service';
import {
  BUSINESS_DOC_CONTENT_TYPES,
  BUSINESS_DOC_MAX_BYTES,
  PartnerBlobService,
} from './internal/partner-blob.service';
import { actorLabelOf, requirePartnerProfileId } from './internal/partner-context';
import { mapUniqueViolation } from './internal/prisma-errors';
import { dbNow } from './internal/tx-time';

/**
 * 심사 대상 정보(등록번호·업종·대표자명)를 고칠 수 있는 상태.
 * PENDING(심사 중)·VERIFIED(승인 완료)에서 이걸 바꾸면 운영자가 본 서류와 DB 가 어긋난다.
 */
const EDITABLE_STATUSES: BusinessVerificationStatus[] = [
  BusinessVerificationStatus.UNSUBMITTED,
  BusinessVerificationStatus.REJECTED,
  BusinessVerificationStatus.REVOKED,
];

const BUSINESS_SELECT = {
  id: true,
  name: true,
  legalName: true,
  businessRegistrationNumber: true,
  businessType: true,
  representativeName: true,
  registrationDocPathname: true,
  verificationStatus: true,
  verificationSubmittedAt: true,
  verifiedAt: true,
  verificationRejectionReason: true,
  contactEmail: true,
  contactPhone: true,
  postalCode: true,
  roadAddress: true,
  detailAddress: true,
  createdAt: true,
  _count: { select: { venues: { where: { deletedAt: null } } } },
} satisfies Prisma.BusinessSelect;

type BusinessRow = Prisma.BusinessGetPayload<{ select: typeof BUSINESS_SELECT }>;

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: PartnerBlobService,
    private readonly audit: PartnerAuditService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateBusinessDto) {
    const partnerProfileId = requirePartnerProfileId(user);
    const brn = this.checkedBrn(dto.businessRegistrationNumber);

    const created = await mapUniqueViolation(() =>
      this.prisma.business.create({
        data: {
          partnerProfileId,
          name: dto.name,
          legalName: dto.legalName,
          businessRegistrationNumber: brn,
          businessType: dto.businessType,
          representativeName: dto.representativeName,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          postalCode: dto.postalCode ?? null,
          roadAddress: dto.roadAddress ?? null,
          detailAddress: dto.detailAddress ?? null,
        },
        select: BUSINESS_SELECT,
      }),
    );

    return toBusinessResponse(created);
  }

  /** 사업자는 파트너당 많아야 몇 개다. 커서 페이지네이션을 붙일 이유가 없다. */
  async list(user: AuthenticatedUser) {
    const partnerProfileId = requirePartnerProfileId(user);

    const rows = await this.prisma.business.findMany({
      where: { partnerProfileId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: BUSINESS_SELECT,
    });

    return rows.map(toBusinessResponse);
  }

  async get(user: AuthenticatedUser, businessId: string) {
    return toBusinessResponse(await this.findOwnedOrThrow(user, businessId));
  }

  /**
   * 부분 수정.
   *
   * 심사 대상 필드가 하나라도 들어오면 "지금 고칠 수 있는 상태인가"를 **UPDATE 의 WHERE 절에**
   * 함께 건다. 서비스에서 먼저 상태를 읽어 검사하면, 그 사이에 운영자가 승인해 버린 사업자의
   * 등록번호를 승인 후에 바꿔치기할 수 있다.
   */
  async update(user: AuthenticatedUser, businessId: string, dto: UpdateBusinessDto) {
    const partnerProfileId = requirePartnerProfileId(user);

    const touchesReviewedFields =
      dto.businessRegistrationNumber !== undefined ||
      dto.businessType !== undefined ||
      dto.representativeName !== undefined;

    const data: Prisma.BusinessUpdateManyMutationInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
      ...(dto.businessRegistrationNumber !== undefined
        ? { businessRegistrationNumber: this.checkedBrn(dto.businessRegistrationNumber) }
        : {}),
      ...(dto.businessType !== undefined ? { businessType: dto.businessType } : {}),
      ...(dto.representativeName !== undefined
        ? { representativeName: dto.representativeName }
        : {}),
      ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
      ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode } : {}),
      ...(dto.roadAddress !== undefined ? { roadAddress: dto.roadAddress } : {}),
      ...(dto.detailAddress !== undefined ? { detailAddress: dto.detailAddress } : {}),
    };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('변경할 내용이 없습니다.');
    }

    const { count } = await mapUniqueViolation(() =>
      this.prisma.business.updateMany({
        where: {
          id: businessId,
          partnerProfileId,
          deletedAt: null,
          ...(touchesReviewedFields ? { verificationStatus: { in: EDITABLE_STATUSES } } : {}),
        },
        data,
      }),
    );

    // 0행일 때 404 와 409 를 구분하지 않는다. 남의 사업자 id 를 넣었을 때 "없음"과 "잠김"이
    // 다르게 보이면 그것만으로 남의 사업자 존재 여부를 훑을 수 있다.
    assertAffected(count, 1, 'BUSINESS_NOT_EDITABLE');

    return this.get(user, businessId);
  }

  /**
   * 사업자등록증 업로드 티켓.
   *
   * 여기서 하는 SELECT 는 토큰 발급 가드일 뿐이다 — 실제 쓰기(attach)는 같은 술어를
   * 다시 WHERE 절에 걸므로, 이 사이에 상태가 바뀌면 등록 단계에서 막힌다.
   */
  async createDocUploadTicket(
    user: AuthenticatedUser,
    businessId: string,
    dto: BusinessDocUploadTokenDto,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);

    const business = await this.prisma.business.findFirst({
      where: {
        id: businessId,
        partnerProfileId,
        deletedAt: null,
        verificationStatus: { in: EDITABLE_STATUSES },
      },
      select: { id: true },
    });

    if (!business) {
      throw new NotFoundException('수정할 수 있는 사업자를 찾을 수 없습니다.');
    }

    // 경로에 난수를 넣는다. 이 스토어는 public access 만 지원하므로 URL 자체가 자격증명이다.
    const nonce = randomBytes(12).toString('hex');
    const pathname = this.blob.businessDocPathname(businessId, nonce, dto.contentType);

    const ticket = await this.blob.createUploadTicket({
      pathname,
      allowedContentTypes: BUSINESS_DOC_CONTENT_TYPES,
      maxBytes: BUSINESS_DOC_MAX_BYTES,
    });

    return ticket;
  }

  /**
   * 업로드된 사본을 사업자에 붙인다.
   *
   * 경로 접두사를 다시 검사하는 이유: 토큰은 경로를 못 박지만 이 요청은 아무 pathname 이나
   * 보낼 수 있다. 남의 사업자 경로를 적어 내면 그 사본을 자기 심사에 갖다 쓰게 된다.
   */
  async attachDoc(user: AuthenticatedUser, businessId: string, dto: AttachBusinessDocDto) {
    const partnerProfileId = requirePartnerProfileId(user);

    if (!dto.pathname.startsWith(`business-docs/${businessId}/`)) {
      throw new BadRequestException('업로드 경로가 이 사업자의 것이 아닙니다.');
    }

    const meta = await this.blob.verifyUploaded(dto.blobUrl, dto.pathname);

    if (meta.size > BUSINESS_DOC_MAX_BYTES) {
      throw new BadRequestException('사업자등록증 파일이 너무 큽니다.');
    }
    if (!(BUSINESS_DOC_CONTENT_TYPES as readonly string[]).includes(meta.contentType)) {
      throw new BadRequestException('지원하지 않는 파일 형식입니다.');
    }

    const previous = await this.prisma.business.findFirst({
      where: { id: businessId, partnerProfileId, deletedAt: null },
      select: { registrationDocPathname: true },
    });

    const { count } = await this.prisma.business.updateMany({
      where: {
        id: businessId,
        partnerProfileId,
        deletedAt: null,
        verificationStatus: { in: EDITABLE_STATUSES },
      },
      data: { registrationDocPathname: dto.pathname },
    });
    assertAffected(count, 1, 'BUSINESS_NOT_EDITABLE');

    // 교체된 이전 사본은 커밋이 끝난 뒤에 지운다. 트랜잭션 안에서 지우면
    // 롤백돼도 파일은 이미 사라져 있다.
    if (previous?.registrationDocPathname && previous.registrationDocPathname !== dto.pathname) {
      await this.blob.deleteByPathnameQuietly(previous.registrationDocPathname);
    }

    return this.get(user, businessId);
  }

  /**
   * 사업자등록증 열람 URL.
   *
   * 본인 서류라도 감사 행을 남긴다. 계정이 탈취되면 여기 있는 게 주민등록증 다음으로
   * 민감한 정보이고, "언제 누가 꺼냈는가"가 남아 있지 않으면 사고 후에 확인할 방법이 없다.
   */
  async resolveDoc(user: AuthenticatedUser, businessId: string) {
    const partnerProfileId = requirePartnerProfileId(user);

    const business = await this.prisma.business.findFirst({
      where: { id: businessId, partnerProfileId, deletedAt: null },
      select: { id: true, registrationDocPathname: true },
    });

    if (!business?.registrationDocPathname) {
      throw new NotFoundException('등록된 사업자등록증 사본이 없습니다.');
    }

    const resolved = await this.blob.resolveDownloadUrl(business.registrationDocPathname);

    await this.prisma.$transaction(async (tx) => {
      // 자문 락이 트랜잭션의 첫 문장이다. (IC-02 / IC-61)
      await this.audit.lockChain(tx, this.audit.chainKeyFor(AuditTargetType.BUSINESS));
      await this.audit.append(tx, {
        actorUserId: user.id,
        actorRole: AuditActorRole.PARTNER,
        actorLabel: actorLabelOf(user),
        action: AuditAction.REGISTRATION_DOC_VIEWED,
        targetType: AuditTargetType.BUSINESS,
        targetId: businessId,
        targetOwnerUserId: user.id,
        summary: '사업자등록증 사본 열람',
      });
    });

    return resolved;
  }

  /**
   * 심사 제출. UNSUBMITTED/REJECTED/REVOKED + 사본 있음에서만 넘어간다.
   *
   * 앞의 SELECT 는 **안내 문구를 만들기 위한 것**이다. 강제는 아래 UPDATE 의 WHERE 절이 한다.
   * 이 둘을 합치면(=읽고 판단해서 update) 승인 직후 도착한 재제출이 통과한다.
   */
  async submitVerification(
    user: AuthenticatedUser,
    businessId: string,
    dto: SubmitBusinessVerificationDto,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);
    const current = await this.findOwnedOrThrow(user, businessId);

    if (!current.registrationDocPathname) {
      throw new BadRequestException('사업자등록증 사본을 먼저 업로드해 주세요.');
    }
    if (!EDITABLE_STATUSES.includes(current.verificationStatus)) {
      throw new BadRequestException(
        current.verificationStatus === BusinessVerificationStatus.VERIFIED
          ? '이미 승인된 사업자입니다.'
          : '심사가 진행 중입니다. 결과를 기다려 주세요.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.audit.lockChain(tx, this.audit.chainKeyFor(AuditTargetType.BUSINESS));
      const now = await dbNow(tx);

      const { count } = await tx.business.updateMany({
        where: {
          id: businessId,
          partnerProfileId,
          deletedAt: null,
          verificationStatus: { in: EDITABLE_STATUSES },
          registrationDocPathname: { not: null },
        },
        data: {
          verificationStatus: BusinessVerificationStatus.PENDING,
          verificationSubmittedAt: now,
          verificationRejectionReason: null,
        },
      });
      assertAffected(count, 1, 'BUSINESS_NOT_SUBMITTABLE');

      await this.audit.append(tx, {
        actorUserId: user.id,
        actorRole: AuditActorRole.PARTNER,
        actorLabel: actorLabelOf(user),
        action: AuditAction.BUSINESS_SUBMITTED,
        targetType: AuditTargetType.BUSINESS,
        targetId: businessId,
        targetOwnerUserId: user.id,
        summary: `사업자 심사 제출: ${current.name}`,
        beforeJson: { verificationStatus: current.verificationStatus },
        // 심사자 메모는 별도 컬럼이 없다. 감사 행이 유일한 보존처이므로 여기에 싣는다.
        afterJson: {
          verificationStatus: BusinessVerificationStatus.PENDING,
          memo: dto.memo ?? null,
        },
        reasonCode: dto.memo ? 'PARTNER_MEMO' : null,
      });
    });

    return this.get(user, businessId);
  }

  /**
   * 소프트 삭제.
   *
   * 살아 있는 시설이 하나라도 있으면 거부한다 — 조건을 WHERE 절에 넣어야 하는 이유는,
   * 검사와 삭제 사이에 시설이 새로 생기면 그 시설이 소유자 없는 고아가 되기 때문이다.
   * 심사 중(PENDING)도 막는다. 운영자가 보고 있는 대상이 사라지면 심사 큐가 깨진다.
   */
  async remove(user: AuthenticatedUser, businessId: string) {
    const partnerProfileId = requirePartnerProfileId(user);

    await this.prisma.$transaction(async (tx) => {
      const now = await dbNow(tx);

      const { count } = await tx.business.updateMany({
        where: {
          id: businessId,
          partnerProfileId,
          deletedAt: null,
          verificationStatus: { not: BusinessVerificationStatus.PENDING },
          venues: { none: { deletedAt: null } },
        },
        data: { deletedAt: now },
      });
      assertAffected(count, 1, 'BUSINESS_NOT_DELETABLE');
    });
  }

  private async findOwnedOrThrow(user: AuthenticatedUser, businessId: string) {
    const partnerProfileId = requirePartnerProfileId(user);

    const business = await this.prisma.business.findFirst({
      where: { id: businessId, partnerProfileId, deletedAt: null },
      select: BUSINESS_SELECT,
    });

    if (!business) throw new NotFoundException('사업자를 찾을 수 없습니다.');

    return business;
  }

  /**
   * 형식(DTO)과 체크섬(여기)을 나눠서 본다.
   * `business_brn_uq` 는 하이픈 없는 10자리를 전제로 걸려 있으므로 정규화가 저장 직전이 아니라
   * **비교·검증 이전에** 끝나 있어야 한다. (internal/brn.ts)
   */
  private checkedBrn(raw: string): string {
    const digits = normalizeBrn(raw);

    if (!isValidBrn(digits)) {
      throw new BadRequestException('사업자등록번호가 올바르지 않습니다. 번호를 다시 확인해 주세요.');
    }

    return digits;
  }
}

function toBusinessResponse(row: BusinessRow) {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    businessRegistrationNumber: row.businessRegistrationNumber,
    businessType: row.businessType,
    representativeName: row.representativeName,
    verificationStatus: row.verificationStatus,
    verificationSubmittedAt: row.verificationSubmittedAt,
    verifiedAt: row.verifiedAt,
    verificationRejectionReason: row.verificationRejectionReason,
    // 경로 자체는 내려주지 않는다. 공개 스토어라 경로를 알면 URL 을 조립할 수 있다.
    hasRegistrationDoc: row.registrationDocPathname !== null,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    postalCode: row.postalCode,
    roadAddress: row.roadAddress,
    detailAddress: row.detailAddress,
    venueCount: row._count.venues,
    createdAt: row.createdAt,
  };
}
