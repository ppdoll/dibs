import { All, Controller, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CronGuard } from '../common/guards/cron.guard';
import { DepositSweeperService } from './deposit-sweeper.service';
import { RankingService } from './ranking.service';

/**
 * Vercel Cron 진입점 — 예약금 만료와 순위 확정.
 *
 * 서버리스라 상주 프로세스가 없다. "10분 뒤에 만료" / "마감 + 윈도우가 지나면 순위 확정"을
 * 타이머로 만들 수 없으므로 크론이 지나가며 상태를 따라잡는다(D-05).
 * `@Public()` 으로 JWT 가드를 빼고 `CronGuard` 로 바꾼다 — 크론 호출에는 사용자가 없고,
 * 대신 CRON_SECRET 을 상수 시간 비교한다. 이 가드가 없으면 만료 스위퍼를 아무나 때릴 수 있다.
 *
 * 세 엔드포인트 모두 **at-least-once 전제**로 만들어졌다: Vercel Cron 은 겹쳐서 실행되고
 * 함수는 타임아웃으로 죽는다. 모든 단계가 현재 상태를 WHERE 에 적은 조건부 UPDATE 라
 * 같은 분에 두 번 돌아도 두 번째는 0행이다.
 *
 * 이벤트 라이프사이클(SCHEDULED→OPEN, OPEN→CLOSED)과 집계 갱신은 여기 없다 —
 * events 모듈이 `POST /cron/events/lifecycle`, `POST /cron/events/stats-refresh` 로 이미 갖고 있고,
 * 그 전이는 이벤트 애그리게이트의 것이다. 라우트를 두 벌 두면 어느 쪽이 진짜인지 알 수 없게 된다.
 * 크론 호출 순서는 `events/lifecycle` → `expire-holds` → `finalize-rankings` 가 맞다(vercel.json).
 *
 * ★ @All 인 이유: **Vercel Cron 은 GET 으로 호출한다.** @Post 만 달아두면 배포된 순간 크론이
 * 전부 404 가 나고 작업이 조용히 멈춘다 — 에러 로그도 안 남아 가장 늦게 발견되는 고장이다.
 * @Get 과 @Post 를 겹쳐 다는 건 답이 아니다: 둘 다 같은 METHOD_METADATA 키를 써서 한쪽이
 * 다른 쪽을 덮어쓴다. (손으로 확인할 때 curl -X POST 를 쓸 수 있는 것도 덤이다.)
 */
@ApiTags('cron')
@ApiExcludeController()
@Public()
@UseGuards(CronGuard)
@Controller('cron')
export class SelectionCronController {
  constructor(
    private readonly sweeper: DepositSweeperService,
    private readonly ranking: RankingService,
  ) {}

  @All('expire-holds')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '만료된 예약금 홀드 스윕 (자리 반환 / 금액 롤백)',
  })
  expireHolds() {
    return this.sweeper.expireHolds();
  }

  @All('deposit-reminders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '만기 임박 예약금 리마인더 (홀드당 1회)' })
  depositReminders() {
    return this.sweeper.sendDepositReminders();
  }

  /**
   * 순위 확정.
   *
   * 대사를 먼저 돌리는 이유는 순서다 — `rankingLockAt` 이 어긋난 이벤트를 그대로 확정하면
   * 아직 예약금 시계가 남은 신청자를 빼놓은 채로 순위가 얼어붙는다.
   * 이 엔드포인트는 반드시 `expire-holds` **뒤에** 호출돼야 한다: 열린 홀드가 하나라도 남아 있으면
   * 게이트에 걸려 아무 이벤트도 열리지 않기 때문이다(IC-26).
   */
  @All('finalize-rankings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '확정 시각이 지난 이벤트의 선정 라운드 개시' })
  async finalizeRankings() {
    const lockRepaired = await this.ranking.reconcileRankingLocks();
    const rounds = await this.ranking.openDueRounds();

    return { lockRepaired, ...rounds };
  }
}
