import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { assertAffected } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  CreateEventImageTicketDto,
  RegisterEventImageDto,
  ReorderEventImagesDto,
  UpdateEventImageDto,
} from './dto/event-image.dto';
import { EventBlobService } from './internal/event-blob.service';
import { newImageId, requirePartnerProfileId } from './internal/event-context';
import type { Tx } from './internal/event-audit.service';
import { EDITABLE_EVENT_STATUSES } from './internal/event-policy';
import { EVENT_IMAGE_SELECT } from './internal/event-select';

@Injectable()
export class EventImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: EventBlobService,
  ) {}

  /**
   * 1단계 — 업로드 티켓.
   *
   * imageId 를 서버가 먼저 정해서 경로에 박는다. 그래야 DB 행 1개와 blob 1개가 1:1 로 묶이고,
   * 등록되지 않은 blob(= 업로드는 됐는데 register 를 안 부른 것)을 고아 스위퍼가 식별할 수 있다.
   */
  async createUploadTicket(
    user: AuthenticatedUser,
    eventId: string,
    dto: CreateEventImageTicketDto,
  ) {
    await this.loadEditableEvent(user, eventId);

    const imageId = newImageId();

    return this.blob.createUploadTicket({
      imageId,
      pathname: this.blob.imagePathname(eventId, imageId, dto.contentType),
    });
  }

  /**
   * 2단계 — 등록.
   *
   * byteSize·mimeType 은 head() 로 읽은 **실제 blob 값**을 쓴다. 클라이언트가 보낸 값을 믿으면
   * 업로드 토큰에 건 용량·타입 상한이 장식이 된다.
   */
  async register(user: AuthenticatedUser, eventId: string, dto: RegisterEventImageDto) {
    await this.loadEditableEvent(user, eventId);

    // 외부 API 호출은 트랜잭션 **밖**에서 한다. 안에서 부르면 blob 응답을 기다리는 동안
    // 행 락을 들고 있게 되고, Vercel 함수 타임아웃이 트랜잭션 타임아웃보다 먼저 온다.
    const meta = await this.blob.verifyUploaded(dto.blobUrl, eventId, dto.imageId);

    return this.prisma.$transaction(async (tx) => {
      const clearedCovers = dto.isCover ? await this.clearCover(tx, eventId) : 0;

      // sortOrder 는 (eventId, sortOrder) 부분 유니크 아래에 있다. max+1 을 읽고 쓰는 사이에
      // 다른 요청이 같은 값을 잡으면 유니크 위반(P2002 → 409)이 난다 — 그게 맞는 결과다.
      // 여기서 재시도 루프를 돌리면 파트너가 두 번 누른 요청이 조용히 둘 다 성공한다.
      const last = await tx.eventImage.aggregate({
        where: { eventId, deletedAt: null },
        _max: { sortOrder: true },
      });

      const image = await tx.eventImage.create({
        data: {
          id: dto.imageId,
          eventId,
          blobUrl: dto.blobUrl,
          pathname: meta.pathname,
          width: dto.width,
          height: dto.height,
          byteSize: meta.size,
          mimeType: meta.contentType,
          blurDataUrl: dto.blurDataUrl ?? null,
          altText: dto.altText ?? null,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          isCover: dto.isCover ?? false,
        },
        select: EVENT_IMAGE_SELECT,
      });

      return { image, previousCoverCleared: clearedCovers };
    });
  }

  async list(user: AuthenticatedUser, eventId: string) {
    const partnerId = requirePartnerProfileId(user);

    return this.prisma.eventImage.findMany({
      where: { eventId, deletedAt: null, event: { partnerId, deletedAt: null } },
      orderBy: { sortOrder: 'asc' },
      select: EVENT_IMAGE_SELECT,
    });
  }

  async updateMeta(
    user: AuthenticatedUser,
    eventId: string,
    imageId: string,
    dto: UpdateEventImageDto,
  ) {
    const partnerId = requirePartnerProfileId(user);

    const { count } = await this.prisma.eventImage.updateMany({
      where: { id: imageId, eventId, deletedAt: null, event: { partnerId, deletedAt: null } },
      data: { altText: dto.altText ?? null },
    });

    assertAffected(count, 1, 'EVENT_IMAGE_NOT_FOUND');

    return this.prisma.eventImage.findUniqueOrThrow({
      where: { id: imageId },
      select: EVENT_IMAGE_SELECT,
    });
  }

  /** 대표 이미지 지정. 기존 대표는 같은 트랜잭션에서 해제된다. */
  async setCover(user: AuthenticatedUser, eventId: string, imageId: string) {
    await this.loadEditableEvent(user, eventId);

    return this.prisma.$transaction(async (tx) => {
      const clearedCovers = await this.clearCover(tx, eventId);

      const { count } = await tx.eventImage.updateMany({
        where: { id: imageId, eventId, deletedAt: null },
        data: { isCover: true },
      });

      assertAffected(count, 1, 'EVENT_IMAGE_NOT_FOUND');

      return { imageId, previousCoverCleared: clearedCovers };
    });
  }

  /**
   * 순서 재배치 — 2단계 쓰기. (001_constraints.sql §10)
   *
   * `event_image_order_live_uq` 는 **부분 유니크**라 DEFERRABLE 이 될 수 없다
   * (Postgres 에서 부분 유니크는 제약이 아니라 인덱스이고, 인덱스는 지연될 수 없다).
   * 그래서 순열 교체 중간 상태가 반드시 충돌한다. 먼저 전부 음수 영역
   * `-(sortOrder + 1)` 로 대피시킨 뒤 최종 값을 쓰면 같은 트랜잭션 안에서 충돌 없이 끝난다.
   * `+1` 이 붙는 이유: sortOrder=0 을 그냥 부호 반전하면 0 이라 자기 자신과 충돌한다.
   */
  async reorder(user: AuthenticatedUser, eventId: string, dto: ReorderEventImagesDto) {
    await this.loadEditableEvent(user, eventId);

    return this.prisma.$transaction(async (tx) => {
      const live = await tx.eventImage.findMany({
        where: { eventId, deletedAt: null },
        select: { id: true },
      });

      // 부분 재배치를 받지 않는다. 일부만 옮기면 남은 행들의 최종 위치가 정의되지 않고,
      // 그 상태로 음수 대피를 돌리면 어떤 행은 대피하고 어떤 행은 안 하게 된다.
      const liveIds = new Set(live.map((row) => row.id));
      if (live.length !== dto.imageIds.length || !dto.imageIds.every((id) => liveIds.has(id))) {
        throw new BadRequestException({
          code: 'EVENT_IMAGE_ORDER_INCOMPLETE',
          message: `현재 등록된 이미지 ${live.length}장 전체를 원하는 순서로 보내 주세요.`,
        });
      }

      const parked = await tx.$executeRaw`
        UPDATE "EventImage"
        SET "sortOrder" = -("sortOrder" + 1)
        WHERE "eventId" = ${eventId} AND "deletedAt" IS NULL AND "sortOrder" >= 0
      `;

      assertAffected(parked, live.length, 'EVENT_IMAGE_ORDER_PARK_FAILED');

      for (const [index, imageId] of dto.imageIds.entries()) {
        const { count } = await tx.eventImage.updateMany({
          where: { id: imageId, eventId, deletedAt: null },
          data: { sortOrder: index },
        });

        assertAffected(count, 1, 'EVENT_IMAGE_ORDER_APPLY_FAILED');
      }

      return tx.eventImage.findMany({
        where: { eventId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: EVENT_IMAGE_SELECT,
      });
    });
  }

  /**
   * 삭제. 행은 소프트 삭제하고 blob 은 **커밋 이후에** 지운다.
   *
   * 순서를 뒤집으면(= 트랜잭션 안에서 blob 삭제) 롤백돼도 파일은 이미 사라져서
   * DB 에는 살아 있는데 이미지가 깨진 행이 남는다. 반대로 blob 삭제가 실패하면
   * 고아 blob 하나가 남을 뿐이고 스위퍼가 다시 집어간다 — 이쪽 실패가 훨씬 싸다.
   */
  async remove(user: AuthenticatedUser, eventId: string, imageId: string) {
    await this.loadEditableEvent(user, eventId);

    const removed = await this.prisma.$transaction(async (tx) => {
      const image = await tx.eventImage.findFirst({
        where: { id: imageId, eventId, deletedAt: null },
        select: { id: true, blobUrl: true, isCover: true },
      });

      if (!image) throw new NotFoundException('이미지를 찾을 수 없습니다.');

      const { count } = await tx.eventImage.updateMany({
        where: { id: imageId, eventId, deletedAt: null },
        data: { deletedAt: new Date(), isCover: false },
      });

      assertAffected(count, 1, 'EVENT_IMAGE_ALREADY_REMOVED');

      // 대표 이미지를 지웠으면 남은 것 중 첫 장을 승계시킨다.
      // 비워두면 목록·검색이 대표 없는 이벤트를 만나 자리 표시자를 그리게 된다.
      let promoted: string | null = null;
      if (image.isCover) {
        const next = await tx.eventImage.findFirst({
          where: { eventId, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        });

        if (next) {
          const promotion = await tx.eventImage.updateMany({
            where: { id: next.id, eventId, deletedAt: null },
            data: { isCover: true },
          });

          assertAffected(promotion.count, 1, 'EVENT_IMAGE_COVER_PROMOTION_FAILED');
          promoted = next.id;
        }
      }

      return { blobUrl: image.blobUrl, promotedCoverId: promoted };
    });

    await this.blob.deleteQuietly(removed.blobUrl);

    return { imageId, deleted: true, promotedCoverId: removed.promotedCoverId };
  }

  /**
   * 기존 대표를 해제하고 몇 장을 해제했는지 돌려준다.
   * 0행은 오류가 아니다 — 아직 대표가 없는 이벤트가 정상적인 첫 상태이므로
   * assertAffected 를 걸지 않고 개수를 호출부로 올려 응답에 싣는다(IC-01 이 금지하는 것은
   * count 를 **버리는 것**이지, 0을 허용하는 것이 아니다).
   */
  private async clearCover(tx: Tx, eventId: string): Promise<number> {
    const { count } = await tx.eventImage.updateMany({
      where: { eventId, isCover: true, deletedAt: null },
      data: { isCover: false },
    });

    return count;
  }

  /**
   * 소유 + 편집 가능 상태 확인.
   *
   * 이미지는 정책이 아니라 콘텐츠라서 진행 중에도 고칠 수 있다(금액 규칙과 다르다).
   * 다만 정지·취소·확정된 이벤트는 손대지 않는다 — 정지된 이벤트의 이미지를 바꿀 수 있으면
   * 운영자 정지가 "노출만 막는" 반쪽짜리가 된다.
   */
  private async loadEditableEvent(user: AuthenticatedUser, eventId: string) {
    const partnerId = requirePartnerProfileId(user);

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, partnerId, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    if (!EDITABLE_EVENT_STATUSES.includes(event.status)) {
      throw new ConflictException({
        code: 'EVENT_IMAGES_LOCKED',
        message:
          event.status === EventStatus.SUSPENDED
            ? '정지된 이벤트의 이미지는 수정할 수 없습니다.'
            : '확정되었거나 취소된 이벤트의 이미지는 수정할 수 없습니다.',
      });
    }

    return event;
  }
}
