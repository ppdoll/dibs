import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PublicEventListQueryDto } from './dto/event-query.dto';
import { EventsService } from './events.service';

/**
 * 공개 이벤트 조회. 로그인 없이 둘러볼 수 있어야 하므로 @Public() 이다.
 *
 * 여기서 나가는 것은 toPublicEventSummary() 의 출력뿐이다 — 기간 중 유저가 볼 수 있는 경쟁 정보는
 * **경쟁률 하나**이고(D-07), 금액·개인 순위·커트라인은 어디에도 실리지 않는다.
 * 자기 순위도 볼 수 없다는 뜻이라, 로그인 여부로 응답이 달라지지 않는 것이 정상이다.
 */
@ApiTags('events')
@Public()
@Controller('events')
export class EventsPublicController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({
    summary: '공개 이벤트 목록',
    description: '마감 임박 순. 노출 조건은 서버가 정하며 클라이언트가 넓힐 수 없다.',
  })
  list(@Query() query: PublicEventListQueryDto) {
    return this.events.listPublic(query);
  }

  @Get(':key')
  @ApiOperation({ summary: '공개 이벤트 상세 (id 또는 slug)' })
  @ApiOkResponse({
    description:
      '경쟁률 외의 경쟁 정보는 없다. 파트너가 표시를 껐거나 표본이 임계치 미만이면 ratio가 null이다.',
  })
  get(@Param('key') key: string) {
    return this.events.getPublic(key);
  }
}
