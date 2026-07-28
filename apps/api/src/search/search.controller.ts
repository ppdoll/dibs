import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PublicEventPageDto } from './dto/public-event.dto';
import { PublicVenuePageDto } from './dto/public-venue.dto';
import { SearchEventsQueryDto } from './dto/search-events.query.dto';
import { SearchVenuesQueryDto } from './dto/search-venues.query.dto';
import { SearchEventsService } from './search-events.service';
import { SearchVenuesService } from './search-venues.service';

/**
 * 공개 검색. 로그인 없이 둘러볼 수 있어야 하므로 클래스 단위로 @Public() 이다.
 *
 * 응답이 로그인 여부에 따라 달라지지 않는 것이 **정상**이다 — D-07 은 자기 순위조차 감추므로
 * 로그인해도 더 보여줄 것이 없다. 그래서 CDN 캐시를 그대로 걸 수 있다.
 */
@ApiTags('search')
@Public()
@Controller('search')
export class SearchController {
  constructor(
    private readonly events: SearchEventsService,
    private readonly venues: SearchVenuesService,
  ) {}

  /**
   * s-maxage 는 Vercel 엣지 캐시용이고 max-age=0 은 브라우저용이다.
   * 브라우저에 캐시를 남기지 않는 이유: 신청하고 목록으로 돌아왔을 때 경쟁률이 그대로면
   * 유저는 자기 신청이 실패한 줄 안다. 엣지에서 30초는 그 사이 다른 사람의 트래픽을 흡수한다.
   */
  @Get('events')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120')
  @ApiOperation({
    summary: '이벤트 검색',
    description:
      '노출 조건은 서버가 정하며 클라이언트가 넓힐 수 없다. 경쟁 정보는 경쟁률뿐이고 금액·순위·커트라인은 실리지 않는다(D-07).',
  })
  @ApiOkResponse({ type: PublicEventPageDto })
  searchEvents(@Query() query: SearchEventsQueryDto) {
    return this.events.search(query);
  }

  /** 시설은 이벤트보다 훨씬 덜 바뀐다 — 경쟁률처럼 초 단위로 변하는 값이 없어서 더 오래 잡는다. */
  @Get('venues')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600')
  @ApiOperation({
    summary: '시설 검색',
    description: '검색어는 pg_trgm 유사도(relevance 정렬) 또는 ILIKE 부분일치로 매칭한다.',
  })
  @ApiOkResponse({ type: PublicVenuePageDto })
  searchVenues(@Query() query: SearchVenuesQueryDto) {
    return this.venues.search(query);
  }
}
