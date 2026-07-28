import { Injectable } from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type {
  DiscoveryCategoryChipDto,
  DiscoveryHomeDto,
  DiscoveryHomeQueryDto,
  DiscoverySectionDto,
} from './dto/discovery.dto';
import type { PublicEventCardDto } from './dto/public-event.dto';
import { DEADLINE_SOON_DEFAULT_HOURS } from './dto/search-events.query.dto';
import { assertPublicPayload, EVENT_CARD_SELECT, toPublicEventCard } from './public-event.mapper';
import { publicEventWhere, type PublicEventNarrow } from './public-visibility';

/** 캐러셀 한 줄에 담는 카드 수. 홈은 훑는 화면이라 페이지네이션 없이 이 개수로 끊는다. */
const RAIL_SIZE = 12;

/** 카테고리 섹션 하나의 카드 수. 카테고리 줄은 여러 개라 조금 짧게 잡는다. */
const CATEGORY_RAIL_SIZE = 8;

/**
 * 카테고리 섹션 개수 상한.
 *
 * 섹션 하나가 쿼리 하나라 그대로 응답 지연이 된다. 4개면 홈 한 화면을 채우고,
 * 그 아래는 어차피 카테고리 칩으로 이동하는 동선이다.
 */
const CATEGORY_SECTION_LIMIT = 4;

/** 상단 카테고리 칩 줄. 루트 업종만 보여준다. */
const CATEGORY_CHIP_LIMIT = 20;

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 홈 피드. (GET /discovery/home)
   *
   * 섹션은 전부 같은 `publicEventWhere()` 를 통과한다(IC-51). 홈만 노출 조건이 느슨해지는 일이
   * 없어야 하는데, 그런 일은 보통 "홈은 좀 다르니까"라는 이유로 술어를 한 번 복사하면서 시작된다.
   *
   * 섹션 쿼리는 서로 독립이므로 병렬로 던진다. 서버리스에서 라운드트립을 직렬로 쌓으면
   * 콜드스타트에 그대로 얹혀 홈이 가장 느린 화면이 된다.
   */
  async home(query: DiscoveryHomeQueryDto): Promise<DiscoveryHomeDto> {
    const region: PublicEventNarrow = query.sigunguCode
      ? { sigunguCode: query.sigunguCode }
      : {};

    const [categories, deadlineSoon, newlyOpened, popular, categorySections] = await Promise.all([
      this.categoryChips(),
      this.deadlineSoon(region),
      this.newlyOpened(region),
      this.popular(region),
      this.categorySections(region),
    ]);

    const sections: DiscoverySectionDto[] = [
      { key: 'DEADLINE_SOON', titleKo: '마감임박', categoryId: null, events: deadlineSoon },
      { key: 'NEWLY_OPENED', titleKo: '신규 오픈', categoryId: null, events: newlyOpened },
      { key: 'POPULAR', titleKo: '인기', categoryId: null, events: popular },
      ...categorySections,
    ];

    const home: DiscoveryHomeDto = {
      generatedAt: new Date(),
      categories,
      // 빈 섹션은 지운다. 프론트에 "비면 그리지 마라"를 맡기면 스켈레톤이 남거나
      // 빈 캐러셀이 화면을 갈라놓는다 — 어느 쪽이든 서버가 안 보내면 생기지 않는 문제다.
      sections: sections.filter((section) => section.events.length > 0),
    };

    assertPublicPayload(home, 'GET /discovery/home');
    return home;
  }

  /**
   * 마감임박. 이미 지난 마감은 제외하고 48시간 안쪽만.
   * 인덱스: event_status_apply_end_idx (status, applyEndAt).
   */
  private async deadlineSoon(region: PublicEventNarrow): Promise<PublicEventCardDto[]> {
    const now = new Date();
    const until = new Date(now.getTime() + DEADLINE_SOON_DEFAULT_HOURS * 3_600_000);

    return this.cards(
      {
        ...region,
        statusIn: [EventStatus.OPEN],
        applyEndAt: { gte: now, lte: until },
        // INSTANT 가 이미 찼으면 마감임박에 띄울 이유가 없다. BID 는 정원 초과를 허용하므로
        // soldOutAt 이 찍히지 않아 이 조건에 걸리지 않는다(D-03).
        soldOutAt: null,
      },
      [{ applyEndAt: 'asc' }, { id: 'asc' }],
      RAIL_SIZE,
    );
  }

  /**
   * 신규 오픈. 여기서는 openedAt 을 쓴다 — 검색의 newest 와 달리 status 를 OPEN 으로 고정해서
   * openedAt 이 NULL 인 행이 애초에 들어오지 않기 때문이다.
   * 인덱스: event_status_recent_idx (status, openedAt DESC).
   */
  private async newlyOpened(region: PublicEventNarrow): Promise<PublicEventCardDto[]> {
    return this.cards(
      { ...region, statusIn: [EventStatus.OPEN], openedAt: { not: null } },
      [{ openedAt: 'desc' }, { id: 'desc' }],
      RAIL_SIZE,
    );
  }

  /**
   * 인기. 경쟁률 캐시로 정렬한다(IC-53 — 여기서 신청 수를 세지 않는다).
   *
   * 신청자 절대수가 아니라 경쟁률인 이유가 둘 있다.
   * 하나, `event_status_ratio_idx` 가 그대로 덮어 준다.
   * 둘, 경쟁률은 D-07 이 이미 공개하기로 한 값이라 "왜 이게 위에 있나"를 화면에서 설명할 수 있다.
   */
  private async popular(region: PublicEventNarrow): Promise<PublicEventCardDto[]> {
    return this.cards(
      {
        ...region,
        statusIn: [EventStatus.OPEN],
        // 아무도 신청하지 않은 이벤트가 "인기"에 끼지 않도록. 비율은 0이어도 행은 존재한다.
        liveApplicantCount: { gt: 0 },
      },
      [{ competitionRatioX10: 'desc' }, { liveApplicantCount: 'desc' }, { id: 'desc' }],
      RAIL_SIZE,
    );
  }

  /**
   * 카테고리별 섹션.
   *
   * 어떤 카테고리를 보여줄지는 **열린 이벤트가 많은 순**으로 고른다.
   * Category.venueCount(시설 수)로 고르면 시설은 많은데 지금 열린 게 없는 업종이 올라와
   * 빈 섹션만 만들어진다. 특히 지역 필터가 걸리면 거의 항상 그렇게 된다.
   *
   * 이 groupBy 는 COUNT 집계지만 IC-53 과 충돌하지 않는다. IC-53 이 금지하는 것은
   * **행별 경쟁률을 목록에서 COUNT 로 세는 것**이고, 이건 섹션 목록을 고르기 위한 1회 집계다.
   * 신청 hot path 에도 없다. 인덱스: event_category_search_idx (categoryId, status, applyEndAt).
   */
  private async categorySections(region: PublicEventNarrow): Promise<DiscoverySectionDto[]> {
    const grouped = await this.prisma.event.groupBy({
      by: ['categoryId'],
      where: publicEventWhere({
        ...region,
        statusIn: [EventStatus.OPEN],
        categoryId: { not: null },
      }),
      // 정렬 키로 쓰는 집계는 반드시 여기에도 있어야 한다 — `_all` 로만 세면 orderBy 가 참조할 게 없다.
      _count: { categoryId: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: CATEGORY_SECTION_LIMIT,
    });

    const categoryIds = grouped
      .map((row) => row.categoryId)
      .filter((id): id is string => id !== null);

    if (categoryIds.length === 0) return [];

    const [categories, eventsPerCategory] = await Promise.all([
      this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, nameKo: true },
      }),
      Promise.all(
        categoryIds.map((categoryId) =>
          this.cards(
            { ...region, statusIn: [EventStatus.OPEN], categoryId },
            [{ applyEndAt: 'asc' }, { id: 'asc' }],
            CATEGORY_RAIL_SIZE,
          ),
        ),
      ),
    ]);

    const nameById = new Map(categories.map((category) => [category.id, category.nameKo]));

    return categoryIds.map((categoryId, index) => ({
      key: 'CATEGORY' as const,
      titleKo: nameById.get(categoryId) ?? '추천',
      categoryId,
      events: eventsPerCategory[index] ?? [],
    }));
  }

  /** 상단 칩. 루트 업종만 — 2단계 전부 깔면 칩 줄이 화면 절반을 먹는다. */
  private async categoryChips(): Promise<DiscoveryCategoryChipDto[]> {
    // 인덱스: category_active_idx (isActive, sortOrder).
    return this.prisma.category.findMany({
      where: { isActive: true, deletedAt: null, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { nameKo: 'asc' }],
      take: CATEGORY_CHIP_LIMIT,
      select: { id: true, code: true, nameKo: true, iconKey: true },
    });
  }

  /**
   * 섹션 하나를 읽는다. 모든 섹션이 이 한 곳을 통과하므로
   * select 화이트리스트(EVENT_CARD_SELECT)와 공개 술어를 우회할 경로가 없다.
   */
  private async cards(
    narrow: PublicEventNarrow,
    orderBy: Prisma.EventOrderByWithRelationInput[],
    take: number,
  ): Promise<PublicEventCardDto[]> {
    const rows = await this.prisma.event.findMany({
      where: publicEventWhere(narrow),
      orderBy,
      take,
      select: EVENT_CARD_SELECT,
    });

    return rows.map(toPublicEventCard);
  }
}
