import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { DiscoveryService } from './discovery.service';
import { DiscoveryHomeDto, DiscoveryHomeQueryDto } from './dto/discovery.dto';

/**
 * 홈 탐색 피드. catchtable 처럼 섹션 캐러셀이 세로로 쌓이는 화면 하나를 그대로 채운다.
 *
 * 검색과 분리한 이유: 검색은 "조건 → 목록"이라 커서 페이지네이션이 계약의 일부인데,
 * 홈은 "섹션 여러 개를 한 번에"라 페이지네이션이 없다. 한 컨트롤러에 섞으면
 * 응답 형태가 둘인 엔드포인트 집합이 되어 프론트가 매번 분기하게 된다.
 */
@ApiTags('discovery')
@Public()
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('home')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  @ApiOperation({
    summary: '홈 피드 (마감임박 / 신규 오픈 / 인기 / 카테고리별)',
    description:
      '비어 있는 섹션은 응답에서 빠진다. 모든 섹션이 검색과 동일한 공개 술어를 통과한다(IC-51).',
  })
  @ApiOkResponse({ type: DiscoveryHomeDto })
  home(@Query() query: DiscoveryHomeQueryDto) {
    return this.discovery.home(query);
  }
}
