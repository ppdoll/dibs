import { Module } from '@nestjs/common';

import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { SearchController } from './search.controller';
import { SearchEventsService } from './search-events.service';
import { SearchVenuesService } from './search-venues.service';

/**
 * 공개 검색·탐색. 전부 읽기 전용이고 전부 @Public() 이다.
 *
 * 서비스를 셋으로 나눈 기준은 "무엇을 조회하는가"가 아니라 **어떤 쿼리 형태로 도는가**다:
 *  - SearchEventsService  Prisma 쿼리 빌더 + id 키셋 커서. 유사도는 후보 id 를 넓히는 데만 쓴다.
 *  - SearchVenuesService  $queryRaw + 오프셋 커서. 유사도가 정렬 키라 빌더로 표현할 수 없다.
 *  - DiscoveryService     섹션 여러 개를 병렬로 읽는 조합 쿼리. 페이지네이션이 없다.
 * 셋이 한 파일에 있으면 커서 규약이 섞여서 한쪽 수정이 다른 쪽 페이지를 조용히 깨뜨린다.
 *
 * 공개 노출 술어는 `public-visibility.ts` 한 곳에만 있다(IC-51). 세 서비스가 전부 그것만 쓰고,
 * 응답은 전부 `public-event.mapper.ts` 의 화이트리스트 select 를 통과한다 —
 * 금액·순위·커트라인이 실릴 수 있는 경로 자체를 만들지 않는다(D-07, IC-05).
 *
 * 다른 도메인 모듈의 서비스는 주입하지 않는다. Venue.searchText·Event.liveApplicantCount 처럼
 * 다른 모듈이 채우는 값은 전부 DB 컬럼으로 받는다 — 결합은 DB 를 통해서만 생긴다.
 * PrismaModule 은 전역이라 여기서 import 하지 않는다.
 */
@Module({
  controllers: [SearchController, DiscoveryController],
  providers: [SearchEventsService, SearchVenuesService, DiscoveryService],
  exports: [],
})
export class SearchModule {}
