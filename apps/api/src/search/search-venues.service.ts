import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { PublicVenueCardDto, PublicVenuePageDto } from './dto/public-venue.dto';
import type { SearchVenuesQueryDto, VenueSort } from './dto/search-venues.query.dto';
import { normalizeKeyword, toLikePattern } from './internal/keyword';
import { decodeOffsetCursor, encodeOffsetCursor } from './internal/offset-cursor';
import { assertPublicPayload } from './public-event.mapper';
import { publicVenueWhereSql } from './public-visibility';

/** $queryRaw 가 돌려주는 행. numeric 은 Prisma.Decimal 로 올라오므로 그대로 직렬화하면 안 된다. */
interface VenueSearchRow {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  sido: string;
  sigungu: string;
  roadAddress: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  seatCount: number | null;
  openEventCount: number;
  categoryId: string;
  categoryNameKo: string;
  categoryIconKey: string | null;
  coverImageUrl: string | null;
  score: number;
}

@Injectable()
export class SearchVenuesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 공개 시설 검색. (GET /search/venues)
   *
   * Prisma 가 아니라 $queryRaw 인 이유는 하나다: 기본 정렬이 pg_trgm 유사도인데
   * Prisma 쿼리 빌더로는 `similarity()` 를 정렬 키로 쓸 수 없다.
   * 그래서 노출 술어도 SQL 형태가 필요했고, 그 형태는 Prisma 형태 바로 옆
   * `public-visibility.ts` 에 붙여 두었다(IC-51 — 두 형태는 반드시 같이 고친다).
   *
   * 시설 응답에는 애초에 금액·순위 개념이 없다. 여는 이벤트 수(openEventCount)는
   * 파트너 모듈이 관리하는 비정규화 캐시이고, 경쟁 정보가 아니다.
   */
  async search(query: SearchVenuesQueryDto): Promise<PublicVenuePageDto> {
    const keyword = normalizeKeyword(query.keyword);
    const offset = decodeOffsetCursor(query.cursor);
    const limit = query.limit;

    // 검색어가 없으면 relevance 는 의미가 없다(모든 행의 유사도가 0). popular 로 눕힌다.
    const sort: VenueSort = query.sort === 'relevance' && !keyword ? 'popular' : query.sort;
    const useSimilarity = keyword !== null && sort === 'relevance';

    const conditions: Prisma.Sql[] = [publicVenueWhereSql()];

    if (query.sigunguCode) {
      // Venue.regionCode 는 법정동코드 10자리라 시군구 5자리와 값 공간이 다르다(IC-52).
      // 그래서 이벤트 검색과 달리 Region 을 반드시 거쳐야 한다.
      // 인덱스: region_sigungu_code_idx → venue_region_idx.
      conditions.push(Prisma.sql`r."sigunguCode" = ${query.sigunguCode}::text`);
    }

    if (query.categoryId) {
      // venue_primary_category_idx. 부업종(secondaryCategories)은 보지 않는다 — DTO 계약대로 대표 업종만이다.
      conditions.push(Prisma.sql`v."primaryCategoryId" = ${query.categoryId}::text`);
    }

    if (keyword) {
      conditions.push(
        useSimilarity
          ? // `%` 는 pg_trgm 유사도 연산자(임계값 pg_trgm.similarity_threshold, 기본 0.3).
            // 인덱스: venue_search_text_trgm (GIN, gin_trgm_ops).
            Prisma.sql`(v."searchText" % ${keyword}::text OR v."name" ILIKE ${toLikePattern(keyword)}::text)`
          : // 단순 경로. 선행 와일드카드가 붙은 ILIKE 도 gin_trgm_ops 인덱스를 탄다 —
            // 그래서 "간단한 쪽"이 곧 "느린 쪽"은 아니다. searchText 에 시설명·지역·업종명이 이미 합쳐져 있다.
            Prisma.sql`v."searchText" ILIKE ${toLikePattern(keyword)}::text`,
      );
    }

    const score = useSimilarity
      ? Prisma.sql`GREATEST(similarity(coalesce(v."searchText", ''), ${keyword}::text), similarity(v."name", ${keyword}::text))`
      : Prisma.sql`0::real`;

    const rows = await this.prisma.$queryRaw<VenueSearchRow[]>`
      SELECT
        v."id",
        v."name",
        v."slug",
        v."summary",
        v."sido",
        v."sigungu",
        v."roadAddress",
        v."latitude",
        v."longitude",
        v."seatCount",
        v."openEventCount",
        c."id"      AS "categoryId",
        c."nameKo"  AS "categoryNameKo",
        c."iconKey" AS "categoryIconKey",
        img."blobUrl" AS "coverImageUrl",
        ${score} AS "score"
      FROM "Venue" v
      JOIN "Category" c ON c."id" = v."primaryCategoryId"
      JOIN "Region" r ON r."code" = v."regionCode"
      LEFT JOIN "VenueImage" img
        ON img."id" = v."coverImageId" AND img."deletedAt" IS NULL
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${orderByFor(sort)}
      LIMIT ${limit + 1} OFFSET ${offset}
    `;

    // limit + 1 을 읽어 다음 페이지 유무를 판단한다. COUNT(*) 를 따로 돌리지 않는다 —
    // 검색 결과 총건수는 화면에 필요 없고, 그 COUNT 가 검색 자체보다 비싸다.
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toPublicVenueCard);

    // 시설 응답에는 금액 개념이 없지만 그물은 똑같이 친다. 이 엔드포인트가 나중에
    // "이 시설의 진행 중 이벤트" 같은 필드를 달게 되는 날, 여기가 먼저 깨져야 한다.
    assertPublicPayload(items, 'GET /search/venues');

    return {
      items,
      hasMore,
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
    };
  }
}

/**
 * 정렬. 마지막 키는 항상 id 다 — 동점 행의 순서가 요청마다 달라지면
 * 오프셋 페이지네이션에서 같은 시설이 두 페이지에 나오거나 통째로 빠진다.
 */
function orderByFor(sort: VenueSort): Prisma.Sql {
  switch (sort) {
    case 'popular':
      // venue_search_open_event_idx (status, openEventCount).
      return Prisma.sql`v."openEventCount" DESC, v."id" ASC`;

    case 'newest':
      // venue_search_recent_idx (status, publishedAt). 미게시 시설은 애초에 술어에서 빠진다.
      return Prisma.sql`v."publishedAt" DESC NULLS LAST, v."id" ASC`;

    case 'name':
      return Prisma.sql`v."name" ASC, v."id" ASC`;

    case 'relevance':
    default:
      // 유사도가 같으면 여는 이벤트가 많은 곳을 앞에 둔다. 검색은 결국 예약하러 온 것이라
      // "이름은 비슷한데 열린 게 없는 곳"이 위에 오면 안 된다.
      return Prisma.sql`"score" DESC, v."openEventCount" DESC, v."id" ASC`;
  }
}

function toPublicVenueCard(row: VenueSearchRow): PublicVenueCardDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    summary: row.summary,
    sido: row.sido,
    sigungu: row.sigungu,
    roadAddress: row.roadAddress,
    latitude: toNumberOrNull(row.latitude),
    longitude: toNumberOrNull(row.longitude),
    categoryId: row.categoryId,
    categoryNameKo: row.categoryNameKo,
    categoryIconKey: row.categoryIconKey,
    coverImageUrl: row.coverImageUrl,
    seatCount: row.seatCount,
    openEventCount: Number(row.openEventCount),
    score: Number(row.score),
  };
}

/**
 * numeric(9,6) 은 Prisma.Decimal 로 올라온다.
 * 그대로 JSON 으로 내보내면 `{"s":1,"e":2,"d":[...]}` 같은 내부 표현이 나가므로 숫자로 눕힌다.
 * 좌표는 소수 6자리라 double 정밀도 안에 온전히 들어간다 — 여기서 정밀도 손실은 없다.
 */
function toNumberOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value.toString());
}
