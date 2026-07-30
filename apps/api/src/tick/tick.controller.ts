import { All, Controller, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CronGuard } from '../common/guards/cron.guard';
import { TickRegistry } from './tick-registry.service';

/**
 * 등록된 스케줄 잡을 **한 번에 전부** 돌리는 단일 엔드포인트.
 *
 * 원래는 잡마다 크론 경로가 하나씩(8개) 있었다. Vercel Hobby 가 크론을 2개까지만
 * 받아주기 때문에 하나로 합쳤다. 기존 8개 경로는 그대로 살아 있다 —
 * 하나만 따로 돌려보고 싶을 때(디버깅·수동 복구) 필요하고, Pro 로 올라가면
 * `vercel.json` 의 crons 를 예전처럼 되돌리기만 하면 된다.
 *
 * ★ 이 경로는 **트래픽이 없을 때를 위한 안전망**이다. 평소 스케줄의 주 동력은
 *   요청에 얹힌 TickInterceptor 다. 자세한 배경은 TickRegistry 주석 참고.
 *
 * ★ @All 인 이유: Vercel Cron 은 GET 으로 호출한다. @Post 만 달면 배포된 순간 404 다.
 */
@ApiTags('cron')
@ApiExcludeController()
@Public()
@UseGuards(CronGuard)
@Controller('cron')
export class TickController {
  constructor(private readonly registry: TickRegistry) {}

  @All('tick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '등록된 스케줄 잡을 순서대로 전부 실행' })
  async tick() {
    const report = await this.registry.runNow('cron');

    return { ...report, registered: this.registry.registered };
  }
}
