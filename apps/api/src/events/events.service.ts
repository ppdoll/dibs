import { Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { DEFAULT_DEPOSIT_WINDOW_MINUTES, type PublicEventSummary } from '@dibs/shared';

import { PrismaService } from '../prisma/prisma.service';
import { toCursorPage, type CursorPage } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateEventDto } from './dto/create-event.dto';
import { PartnerEventListQueryDto, PublicEventListQueryDto } from './dto/event-query.dto';
import { buildEventSlug, requirePartnerProfileId } from './internal/event-context';
import {
  computeRankingLockAt,
  toServiceDateKst,
  validateEventPolicy,
  type EventPolicyInput,
} from './internal/event-policy';
import { EVENT_IMAGE_SELECT, PARTNER_EVENT_SELECT } from './internal/event-select';
import {
  PUBLIC_EVENT_SELECT,
  PUBLIC_EVENT_WHERE,
  toPublicEvent,
} from './internal/event-visibility';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 이벤트를 만든다. 언제나 DRAFT 다.
   *
   * 생성과 공개를 분리하는 이유: 공개된 이벤트는 금액 규칙이 잠기고(IC-64) 예약금 윈도우를
   * 줄일 수 없게 된다(IC-26). 그 잠금이 초안 작성 중에 걸리면 파트너가 오타 하나를 못 고친다.
   */
  async create(user: AuthenticatedUser, dto: CreateEventDto) {
    const partnerProfileId = requirePartnerProfileId(user);
    const policy = toPolicyInput(dto);

    validateEventPolicy(policy, new Date());

    return this.prisma.$transaction(async (tx) => {
      // 시설 소유권은 WHERE 절로 본다. 그리고 여기서 읽은 region 이 sigunguCode 의 **유일한** 출처다(IC-52) —
      // Region.code(법정동 10자리)와 Event.sigunguCode(행정표준 5자리)는 값 공간이 달라서
      // 클라이언트 입력이나 code 복사로는 채울 수 없다. 잘못 채우면 검색이 조용히 0건이 된다.
      const venue = await tx.venue.findFirst({
        where: { id: dto.venueId, deletedAt: null, business: { partnerProfileId, deletedAt: null } },
        select: { id: true, region: { select: { id: true, sigunguCode: true } } },
      });

      if (!venue) {
        throw new NotFoundException('시설을 찾을 수 없거나 이 시설에 이벤트를 열 권한이 없습니다.');
      }

      return tx.event.create({
        data: {
          venueId: venue.id,
          partnerId: partnerProfileId,
          categoryId: dto.categoryId ?? null,
          regionId: venue.region?.id ?? null,
          sigunguCode: venue.region?.sigunguCode ?? null,

          title: dto.title,
          slug: buildEventSlug(dto.title, dto.slug),
          description: dto.description,
          tags: dto.tags ?? [],

          mode: policy.mode,
          status: EventStatus.DRAFT,
          capacity: policy.capacity,

          fixedAmount: policy.fixedAmount,
          minAmount: policy.minAmount,
          maxAmount: policy.maxAmount,
          amountStep: policy.amountStep,

          applyStartAt: policy.applyStartAt,
          applyEndAt: policy.applyEndAt,
          // DRAFT 에는 CHECK 가 rankingLockAt 을 요구하지 않지만 미리 채워 둔다.
          // publish 가 다시 계산하므로 값이 어긋날 일은 없고, 비어 있는 채로 어떤 경로가
          // OPEN 으로 밀면 event_ranking_lock_required_chk 로 죽는다.
          rankingLockAt: computeRankingLockAt(policy),
          serviceStartAt: policy.serviceStartAt,
          serviceEndAt: policy.serviceEndAt,
          serviceDateKst: toServiceDateKst(policy.serviceStartAt),

          depositRequired: policy.depositRequired,
          depositType: policy.depositType,
          depositFixedAmount: policy.depositFixedAmount,
          depositPercentBp: policy.depositPercentBp,
          depositRoundingUnit: policy.depositRoundingUnit,
          depositMinAmount: policy.depositMinAmount,
          depositMaxAmount: policy.depositMaxAmount,
          depositWindowMinutes: policy.depositWindowMinutes,
          depositRefundNote: dto.depositRefundNote ?? null,

          softCloseEnabled: policy.softCloseEnabled,
          softCloseWindowMinutes: policy.softCloseWindowMinutes,
          softCloseExtendMinutes: policy.softCloseExtendMinutes,
          softCloseMaxExtensions: policy.softCloseMaxExtensions,
          softCloseMaxExtensionsPerUser: policy.softCloseMaxExtensionsPerUser,
          softCloseHardEndAt: policy.softCloseHardEndAt,

          showCompetitionRatio: dto.showCompetitionRatio ?? true,
          ratioMinApplicantsToShow: dto.ratioMinApplicantsToShow ?? 0,
          ...(dto.cutoffVisibility ? { cutoffVisibility: dto.cutoffVisibility } : {}),
          ...(dto.rankVisibility ? { rankVisibility: dto.rankVisibility } : {}),
          ...(dto.amountDistributionVisibility
            ? { amountDistributionVisibility: dto.amountDistributionVisibility }
            : {}),
        },
        select: PARTNER_EVENT_SELECT,
      });
    });
  }

  /** 파트너의 내 이벤트 목록. partnerId 술어가 곧 권한 검사다. */
  async listMine(user: AuthenticatedUser, query: PartnerEventListQueryDto) {
    const partnerId = requirePartnerProfileId(user);

    const rows = await this.prisma.event.findMany({
      where: {
        partnerId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.venueId ? { venueId: query.venueId } : {}),
      },
      // event_partner_list_idx (partnerId, status, createdAt DESC) 를 그대로 탄다.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: PARTNER_EVENT_SELECT,
    });

    return toCursorPage(rows, query.limit);
  }

  /** 파트너의 내 이벤트 상세. 이미지까지 함께 준다(편집 화면이 한 번에 필요로 한다). */
  async getMine(user: AuthenticatedUser, eventId: string) {
    const partnerId = requirePartnerProfileId(user);

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, partnerId, deletedAt: null },
      select: {
        ...PARTNER_EVENT_SELECT,
        images: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: EVENT_IMAGE_SELECT,
        },
      },
    });

    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    return event;
  }

  /**
   * 공개 상세. id 또는 slug 로 찾는다.
   *
   * 돌려주는 것은 toPublicEventSummary() 의 출력뿐이다 — 설명·이미지·시설 정보를 여기 얹고 싶은
   * 유혹이 계속 생기는데, 한 번 얹으면 그 다음은 "신청자 수만", 그 다음은 "커트라인만"이 된다.
   * 상세 콘텐츠는 별도 경로가 가져가고 이 응답의 키 집합은 고정이다(IC-05 계약 테스트 대상).
   */
  async getPublic(key: string): Promise<PublicEventSummary> {
    const row = await this.prisma.event.findFirst({
      where: { ...PUBLIC_EVENT_WHERE, OR: [{ id: key }, { slug: key }] },
      select: PUBLIC_EVENT_SELECT,
    });

    if (!row) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    return toPublicEvent(row);
  }

  /** 공개 목록. 마감이 임박한 순. 진짜 탐색·검색은 검색 모듈이 가져간다. */
  async listPublic(query: PublicEventListQueryDto): Promise<CursorPage<PublicEventSummary>> {
    const rows = await this.prisma.event.findMany({
      where: {
        ...PUBLIC_EVENT_WHERE,
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.sigunguCode ? { sigunguCode: query.sigunguCode } : {}),
      },
      orderBy: [{ applyEndAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: PUBLIC_EVENT_SELECT,
    });

    // 먼저 공개 형태로 바꾼 뒤 자르는 이유: 페이지네이션 헬퍼가 만지는 객체에도
    // 금액 원본이 남아 있지 않아야 한다. nextCursor 는 id 라서 변환 후에도 유효하다.
    return toCursorPage(rows.map(toPublicEvent), query.limit);
  }
}

/** DTO 의 기본값을 한 곳에서 채운다. 검증과 저장이 **같은 값**을 보게 하려는 것이다. */
function toPolicyInput(dto: CreateEventDto): EventPolicyInput {
  return {
    mode: dto.mode,
    capacity: dto.capacity,
    fixedAmount: dto.fixedAmount ?? null,
    minAmount: dto.minAmount ?? null,
    maxAmount: dto.maxAmount ?? null,
    amountStep: dto.amountStep ?? 1,
    applyStartAt: dto.applyStartAt,
    applyEndAt: dto.applyEndAt,
    serviceStartAt: dto.serviceStartAt ?? null,
    serviceEndAt: dto.serviceEndAt ?? null,
    depositRequired: dto.depositRequired ?? false,
    depositType: dto.depositType ?? null,
    depositFixedAmount: dto.depositFixedAmount ?? null,
    depositPercentBp: dto.depositPercentBp ?? null,
    depositRoundingUnit: dto.depositRoundingUnit ?? 100,
    depositMinAmount: dto.depositMinAmount ?? null,
    depositMaxAmount: dto.depositMaxAmount ?? null,
    depositWindowMinutes: dto.depositWindowMinutes ?? DEFAULT_DEPOSIT_WINDOW_MINUTES,
    softCloseEnabled: dto.softCloseEnabled ?? false,
    softCloseWindowMinutes: dto.softCloseWindowMinutes ?? null,
    softCloseExtendMinutes: dto.softCloseExtendMinutes ?? null,
    softCloseHardEndAt: dto.softCloseHardEndAt ?? null,
    softCloseMaxExtensions: dto.softCloseMaxExtensions ?? 6,
    softCloseMaxExtensionsPerUser: dto.softCloseMaxExtensionsPerUser ?? 2,
  };
}
