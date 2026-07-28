import { All, Controller, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CronGuard } from '../common/guards/cron.guard';
import { EventLifecycleService } from './event-lifecycle.service';
import { EventStatsService } from './event-stats.service';

/**
 * Vercel Cron 진입점.
 *
 * 서버리스라 상주 프로세스가 없다 — "신청 시작 시각이 되면 연다"를 타이머로 만들 수 없으므로
 * 크론이 주기적으로 상태를 따라잡는다. @Public() 으로 JWT 가드를 빼고 CronGuard 로 바꾼다:
 * 크론 호출에는 사용자가 없고, 대신 CRON_SECRET 을 상수 시간 비교한다.
 *
 * 멱등하다. 모든 단계가 현재 상태를 WHERE 에 적은 조건부 UPDATE 라, 같은 분에 두 번 돌아도
 * 두 번째는 0행이다. Vercel Cron 이 at-least-once 라는 점을 전제로 만들어야 한다.
 *
 * ★ @All 인 이유: **Vercel Cron 은 GET 으로 호출한다.** @Post 만 달아두면 배포된 순간
 * 크론이 전부 404 가 나고, 스위퍼·순위 확정·메일 발송이 조용히 멈춘다 — 에러 로그도 안 남아
 * 가장 늦게 발견되는 종류의 고장이다.
 * @Get 과 @Post 를 겹쳐 다는 건 해결책이 아니다. 둘 다 같은 METHOD_METADATA 키를 쓰기 때문에
 * 위에 붙은 데코레이터가 아래를 덮어써서 한쪽만 등록된다. @All 이 정답이다.
 * (손으로 확인할 때 curl -X POST 를 쓸 수 있는 것도 덤이다.)
 */
@ApiTags('cron')
@ApiExcludeController()
@Public()
@UseGuards(CronGuard)
@Controller('cron/events')
export class EventsCronController {
  constructor(
    private readonly lifecycle: EventLifecycleService,
    private readonly stats: EventStatsService,
  ) {}

  @All('lifecycle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SCHEDULED→OPEN, OPEN→CLOSED 상태 따라잡기' })
  runLifecycle() {
    return this.lifecycle.runLifecycleSweep();
  }

  /**
   * 집계 갱신 + INSTANT 정원 대사. (IC-53 / IC-16)
   *
   * 두 단계를 한 엔드포인트에 두는 이유는 IC-16 이 "event-stats-refresh 에 재계산 단계를
   * 넣는다"고 정했기 때문이다. 대사는 이벤트마다 자문 락을 잡으므로 집계 갱신보다
   * 훨씬 비싸다 — 그래서 집계를 **먼저** 끝낸다. 대사가 타임아웃에 걸려도 경쟁률은 이미 새 값이다.
   */
  @All('stats-refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '경쟁률 집계 갱신 + INSTANT claimedCount 실측 대사' })
  async runStatsRefresh() {
    const stats = await this.stats.refreshStats();
    const reconcile = await this.stats.reconcileClaimedCounts();

    return { ...stats, ...reconcile };
  }
}
