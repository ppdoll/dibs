import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditActorRole,
  AuditTargetType,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  Prisma,
  VenueImageStatus,
} from '@prisma/client';

import { assertAffected } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_VENUE_IMAGES,
  type RegisterVenueImageDto,
  type ReorderVenueImagesDto,
  type UpdateVenueImageDto,
  type VenueImageUploadTicketDto,
} from './dto/venue-image.dto';
import { PartnerAuditService, type Tx } from './internal/partner-audit.service';
import {
  PartnerBlobService,
  VENUE_IMAGE_CONTENT_TYPES,
  VENUE_IMAGE_MAX_BYTES,
} from './internal/partner-blob.service';
import { requirePartnerProfileId } from './internal/partner-context';
import { mapUniqueViolation } from './internal/prisma-errors';

/**
 * 업로드 티켓만 받아가고 실제 업로드를 하지 않은 행의 수명.
 *
 * 이 행들은 살아 있는 동안 `sortOrder` 한 자리를 점유한다(부분 유니크는 `deletedAt IS NULL`
 * 만 보지 status 를 보지 않는다). 브라우저를 닫아버린 업로드가 순서 재배치를 영구히 막지
 * 않도록, 조회 시 지연 만료로 걷어낸다 — 서버리스라 상주 정리 프로세스를 둘 수 없다.
 * 토큰 유효시간(60초)보다 훨씬 길게 잡아 느린 업로드를 잘라먹지 않는다.
 */
const STALE_PENDING_MINUTES = 30;

const IMAGE_SELECT = {
  id: true,
  venueId: true,
  blobUrl: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  altText: true,
  sortOrder: true,
  isCover: true,
  status: true,
  quarantineReason: true,
  createdAt: true,
} satisfies Prisma.VenueImageSelect;

@Injectable()
export class VenueImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: PartnerBlobService,
    private readonly audit: PartnerAuditService,
  ) {}

  async list(user: AuthenticatedUser, venueId: string) {
    const partnerProfileId = requirePartnerProfileId(user);
    await this.purgeStalePending(this.prisma, venueId, partnerProfileId);

    const rows = await this.prisma.venueImage.findMany({
      where: {
        venueId,
        deletedAt: null,
        venue: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
      },
      orderBy: { sortOrder: 'asc' },
      select: IMAGE_SELECT,
    });

    return rows;
  }

  /**
   * 업로드 티켓 발급 = 자리 예약.
   *
   * DB 행을 **먼저** 만드는 이유: blob 경로가 `venues/{venueId}/{imageId}` 라서 id 가 없으면
   * 경로를 정할 수 없고, 경로를 클라이언트가 정하게 두면 `addRandomSuffix:false` 와 맞물려
   * 남의 이미지를 덮어쓸 수 있다(partner-blob.service.ts 주석 참고).
   *
   * INSERT 를 `SELECT ... FROM "Venue" JOIN "Business"` 로 쓴 것이 소유권 검사 그 자체다.
   * 소유가 아니면 0행이 들어가고, 별도의 "내 시설인가" SELECT 가 필요 없다 —
   * 그 SELECT 와 INSERT 사이가 정확히 TOCTOU 창이다.
   */
  async createUploadTicket(
    user: AuthenticatedUser,
    venueId: string,
    dto: VenueImageUploadTicketDto,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);
    await this.purgeStalePending(this.prisma, venueId, partnerProfileId);

    const imageId = randomUUID();
    const pathname = this.blob.venueImagePathname(venueId, imageId, dto.contentType);

    const inserted = await mapUniqueViolation(() =>
      this.prisma.$executeRaw`
        INSERT INTO "VenueImage"
          ("id","venueId","blobUrl","blobPathname","mimeType","byteSize","width","height",
           "sortOrder","isCover","status","uploadedByUserId","createdAt","updatedAt")
        SELECT
          ${imageId}, v."id", '', ${pathname}, ${dto.contentType}, 0, 0, 0,
          -- 음수는 재배치가 쓰는 대피 구간이다(001_constraints.sql §10).
          -- 재배치 중인 스냅샷을 읽더라도 새 자리가 음수로 내려가지 않도록 0 으로 바닥을 깐다.
          GREATEST(COALESCE((
            SELECT MAX(i."sortOrder") FROM "VenueImage" i
            WHERE i."venueId" = v."id" AND i."deletedAt" IS NULL
          ), 0), 0) + 1,
          false, 'PENDING'::"VenueImageStatus", ${user.id}, now(), now()
        FROM "Venue" v
        JOIN "Business" b ON b."id" = v."businessId"
        WHERE v."id" = ${venueId}
          AND v."deletedAt" IS NULL
          AND v."status" NOT IN ('ARCHIVED', 'SUSPENDED')
          AND b."partnerProfileId" = ${partnerProfileId}
          AND b."deletedAt" IS NULL
          AND (
            SELECT count(*) FROM "VenueImage" c
            WHERE c."venueId" = v."id" AND c."deletedAt" IS NULL
          ) < ${MAX_VENUE_IMAGES}::int
      `,
    );

    if (inserted !== 1) {
      // 소유가 아니거나, 보관·정지된 시설이거나, 장 수 상한에 걸렸다.
      // 어느 쪽인지 구분해 주면 남의 시설 id 존재 여부를 훑을 수 있으므로 한 문구로 묶는다.
      throw new BadRequestException(
        `이미지를 추가할 수 없습니다. 시설 상태와 이미지 수(최대 ${MAX_VENUE_IMAGES}장)를 확인해 주세요.`,
      );
    }

    const ticket = await this.blob.createUploadTicket({
      pathname,
      allowedContentTypes: VENUE_IMAGE_CONTENT_TYPES,
      maxBytes: VENUE_IMAGE_MAX_BYTES,
    });

    return {
      imageId,
      pathname: ticket.pathname,
      clientToken: ticket.clientToken,
      expiresAt: ticket.expiresAt,
      maxBytes: ticket.maxBytes,
      allowedContentTypes: ticket.allowedContentTypes,
    };
  }

  /**
   * 업로드 완료 통보 → 행을 READY 로 올린다.
   *
   * blob 확인은 트랜잭션 **밖**에서 한다. 외부 HTTP 왕복을 트랜잭션 안에 넣으면
   * 그동안 커넥션과 행 락을 붙잡는데, 서버리스 + pgbouncer 에서 그건 곧 풀 고갈이다.
   * 대신 아래 UPDATE 가 `status='PENDING'` 전제를 WHERE 절에 그대로 들고 있어서,
   * 확인과 등록 사이에 상태가 바뀌면 0행으로 떨어진다. (IC-01)
   */
  async register(
    user: AuthenticatedUser,
    venueId: string,
    imageId: string,
    dto: RegisterVenueImageDto,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);

    const pending = await this.prisma.venueImage.findFirst({
      where: {
        id: imageId,
        venueId,
        status: VenueImageStatus.PENDING,
        deletedAt: null,
        venue: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
      },
      select: { blobPathname: true },
    });

    if (!pending) throw new NotFoundException('업로드 예약을 찾을 수 없습니다. 다시 시도해 주세요.');

    const meta = await this.blob.verifyUploaded(dto.blobUrl, pending.blobPathname);

    // 크기·타입은 클라이언트가 아니라 저장소가 말한 값으로 본다. 토큰에도 상한이 걸려 있지만
    // 토큰 검증은 Vercel 쪽이고, 우리 DB 에 남는 값은 우리가 확인한 값이어야 한다.
    if (meta.size > VENUE_IMAGE_MAX_BYTES) {
      throw new BadRequestException('이미지 용량이 너무 큽니다.');
    }
    if (!(VENUE_IMAGE_CONTENT_TYPES as readonly string[]).includes(meta.contentType)) {
      throw new BadRequestException('지원하지 않는 이미지 형식입니다.');
    }

    const quarantineReason = await this.screenUploadedImage({
      byteSize: meta.size,
      width: dto.width,
      height: dto.height,
    });

    await this.prisma.$transaction(async (tx) => {
      // 격리는 감사 대상이다. 감사 행을 쓰는 트랜잭션이면 자문 락이 첫 문장이어야 한다. (IC-02)
      if (quarantineReason) {
        await this.audit.lockChain(tx, this.audit.chainKeyFor(AuditTargetType.VENUE_IMAGE));
      }

      const { count } = await tx.venueImage.updateMany({
        where: {
          id: imageId,
          venueId,
          status: VenueImageStatus.PENDING,
          deletedAt: null,
          venue: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
        },
        data: {
          blobUrl: dto.blobUrl,
          mimeType: meta.contentType,
          byteSize: meta.size,
          width: dto.width,
          height: dto.height,
          altText: dto.altText ?? null,
          status: quarantineReason ? VenueImageStatus.QUARANTINED : VenueImageStatus.READY,
          quarantineReason,
        },
      });
      assertAffected(count, 1, 'VENUE_IMAGE_STATE_CHANGED');

      await this.syncImageCount(tx, venueId);

      if (quarantineReason) {
        await this.audit.append(tx, {
          actorUserId: null,
          actorRole: AuditActorRole.SYSTEM,
          actorLabel: 'system:image-screening',
          action: AuditAction.VENUE_IMAGE_QUARANTINED,
          targetType: AuditTargetType.VENUE_IMAGE,
          targetId: imageId,
          targetOwnerUserId: user.id,
          summary: `업로드 이미지 격리: ${quarantineReason}`,
        });

        // 아웃박스. 알림 발송은 별도 워커가 하고, 여기서는 같은 트랜잭션에 행만 남긴다. (IC-42)
        await tx.notification.create({
          data: {
            userId: user.id,
            type: NotificationType.VENUE_IMAGE_QUARANTINED,
            category: NotificationCategory.PARTNER_OPS,
            priority: NotificationPriority.HIGH,
            titleKo: '업로드한 이미지가 보류되었습니다',
            bodyKo: `등록하신 이미지가 검수 대기 상태로 전환되었습니다. 사유: ${quarantineReason}`,
            deepLinkPath: `/partner/venues/${venueId}/images`,
            dedupeKey: `VENUE_IMAGE_QUARANTINED:${imageId}`,
          },
        });

        return;
      }

      // 첫 정상 이미지는 대표로 승격한다. 대표가 없으면 시설을 심사에 올릴 수 없다.
      const promoted = await tx.venue.updateMany({
        where: { id: venueId, coverImageId: null },
        data: { coverImageId: imageId } satisfies Prisma.VenueUncheckedUpdateManyInput,
      });

      if (promoted.count === 1) {
        await tx.venueImage.updateMany({ where: { id: imageId }, data: { isCover: true } });
      }
    });

    return this.getOwnedImageOrThrow(user, venueId, imageId);
  }

  async updateAltText(
    user: AuthenticatedUser,
    venueId: string,
    imageId: string,
    dto: UpdateVenueImageDto,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);

    const { count } = await this.prisma.venueImage.updateMany({
      where: {
        id: imageId,
        venueId,
        deletedAt: null,
        venue: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
      },
      data: { altText: dto.altText ?? null },
    });
    assertAffected(count, 1, 'VENUE_IMAGE_NOT_FOUND');

    return this.getOwnedImageOrThrow(user, venueId, imageId);
  }

  /**
   * 대표 이미지 지정.
   *
   * `Venue.coverImageId` 와 `VenueImage.isCover` 둘 다 유지한다. 목록 화면은 조인 없이
   * 시설 행만 읽고, 이미지 관리 화면은 이미지 행만 읽기 때문이다. 두 값이 어긋나면
   * 화면 둘이 서로 다른 대표를 보여주므로 **한 트랜잭션에서만** 바꾼다.
   * 격리된 이미지는 대표가 될 수 없다 — 노출 금지 대상이 첫 화면에 걸린다.
   */
  async setCover(user: AuthenticatedUser, venueId: string, imageId: string) {
    const partnerProfileId = requirePartnerProfileId(user);

    await this.prisma.$transaction(async (tx) => {
      // 해제 문장에도 소유 술어를 건다. 뒤의 assertAffected 가 어차피 롤백시키긴 하지만,
      // 그때까지 남의 시설 이미지 행에 쓰기 락이 걸린다 — 소유하지 않은 행은 읽지도 쓰지도 않는다.
      await tx.venueImage.updateMany({
        where: {
          venueId,
          isCover: true,
          deletedAt: null,
          venue: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
        },
        data: { isCover: false },
      });

      const marked = await tx.venueImage.updateMany({
        where: {
          id: imageId,
          venueId,
          deletedAt: null,
          status: VenueImageStatus.READY,
          venue: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
        },
        data: { isCover: true },
      });
      assertAffected(marked.count, 1, 'VENUE_IMAGE_NOT_COVERABLE');

      const linked = await tx.venue.updateMany({
        where: { id: venueId, deletedAt: null, business: { partnerProfileId, deletedAt: null } },
        data: { coverImageId: imageId } satisfies Prisma.VenueUncheckedUpdateManyInput,
      });
      assertAffected(linked.count, 1, 'VENUE_NOT_FOUND');
    });

    return this.list(user, venueId);
  }

  /**
   * 순서 재배치 — 2단계 쓰기. ★ (001_constraints.sql §10)
   *
   * `venue_image_order_live_uq` 는 **부분** 유니크라 DEFERRABLE 이 될 수 없다.
   * 그래서 [1,2,3] → [3,1,2] 처럼 자리를 맞바꾸는 순간, 중간 상태에서 반드시 충돌한다.
   * 해법은 값 공간을 비우는 것이다: 살아 있는 행 전체를 `-(sortOrder)-1` 로 음수 영역에
   * 대피시킨 뒤(사상이 단사라 자기들끼리도 충돌하지 않는다) 최종값 1..N 을 쓴다.
   * 두 문장이 같은 트랜잭션이므로 밖에서는 음수 구간이 보이지 않는다.
   *
   * 1단계가 살아 있는 행 **전부**를 잠그기 때문에, 동시에 들어온 두 재배치는 자동으로
   * 줄을 선다(뒤엣것은 앞엣것의 결과 위에서 다시 판정된다). 별도 락이 필요 없는 이유다.
   */
  async reorder(user: AuthenticatedUser, venueId: string, dto: ReorderVenueImagesDto) {
    const partnerProfileId = requirePartnerProfileId(user);

    await this.prisma.$transaction(async (tx) => {
      await this.purgeStalePending(tx, venueId, partnerProfileId);

      const dodged = await tx.$executeRaw`
        UPDATE "VenueImage" i
        SET "sortOrder" = -i."sortOrder" - 1, "updatedAt" = now()
        FROM "Venue" v
        JOIN "Business" b ON b."id" = v."businessId"
        WHERE v."id" = i."venueId"
          AND i."venueId" = ${venueId}
          AND i."deletedAt" IS NULL
          AND v."deletedAt" IS NULL
          AND b."partnerProfileId" = ${partnerProfileId}
          AND b."deletedAt" IS NULL
      `;

      // 대피시킨 행 수와 클라이언트가 보낸 순서의 길이가 다르면, 목록을 받은 뒤에
      // 이미지가 늘거나 줄었다는 뜻이다. 그대로 진행하면 대피만 되고 자리를 못 찾은 행이 남는다.
      assertAffected(dodged, dto.imageIds.length, 'VENUE_IMAGE_SET_CHANGED');

      const values = Prisma.join(
        dto.imageIds.map((id, index) => Prisma.sql`(${id}::text, ${index + 1}::int)`),
      );

      const placed = await mapUniqueViolation(
        () => tx.$executeRaw`
          UPDATE "VenueImage" i
          SET "sortOrder" = o.ord, "updatedAt" = now()
          FROM (VALUES ${values}) AS o(id, ord)
          WHERE i."id" = o.id
            AND i."venueId" = ${venueId}
            AND i."deletedAt" IS NULL
        `,
      );
      assertAffected(placed, dto.imageIds.length, 'VENUE_IMAGE_NOT_FOUND');
    });

    return this.list(user, venueId);
  }

  /**
   * 소프트 삭제.
   *
   * `deletedAt` 이 채워지면 그 행은 `venue_image_order_live_uq` 에서 빠지므로 자리가
   * 자동으로 반납된다 — sortOrder 를 손댈 필요가 없다.
   *
   * UPDATE ... RETURNING 하나로 (a) 소유권 검사 (b) 지울 blob URL (c) 대표였는지 여부를
   * 한꺼번에 얻는다. 셋을 따로 SELECT 하면 그 사이에 대표가 바뀔 수 있다.
   */
  async remove(user: AuthenticatedUser, venueId: string, imageId: string) {
    const partnerProfileId = requirePartnerProfileId(user);

    const blobUrl = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ blobUrl: string; wasCover: boolean }[]>`
        UPDATE "VenueImage" i
        SET "deletedAt" = now(),
            "status" = 'DELETING'::"VenueImageStatus",
            "isCover" = false,
            "updatedAt" = now()
        FROM "Venue" v
        JOIN "Business" b ON b."id" = v."businessId"
        WHERE v."id" = i."venueId"
          AND i."id" = ${imageId}
          AND i."venueId" = ${venueId}
          AND i."deletedAt" IS NULL
          AND v."deletedAt" IS NULL
          AND b."partnerProfileId" = ${partnerProfileId}
          AND b."deletedAt" IS NULL
        -- coverImageId 가 NULL 이면 등호 비교는 false 가 아니라 NULL 을 준다.
        -- TS 쪽에서 그게 곧 "대표였는지 모른다"가 되므로 여기서 boolean 으로 눌러 보낸다.
        RETURNING i."blobUrl", (v."coverImageId" IS NOT DISTINCT FROM i."id") AS "wasCover"
      `;

      const deleted = rows[0];
      if (!deleted) throw new NotFoundException('이미지를 찾을 수 없습니다.');

      if (deleted.wasCover) {
        await tx.venue.updateMany({
          where: { id: venueId, coverImageId: imageId },
          data: { coverImageId: null } satisfies Prisma.VenueUncheckedUpdateManyInput,
        });
        await this.promoteNextCover(tx, venueId);
      }

      await this.syncImageCount(tx, venueId);

      return deleted.blobUrl;
    });

    // blob 삭제는 커밋 이후다. 트랜잭션 안에서 지우면 롤백돼도 파일은 이미 사라져 있다.
    if (blobUrl) await this.blob.deleteQuietly(blobUrl);
  }

  // --- 내부 ---

  /**
   * 대표가 비면 남은 이미지 중 첫 장을 올린다.
   * 대표 없는 시설은 심사에 올릴 수 없으므로, 이미지를 지웠다는 이유로 시설이 조용히
   * 제출 불가 상태가 되면 파트너는 원인을 찾지 못한다.
   */
  private async promoteNextCover(tx: Tx, venueId: string): Promise<void> {
    const next = await tx.venueImage.findFirst({
      where: { venueId, deletedAt: null, status: VenueImageStatus.READY },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });

    if (!next) return;

    const linked = await tx.venue.updateMany({
      where: { id: venueId, coverImageId: null },
      data: { coverImageId: next.id } satisfies Prisma.VenueUncheckedUpdateManyInput,
    });

    if (linked.count === 1) {
      await tx.venueImage.updateMany({ where: { id: next.id }, data: { isCover: true } });
    }
  }

  /**
   * `Venue.imageCount` 를 실측으로 다시 쓴다.
   *
   * `increment`/`decrement` 로 굴리지 않는 이유: 등록·삭제·격리·시설 삭제 네 경로가 모두
   * 이 값을 건드리는데, 한 경로에서 한 번만 어긋나도 오차가 영구히 누적된다.
   * 이 값은 "심사에 올릴 수 있는가"의 판정에 쓰이므로 어긋나면 제출이 막힌다.
   * READY 만 세는 것도 같은 이유다 — 격리된 장수로 심사 요건을 채울 수는 없다.
   */
  private async syncImageCount(tx: Tx, venueId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Venue" v
      SET "imageCount" = (
            SELECT count(*) FROM "VenueImage" i
            WHERE i."venueId" = v."id" AND i."deletedAt" IS NULL AND i."status" = 'READY'
          ),
          "updatedAt" = now()
      WHERE v."id" = ${venueId}
    `;
  }

  /**
   * 티켓만 받고 사라진 예약 행을 걷어낸다(지연 만료).
   * 정리라도 남의 시설 행은 건드리지 않는다 — 소유 술어를 조인으로 함께 건다.
   */
  private async purgeStalePending(
    client: Tx,
    venueId: string,
    partnerProfileId: string,
  ): Promise<void> {
    await client.$executeRaw`
      UPDATE "VenueImage" i
      SET "deletedAt" = now(), "status" = 'DELETING'::"VenueImageStatus", "updatedAt" = now()
      FROM "Venue" v
      JOIN "Business" b ON b."id" = v."businessId"
      WHERE v."id" = i."venueId"
        AND i."venueId" = ${venueId}
        AND i."deletedAt" IS NULL
        AND i."status" = 'PENDING'
        AND i."createdAt" < now() - make_interval(mins => ${STALE_PENDING_MINUTES}::int)
        AND b."partnerProfileId" = ${partnerProfileId}
        AND b."deletedAt" IS NULL
    `;
  }

  private async getOwnedImageOrThrow(
    user: AuthenticatedUser,
    venueId: string,
    imageId: string,
  ) {
    const partnerProfileId = requirePartnerProfileId(user);

    const image = await this.prisma.venueImage.findFirst({
      where: {
        id: imageId,
        venueId,
        deletedAt: null,
        venue: { deletedAt: null, business: { partnerProfileId, deletedAt: null } },
      },
      select: IMAGE_SELECT,
    });

    if (!image) throw new NotFoundException('이미지를 찾을 수 없습니다.');

    return image;
  }

  /**
   * 업로드 이미지 사전 검수.
   *
   * NOTE(seam): 외부 검수(선정성·저작권 모델 호출)는 아직 붙이지 않았다. 붙일 자리는 여기 하나이고,
   * 사유 문자열을 돌려주면 호출부가 QUARANTINED 전이 + 파트너 알림 + 감사까지 이미 전부 수행한다.
   * 즉 상태기계는 완성되어 있고 판정만 비어 있다.
   *
   * 지금 실제로 거르는 것: **선언한 해상도와 실제 용량이 앞뒤가 안 맞는 파일**.
   * 해상도는 클라이언트가 보낸 값이고 용량은 저장소가 말한 값이라, 둘의 비율이 물리적으로
   * 불가능한 수준이면 둘 중 하나가 거짓이다(메타 조작 또는 압축폭탄).
   * 거부(400)가 아니라 격리인 이유: 정상 파일을 오탐할 수 있는 휴리스틱이므로
   * 파트너의 업로드를 날리지 않고 사람이 볼 수 있는 상태로 남긴다.
   */
  private async screenUploadedImage(input: {
    byteSize: number;
    width: number;
    height: number;
  }): Promise<string | null> {
    if (input.byteSize === 0) return '빈 파일';

    const pixels = input.width * input.height;
    const bytesPerPixel = input.byteSize / pixels;

    // 실사진은 avif/webp 최고압축에서도 픽셀당 0.05바이트 아래로 잘 내려가지 않는다.
    if (pixels > 1_000_000 && bytesPerPixel < 0.02) {
      return '선언한 해상도와 파일 크기가 맞지 않습니다';
    }

    return Promise.resolve(null);
  }
}
