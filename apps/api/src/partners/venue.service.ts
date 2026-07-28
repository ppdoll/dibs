import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditActorRole,
  AuditTargetType,
  BusinessVerificationStatus,
  Prisma,
  RegionLevel,
  VenueImageStatus,
  VenueStatus,
} from '@prisma/client';

import { assertAffected, assertVersionMatch } from '../common/db/assert-affected';
import { toCursorPage } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateVenueDto,
  HideVenueDto,
  ListVenuesQueryDto,
  UpdateVenueDto,
} from './dto/venue.dto';
import { PartnerAuditService, type Tx } from './internal/partner-audit.service';
import { actorLabelOf, requirePartnerProfileId } from './internal/partner-context';
import { mapUniqueViolation } from './internal/prisma-errors';
import { buildVenueSearchText } from './internal/search-text';
import { buildVenueSlug } from './internal/slug';
import { dbNow } from './internal/tx-time';

const VENUE_SUMMARY_SELECT = {
  id: true,
  businessId: true,
  name: true,
  slug: true,
  status: true,
  summary: true,
  sido: true,
  sigungu: true,
  imageCount: true,
  openEventCount: true,
  version: true,
  createdAt: true,
  coverImage: { select: { blobUrl: true } },
} satisfies Prisma.VenueSelect;

const VENUE_DETAIL_SELECT = {
  ...VENUE_SUMMARY_SELECT,
  description: true,
  primaryCategoryId: true,
  secondaryCategories: { select: { id: true } },
  regionCode: true,
  postalCode: true,
  roadAddress: true,
  detailAddress: true,
  latitude: true,
  longitude: true,
  phone: true,
  websiteUrl: true,
  instagramHandle: true,
  seatCount: true,
  reservationNotice: true,
  businessHours: true,
  specialHours: true,
  submittedForReviewAt: true,
  publishedAt: true,
  hiddenAt: true,
  suspendedAt: true,
  suspensionReason: true,
  images: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      blobUrl: true,
      altText: true,
      sortOrder: true,
      isCover: true,
      status: true,
      quarantineReason: true,
    },
  },
} satisfies Prisma.VenueSelect;

type VenueSummaryRow = Prisma.VenueGetPayload<{ select: typeof VENUE_SUMMARY_SELECT }>;
type VenueDetailRow = Prisma.VenueGetPayload<{ select: typeof VENUE_DETAIL_SELECT }>;

/** 상태 전이 1건의 명세. 다섯 개 전이가 전부 같은 모양이라 한 곳에 모았다. */
interface TransitionSpec {
  from: VenueStatus[];
  to: VenueStatus;
  code: string;
  action: AuditAction;
  reject: (current: VenueStatus) => string;
  extraWhere?: Prisma.VenueWhereInput;
  data?: (now: Date) => Prisma.VenueUpdateManyMutationInput;
  summary: (name: string) => string;
}

@Injectable()
export class VenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PartnerAuditService,
  ) {}

  /**
   * 시설 생성.
   *
   * 트랜잭션의 첫 문장이 사업자 행에 대한 `FOR SHARE` 다. "내 사업자인가"를 그냥 SELECT 로 읽고
   * 그다음 INSERT 하면, 그 사이에 사업자가 소프트 삭제되어 **소유자 없는 시설**이 남는다.
   * 공유 락이면 그 UPDATE 가 우리 커밋까지 기다리므로 창이 닫힌다. (IC-11 과 같은 형태)
   */
  async create(user: AuthenticatedUser, dto: CreateVenueDto) {
    const partnerProfileId = requirePartnerProfileId(user);
    const secondaryIds = dedupe(dto.secondaryCategoryIds ?? []).filter(
      (id) => id !== dto.primaryCategoryId,
    );

    const venueId = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<{ id: string }[]>`
        SELECT b."id"
        FROM "Business" b
        WHERE b."id" = ${dto.businessId}
          AND b."partnerProfileId" = ${partnerProfileId}
          AND b."deletedAt" IS NULL
        FOR SHARE
      `;

      if (owned.length !== 1) {
        throw new NotFoundException('사업자를 찾을 수 없습니다.');
      }

      const region = await this.loadSigunguRegion(tx, dto.regionCode);
      const categories = await this.loadUsableCategories(tx, dto.primaryCategoryId, secondaryIds);

      const created = await mapUniqueViolation(() =>
        tx.venue.create({
          data: {
            businessId: dto.businessId,
            name: dto.name,
            // 슬러그는 항상 무작위 꼬리가 붙는다(internal/slug.ts). 이름이 겹쳐도 충돌하지 않는다.
            slug: buildVenueSlug(dto.name, dto.slugBase),
            summary: dto.summary ?? null,
            description: dto.description ?? null,
            status: VenueStatus.DRAFT,
            primaryCategoryId: dto.primaryCategoryId,
            ...(secondaryIds.length > 0
              ? { secondaryCategories: { connect: secondaryIds.map((id) => ({ id })) } }
              : {}),
            regionCode: dto.regionCode,
            sido: region.sido,
            sigungu: region.sigungu,
            postalCode: dto.postalCode,
            roadAddress: dto.roadAddress,
            detailAddress: dto.detailAddress ?? null,
            latitude: dto.latitude === undefined ? null : new Prisma.Decimal(dto.latitude),
            longitude: dto.longitude === undefined ? null : new Prisma.Decimal(dto.longitude),
            phone: dto.phone,
            websiteUrl: dto.websiteUrl ?? null,
            instagramHandle: dto.instagramHandle ?? null,
            seatCount: dto.seatCount ?? null,
            reservationNotice: dto.reservationNotice ?? null,
            businessHours: toJsonInput(dto.businessHours),
            specialHours: toJsonInput(dto.specialHours),
            searchText: buildVenueSearchText([
              dto.name,
              dto.summary,
              region.sido,
              region.sigungu,
              dto.roadAddress,
              ...categories.map((c) => c.nameKo),
            ]),
          },
          select: { id: true },
        }),
      );

      return created.id;
    });

    return this.getDetail(user, venueId);
  }

  async list(user: AuthenticatedUser, query: ListVenuesQueryDto) {
    const partnerProfileId = requirePartnerProfileId(user);

    const rows = await this.prisma.venue.findMany({
      where: {
        deletedAt: null,
        business: { partnerProfileId, deletedAt: null },
        ...(query.status ? { status: query.status } : {}),
        ...(query.businessId ? { businessId: query.businessId } : {}),
      },
      // cuid 는 시각이 앞에 오므로 id 역순이 곧 최신순이다.
      // createdAt 으로 정렬하면 동일 밀리초에서 커서가 항목을 건너뛴다.
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: VENUE_SUMMARY_SELECT,
    });

    const page = toCursorPage(rows, query.limit);

    return { ...page, items: page.items.map(toVenueSummary) };
  }

  async getDetail(user: AuthenticatedUser, venueId: string) {
    return toVenueDetail(await this.findOwnedOrThrow(user, venueId));
  }

  /**
   * 부분 수정. `If-Match` 는 `Venue.version` 이다.
   *
   * 낙관적 락을 붙이는 이유: 시설 폼은 한 파트너 계정을 여러 직원이 함께 쓴다.
   * 마지막 저장이 이기는 방식이면 옆자리에서 방금 고친 영업시간이 조용히 되돌아간다.
   * 버전은 UPDATE 의 WHERE 절에 들어가므로 검사와 쓰기가 한 문장이다. (IC-01 / IC-63)
   */
  async update(
    user: AuthenticatedUser,
    venueId: string,
    ifMatchVersion: number,
    dto: UpdateVenueDto,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);
    const secondaryIds = dto.secondaryCategoryIds
      ? dedupe(dto.secondaryCategoryIds).filter((id) => id !== dto.primaryCategoryId)
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      const region = dto.regionCode ? await this.loadSigunguRegion(tx, dto.regionCode) : null;

      if (dto.primaryCategoryId !== undefined || secondaryIds !== undefined) {
        await this.loadUsableCategories(
          tx,
          dto.primaryCategoryId ?? (await this.currentPrimaryCategoryId(tx, venueId)),
          secondaryIds ?? [],
        );
      }

      // FK(primaryCategoryId, regionCode)를 관계 connect 가 아니라 스칼라로 넣는다.
      // updateMany 의 data 는 관계 조작을 받지 못하는데, 소유·버전 전제를 WHERE 절에 담으려면
      // update 가 아니라 updateMany 여야 하기 때문이다.
      const data: Prisma.VenueUncheckedUpdateManyInput = {
        ...pick(dto, [
          'name',
          'summary',
          'description',
          'postalCode',
          'roadAddress',
          'detailAddress',
          'phone',
          'websiteUrl',
          'instagramHandle',
          'seatCount',
          'reservationNotice',
        ]),
        ...(dto.latitude !== undefined ? { latitude: new Prisma.Decimal(dto.latitude) } : {}),
        ...(dto.longitude !== undefined ? { longitude: new Prisma.Decimal(dto.longitude) } : {}),
        ...(dto.businessHours !== undefined
          ? { businessHours: toJsonInput(dto.businessHours) }
          : {}),
        ...(dto.specialHours !== undefined ? { specialHours: toJsonInput(dto.specialHours) } : {}),
        ...(dto.primaryCategoryId !== undefined
          ? { primaryCategoryId: dto.primaryCategoryId }
          : {}),
        ...(region && dto.regionCode
          ? { regionCode: dto.regionCode, sido: region.sido, sigungu: region.sigungu }
          : {}),
      };

      if (Object.keys(data).length === 0 && secondaryIds === undefined) {
        throw new BadRequestException('변경할 내용이 없습니다.');
      }

      const payload: Prisma.VenueUncheckedUpdateManyInput = {
        ...data,
        version: { increment: 1 },
      };

      const updated = await mapUniqueViolation(() =>
        tx.venue.updateMany({
          where: {
            id: venueId,
            version: ifMatchVersion,
            deletedAt: null,
            // 보관·정지된 시설은 파트너가 고칠 수 없다. 정지 해제는 운영자 몫이다.
            status: { notIn: [VenueStatus.ARCHIVED, VenueStatus.SUSPENDED] },
            business: { partnerProfileId, deletedAt: null },
          },
          data: payload,
        }),
      );
      assertVersionMatch(updated.count, 'VENUE_VERSION_MISMATCH');

      // 다대다(부가 카테고리)만 updateMany 로 표현할 수 없어 따로 쓴다.
      // 위 UPDATE 가 이미 이 행의 락을 쥐고 있으므로 그 사이에 끼어들 수 있는 쓰기는 없다.
      if (secondaryIds !== undefined) {
        await tx.venue.update({
          where: { id: venueId },
          data: { secondaryCategories: { set: secondaryIds.map((id) => ({ id })) } },
        });
      }

      await this.refreshSearchText(tx, venueId);
    });

    return this.getDetail(user, venueId);
  }

  /**
   * 심사 요청. DRAFT 에서만, 그리고 사업자 승인·대표 이미지가 갖춰졌을 때만.
   *
   * 앞의 진단 SELECT 는 **무엇이 모자란지 알려주기 위한 것**이다.
   * 강제는 아래 조건부 UPDATE 의 WHERE 절이 한다 — 둘을 합치면 승인 취소 직후 도착한
   * 심사 요청이 통과한다.
   */
  async submitForReview(user: AuthenticatedUser, venueId: string) {
    const partnerProfileId = requirePartnerProfileId(user);
    const readiness = await this.prisma.venue.findFirst({
      where: { id: venueId, deletedAt: null, business: { partnerProfileId, deletedAt: null } },
      select: {
        status: true,
        imageCount: true,
        coverImageId: true,
        business: { select: { verificationStatus: true } },
      },
    });

    if (!readiness) throw new NotFoundException('시설을 찾을 수 없습니다.');

    if (readiness.business.verificationStatus !== BusinessVerificationStatus.VERIFIED) {
      throw new ConflictException({
        code: 'BUSINESS_NOT_VERIFIED',
        message: '사업자 심사가 승인된 뒤에 시설 심사를 요청할 수 있습니다.',
      });
    }
    if (readiness.imageCount < 1 || readiness.coverImageId === null) {
      throw new ConflictException({
        code: 'VENUE_COVER_REQUIRED',
        message: '대표 이미지를 1장 이상 등록해 주세요.',
      });
    }

    return this.runTransition(user, venueId, {
      from: [VenueStatus.DRAFT],
      to: VenueStatus.PENDING_REVIEW,
      code: 'VENUE_NOT_SUBMITTABLE',
      action: AuditAction.VENUE_SUBMITTED,
      reject: () => '작성 중인 시설만 심사 요청할 수 있습니다.',
      extraWhere: {
        imageCount: { gt: 0 },
        coverImageId: { not: null },
        business: {
          partnerProfileId,
          deletedAt: null,
          verificationStatus: BusinessVerificationStatus.VERIFIED,
        },
      },
      data: (now) => ({ submittedForReviewAt: now }),
      summary: (name) => `시설 심사 요청: ${name}`,
    });
  }

  /** 노출 중단. 운영자 정지(SUSPENDED)와 구분된다 — 이건 파트너가 스스로 되돌릴 수 있다. */
  async hide(user: AuthenticatedUser, venueId: string, dto: HideVenueDto) {
    return this.runTransition(user, venueId, {
      from: [VenueStatus.ACTIVE],
      to: VenueStatus.HIDDEN,
      code: 'VENUE_NOT_HIDEABLE',
      action: AuditAction.VENUE_HIDDEN,
      reject: () => '노출 중인 시설만 숨길 수 있습니다.',
      data: (now) => ({ hiddenAt: now }),
      summary: (name) => `시설 노출 중단: ${name}${dto.reason ? ` (${dto.reason})` : ''}`,
    });
  }

  /**
   * 노출 재개.
   *
   * 심사를 다시 받지 않는 이유: 이미 한 번 통과한 시설이고 그 사이 내용이 바뀌었다면
   * 그 수정 자체가 심사 대상이어야 한다(운영자 모듈의 재심사 트리거 몫).
   * `publishedAt` 은 최초 공개 시각이라 여기서 덮어쓰지 않는다.
   */
  async unhide(user: AuthenticatedUser, venueId: string) {
    return this.runTransition(user, venueId, {
      from: [VenueStatus.HIDDEN],
      to: VenueStatus.ACTIVE,
      code: 'VENUE_NOT_UNHIDEABLE',
      action: AuditAction.VENUE_PUBLISHED,
      reject: () => '숨김 상태인 시설만 다시 노출할 수 있습니다.',
      data: () => ({ hiddenAt: null }),
      summary: (name) => `시설 노출 재개: ${name}`,
    });
  }

  /**
   * 보관.
   *
   * 진행 중인 이벤트가 있으면 막는다. 조건을 WHERE 절에 두는 이유는, 검사와 보관 사이에
   * 이벤트가 열리면 **신청은 받는데 시설은 사라진 이벤트**가 만들어지기 때문이다.
   */
  async archive(user: AuthenticatedUser, venueId: string) {
    return this.runTransition(user, venueId, {
      from: [VenueStatus.DRAFT, VenueStatus.HIDDEN],
      to: VenueStatus.ARCHIVED,
      code: 'VENUE_NOT_ARCHIVABLE',
      action: AuditAction.VENUE_ARCHIVED,
      reject: (current) =>
        current === VenueStatus.ACTIVE
          ? '노출을 먼저 중단한 뒤 보관할 수 있습니다.'
          : '작성 중이거나 숨김 상태인 시설만 보관할 수 있습니다.',
      extraWhere: { openEventCount: 0 },
      data: () => ({}),
      summary: (name) => `시설 보관: ${name}`,
    });
  }

  /** 보관 해제는 DRAFT 로 돌아간다 — 다시 노출하려면 심사를 새로 받아야 한다. */
  async restore(user: AuthenticatedUser, venueId: string) {
    return this.runTransition(user, venueId, {
      from: [VenueStatus.ARCHIVED],
      to: VenueStatus.DRAFT,
      code: 'VENUE_NOT_RESTORABLE',
      action: AuditAction.CONTENT_RESTORED,
      reject: () => '보관된 시설만 복구할 수 있습니다.',
      data: () => ({ submittedForReviewAt: null, hiddenAt: null }),
      summary: (name) => `시설 보관 해제: ${name}`,
    });
  }

  /**
   * 소프트 삭제.
   *
   * 이벤트가 한 번이라도 걸렸던 시설은 지우지 않는다 — 지난 신청·정산 기록이 가리키는
   * 대상이 사라지면 그 기록이 해석 불가능해진다. 보관(ARCHIVED)이 그 경우의 종착지다.
   * `deletedAt` 이 채워지는 순간 `venue_slug_uq` / `venue_business_name_live_uq` 에서
   * 빠지므로 같은 이름을 곧바로 다시 쓸 수 있다(001_constraints.sql §10).
   */
  async remove(user: AuthenticatedUser, venueId: string) {
    const partnerProfileId = requirePartnerProfileId(user);

    await this.prisma.$transaction(async (tx) => {
      const now = await dbNow(tx);

      const payload: Prisma.VenueUncheckedUpdateManyInput = {
        deletedAt: now,
        coverImageId: null,
        version: { increment: 1 },
      };

      const { count } = await tx.venue.updateMany({
        where: {
          id: venueId,
          deletedAt: null,
          status: { in: [VenueStatus.DRAFT, VenueStatus.ARCHIVED] },
          business: { partnerProfileId, deletedAt: null },
          events: { none: {} },
        },
        data: payload,
      });
      assertAffected(count, 1, 'VENUE_NOT_DELETABLE');

      // 이미지도 같이 내린다. blob 실물은 스위퍼가 status='DELETING' 를 보고 걷어간다.
      await tx.venueImage.updateMany({
        where: { venueId, deletedAt: null },
        data: { deletedAt: now, status: VenueImageStatus.DELETING, isCover: false },
      });
    });
  }

  // --- 내부 ---

  private async runTransition(
    user: AuthenticatedUser,
    venueId: string,
    spec: TransitionSpec,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);
    const current = await this.findOwnedOrThrow(user, venueId);

    if (!spec.from.includes(current.status)) {
      throw new ConflictException({ code: spec.code, message: spec.reject(current.status) });
    }

    await this.prisma.$transaction(async (tx) => {
      // 자문 락이 트랜잭션의 첫 문장이다. (IC-02 / IC-61)
      await this.audit.lockChain(tx, this.audit.chainKeyFor(AuditTargetType.VENUE));
      const now = await dbNow(tx);

      const { count } = await tx.venue.updateMany({
        where: {
          id: venueId,
          deletedAt: null,
          status: { in: spec.from },
          business: { partnerProfileId, deletedAt: null },
          ...spec.extraWhere,
        },
        data: {
          ...(spec.data ? spec.data(now) : {}),
          status: spec.to,
          version: { increment: 1 },
        },
      });
      assertAffected(count, 1, spec.code);

      await this.audit.append(tx, {
        actorUserId: user.id,
        actorRole: AuditActorRole.PARTNER,
        actorLabel: actorLabelOf(user),
        action: spec.action,
        targetType: AuditTargetType.VENUE,
        targetId: venueId,
        targetOwnerUserId: user.id,
        summary: spec.summary(current.name),
        beforeJson: { status: current.status },
        afterJson: { status: spec.to },
      });
    });

    return this.getDetail(user, venueId);
  }

  private async findOwnedOrThrow(user: AuthenticatedUser, venueId: string) {
    const partnerProfileId = requirePartnerProfileId(user);

    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, deletedAt: null, business: { partnerProfileId, deletedAt: null } },
      select: VENUE_DETAIL_SELECT,
    });

    if (!venue) throw new NotFoundException('시설을 찾을 수 없습니다.');

    return venue;
  }

  /**
   * `Venue.regionCode` 는 반드시 SIGUNGU 레벨이어야 한다.
   * DB 트리거(001_constraints.sql 12-3)가 최종 방어선이지만, 트리거가 던지는 오류는
   * 사용자에게 보여줄 수 없는 문구라 여기서 먼저 걸러 이유를 알려준다.
   */
  private async loadSigunguRegion(tx: Tx, regionCode: string) {
    const region = await tx.region.findFirst({
      where: { code: regionCode, level: RegionLevel.SIGUNGU, isActive: true },
      select: { sido: true, sigungu: true },
    });

    if (!region?.sigungu) {
      throw new BadRequestException('시/군/구 단위의 지역을 선택해 주세요.');
    }

    return { sido: region.sido, sigungu: region.sigungu };
  }

  private async loadUsableCategories(tx: Tx, primaryId: string, secondaryIds: string[]) {
    const ids = dedupe([primaryId, ...secondaryIds]);

    const found = await tx.category.findMany({
      where: { id: { in: ids }, isActive: true, deletedAt: null },
      select: { id: true, nameKo: true },
    });

    if (found.length !== ids.length) {
      throw new BadRequestException('사용할 수 없는 카테고리가 포함되어 있습니다.');
    }

    return found;
  }

  private async currentPrimaryCategoryId(tx: Tx, venueId: string): Promise<string> {
    const row = await tx.venue.findUnique({
      where: { id: venueId },
      select: { primaryCategoryId: true },
    });

    if (!row) throw new NotFoundException('시설을 찾을 수 없습니다.');

    return row.primaryCategoryId;
  }

  /**
   * 검색 캐시 재계산.
   *
   * 병합 결과에서만 만들 수 있으므로 수정이 끝난 뒤에 한 번 더 쓴다.
   * 같은 트랜잭션이라 "검색 텍스트만 옛 값으로 남은" 중간 상태가 밖에서 보이지 않는다.
   */
  private async refreshSearchText(tx: Tx, venueId: string): Promise<void> {
    const row = await tx.venue.findUnique({
      where: { id: venueId },
      select: {
        name: true,
        summary: true,
        sido: true,
        sigungu: true,
        roadAddress: true,
        primaryCategory: { select: { nameKo: true } },
        secondaryCategories: { select: { nameKo: true } },
      },
    });

    if (!row) return;

    await tx.venue.update({
      where: { id: venueId },
      data: {
        searchText: buildVenueSearchText([
          row.name,
          row.summary,
          row.sido,
          row.sigungu,
          row.roadAddress,
          row.primaryCategory.nameKo,
          ...row.secondaryCategories.map((c) => c.nameKo),
        ]),
      },
    });
  }
}

// --- 매퍼 / 잡동사니 ---

function toVenueSummary(row: VenueSummaryRow) {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    summary: row.summary,
    sido: row.sido,
    sigungu: row.sigungu,
    imageCount: row.imageCount,
    openEventCount: row.openEventCount,
    coverImageUrl: row.coverImage?.blobUrl ?? null,
    version: row.version,
    createdAt: row.createdAt,
  };
}

function toVenueDetail(row: VenueDetailRow) {
  return {
    ...toVenueSummary(row),
    description: row.description,
    primaryCategoryId: row.primaryCategoryId,
    secondaryCategoryIds: row.secondaryCategories.map((c) => c.id),
    regionCode: row.regionCode,
    postalCode: row.postalCode,
    roadAddress: row.roadAddress,
    detailAddress: row.detailAddress,
    // Decimal 을 그대로 직렬화하면 `{ s, e, d }` 객체가 나간다. 좌표는 수로 내보낸다.
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    phone: row.phone,
    websiteUrl: row.websiteUrl,
    instagramHandle: row.instagramHandle,
    seatCount: row.seatCount,
    reservationNotice: row.reservationNotice,
    businessHours: row.businessHours,
    specialHours: row.specialHours,
    submittedForReviewAt: row.submittedForReviewAt,
    publishedAt: row.publishedAt,
    hiddenAt: row.hiddenAt,
    suspendedAt: row.suspendedAt,
    suspensionReason: row.suspensionReason,
    images: row.images,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** 보내지 않은 키는 그대로 두어야 하므로 `undefined` 를 걸러낸다(PATCH 의 의미). */
function pick<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};

  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }

  return out;
}

/** Json? 컬럼에 SQL NULL 을 넣으려면 `Prisma.DbNull` 이어야 한다. JS null 은 JSON null 이다. */
function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
