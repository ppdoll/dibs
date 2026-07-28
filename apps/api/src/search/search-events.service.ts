import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { toCursorPage, type CursorPage } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicEventCardDto } from './dto/public-event.dto';
import type { EventSort, SearchEventsQueryDto } from './dto/search-events.query.dto';
import { normalizeKeyword } from './internal/keyword';
import { assertPublicPayload, EVENT_CARD_SELECT, toPublicEventCard } from './public-event.mapper';
import { publicEventWhere, publicVenueWhereSql } from './public-visibility';

/**
 * 유사도 후보로 끌어올 수 있는 이벤트 수의 상한.
 *
 * fuzzy 는 "정렬"이 아니라 "무엇이 걸리는가"만 넓히므로(아래 keywordBranches 주석 참고),
 * 후보 집합이 커도 최종 정렬·페이지네이션은 그대로다. 다만 IN 목록이 무한정 길어지면
 * 플래너가 인덱스를 버리고 seq scan 으로 떨어지므로 여기서 자른다.
 * 재현율이 조금 깎이는 대신 응답 시간의 상한이 생긴다 — 검색에서는 그 교환이 맞다.
 */
const FUZZY_CANDIDATE_LIMIT = 500;

@Injectable()
export class SearchEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 공개 이벤트 검색. (GET /search/events)
   *
   * 노출 범위는 `publicEventWhere()` 하나가 정한다(IC-51). 이 메서드가 만드는 조건은 전부
   * **좁히기만** 하는 조건이고, 넓히는 조건은 타입 수준에서 넘길 수 없다 —
   * `PublicEventNarrow` 가 status/deletedAt/suspendedAt/venue 를 Omit 하기 때문이다.
   *
   * 응답에 실리는 것은 `toPublicEventCard()` 의 출력뿐이다. 기간 중 공개되는 경쟁 정보는
   * 경쟁률 하나이고(D-07), 그 값도 Event 의 비정규화 카운터에서 온다 — 목록에서 COUNT(*) 를 돌리지 않는다(IC-53).
   */
  async search(query: SearchEventsQueryDto): Promise<CursorPage<PublicEventCardDto>> {
    const keyword = normalizeKeyword(query.keyword);

    if (
      query.amountFrom !== undefined &&
      query.amountTo !== undefined &&
      query.amountFrom > query.amountTo
    ) {
      throw new BadRequestException('예산 하한이 상한보다 큽니다.');
    }

    // 조건을 배열에 모아 마지막에 한 번만 넘긴다. narrow 에 AND 를 두 번 쓰면
    // 뒤에 쓴 쪽이 앞을 조용히 덮어써서 필터 하나가 사라진다.
    const and: Prisma.EventWhereInput[] = [];

    if (keyword) {
      and.push({ OR: await this.keywordBranches(keyword, query.fuzzy === true) });
    }

    // 이벤트가 정한 금액 "규칙"으로 거른다. 남이 써낸 금액과는 무관하다(D-07).
    // INSTANT 는 fixedAmount 만, BID 는 min/max 만 채워져 있으므로 각 OR 는 실제로는 한쪽 가지만 매치한다
    // (반대쪽은 NULL 비교라 항상 거짓). 모드로 분기하지 않아도 같은 결과가 나온다.
    if (query.amountFrom !== undefined) {
      const from = query.amountFrom;
      and.push({ OR: [{ fixedAmount: { gte: from } }, { maxAmount: { gte: from } }] });
    }
    if (query.amountTo !== undefined) {
      const to = query.amountTo;
      and.push({ OR: [{ fixedAmount: { lte: to } }, { minAmount: { lte: to } }] });
    }

    if (query.deadlineWithinHours !== undefined) {
      // 여기만은 DB now() 가 아니라 서버 시계를 쓴다. IC-0 전제 3(시간의 원천은 now() 하나)은
      // **순위에 영향을 주는 컬럼**에 대한 규칙이고, 이건 표시용 필터의 경계다.
      // 인스턴스 간 초 단위 오차는 "48시간 내 마감" 목록의 가장자리 한 건을 흔들 뿐이라
      // 매 검색마다 SELECT now() 왕복을 추가할 이유가 없다.
      const now = new Date();
      const until = new Date(now.getTime() + query.deadlineWithinHours * 3_600_000);
      and.push({ applyEndAt: { gte: now, lte: until } });
    }

    const rows = await this.prisma.event.findMany({
      where: publicEventWhere({
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        // IC-52: Event.sigunguCode 는 venue.region.sigunguCode 의 사본이라 조인 없이 직접 비교한다.
        ...(query.sigunguCode ? { sigunguCode: query.sigunguCode } : {}),
        ...(query.status ? { statusIn: [query.status] } : {}),
        ...(and.length > 0 ? { AND: and } : {}),
      }),
      orderBy: orderByFor(query.sort),
      take: query.limit + 1,
      // Prisma 의 id 커서는 orderBy 전체를 기준으로 키셋 비교를 만든다.
      // 정렬 키를 전부 NOT NULL 컬럼으로 고른 이유가 이것이다 — NULL 이 섞이면 그 비교가 모호해진다.
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: EVENT_CARD_SELECT,
    });

    // 자르기 전에 공개 형태로 바꾼다. 페이지네이션 헬퍼가 만지는 객체에도 원본 컬럼이 남지 않게 하려는 것.
    const page = toCursorPage(rows.map(toPublicEventCard), query.limit);

    assertPublicPayload(page.items, 'GET /search/events');
    return page;
  }

  /**
   * 검색어가 걸리는 지점들. 이 배열은 OR 로 묶인다.
   *
   * fuzzy 를 **정렬이 아니라 매칭 확장**으로 둔 이유:
   * 유사도순으로 정렬해 버리면 사용자가 고른 정렬(마감임박 등)이 검색어 유무에 따라 뒤집힌다.
   * 그리고 유사도는 컬럼이 아니라 매 요청 계산값이라 키셋 커서를 만들 수 없어서
   * 같은 엔드포인트 안에 페이지네이션 방식이 둘이 되어 버린다.
   * 그래서 fuzzy 는 "오타를 흡수해 후보를 늘리는" 역할만 하고, 순서는 항상 sort 가 정한다.
   */
  private async keywordBranches(keyword: string, fuzzy: boolean): Promise<Prisma.EventWhereInput[]> {
    const branches: Prisma.EventWhereInput[] = [
      // 인덱스 없음. Event.title 에는 trgm 인덱스가 없어서 이 가지는 부분 스캔이다.
      // status/venue 가드가 먼저 좁혀 준 뒤에 걸리는 조건이라 감수한다.
      { title: { contains: keyword, mode: 'insensitive' } },
      // event_tags_gin (GIN on tags). 부분일치가 아니라 태그 완전일치다.
      { tags: { has: keyword } },
      // 시설명은 Venue.name 부분일치. 여기서 venue 를 중첩으로 쓰는 것은 안전하다 —
      // 가드의 최상위 `venue` 조건은 publicEventWhere() 가 따로 걸고, 이건 AND 로 더해질 뿐이다.
      { venue: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
    ];

    if (!fuzzy) return branches;

    const candidateIds = await this.fuzzyVenueCandidates(keyword);
    if (candidateIds.length > 0) branches.push({ id: { in: candidateIds } });

    return branches;
  }

  /**
   * pg_trgm 유사도로 "이 시설에서 열리는 이벤트" 후보 id 를 긁어온다.
   *
   * 사용하는 인덱스: `venue_search_text_trgm` (GIN, gin_trgm_ops on Venue.searchText).
   * `%` 연산자(pg_trgm.similarity_threshold, 기본 0.3)라 그 인덱스를 그대로 탄다.
   * Venue.searchText 는 파트너 모듈이 시설명·지역·업종명을 합쳐 채워 둔 컬럼이다.
   *
   * 여기서 **공개 이벤트 술어를 걸지 않는 것은 의도적**이다. 이 쿼리는 노출 여부를 결정하지 않고
   * 후보만 만든다 — 반환된 id 는 publicEventWhere() 안쪽의 OR 가지로만 들어가므로
   * 정지·삭제·DRAFT 이벤트는 그 뒤에서 걸러진다. 노출 판단이 raw SQL 로 새어나가지 않아야 IC-51 이 유지된다.
   * 다만 죽은 시설의 이벤트까지 후보 상한을 잡아먹는 건 낭비라, 시설 쪽 술어는
   * 같은 파일에 있는 publicVenueWhereSql() 을 재사용해 걸어 둔다.
   */
  private async fuzzyVenueCandidates(keyword: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT e."id"
      FROM "Event" e
      JOIN "Venue" v ON v."id" = e."venueId"
      WHERE ${publicVenueWhereSql()}
        AND v."searchText" % ${keyword}::text
      ORDER BY similarity(v."searchText", ${keyword}::text) DESC
      LIMIT ${FUZZY_CANDIDATE_LIMIT}
    `;

    return rows.map((row) => row.id);
  }
}

/**
 * 정렬 키는 넷 다 NOT NULL 컬럼이고, 마지막은 항상 id 다.
 * id 를 붙이지 않으면 동점 행의 순서가 실행마다 달라져 커서 페이지에 중복·누락이 생긴다.
 *
 * 인기/경쟁률의 소스는 Event 의 비정규화 캐시다(IC-53). 목록에서 신청 수를 세지 않는다.
 */
function orderByFor(sort: EventSort): Prisma.EventOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      // 등록 시각순. openedAt 이 아닌 이유: 아직 안 열린 SCHEDULED 는 openedAt 이 NULL 이라
      // 정렬에서 NULL 처리가 필요해지고, 그러면 커서 키셋 비교가 모호해진다.
      // 전용 인덱스는 없다 — 상태·지역 필터가 먼저 좁힌 뒤의 정렬이다.
      return [{ createdAt: 'desc' }, { id: 'desc' }];

    case 'popular':
      // 신청자 절대수. 전용 인덱스 없음(event_status_ratio_idx 는 비율 컬럼이다).
      return [{ liveApplicantCount: 'desc' }, { id: 'desc' }];

    case 'competition-ratio':
      // event_status_ratio_idx (status, competitionRatioX10 DESC).
      return [{ competitionRatioX10: 'desc' }, { id: 'desc' }];

    case 'ending-soon':
    default:
      // event_status_apply_end_idx (status, applyEndAt).
      return [{ applyEndAt: 'asc' }, { id: 'asc' }];
  }
}
