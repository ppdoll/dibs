import { All, Controller, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CronGuard } from '../common/guards/cron.guard';
import { BroadcastExpanderService } from './broadcast-expander.service';
import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * Vercel Cron 진입점 — 이메일 발송과 공지 확장. (IC-42, D-10)
 *
 * 서버리스라 상주 워커가 없다. 도메인 트랜잭션은 아웃박스 행만 남기고 끝나고, 실제 발송은
 * 이 크론이 지나가며 따라잡는다. `@Public()` 으로 JWT 가드를 빼고 `CronGuard` 로 바꾼다 —
 * 크론 호출에는 사용자가 없고, 대신 CRON_SECRET 을 상수 시간 비교한다.
 *
 * 호출 순서는 `expand-broadcasts` → `dispatch` 가 맞다. 반대로 부르면 방금 펼쳐진 수신자의
 * 메일이 다음 실행까지 한 주기 밀린다. 순서가 뒤집혀도 정확성은 깨지지 않는다 —
 * 세 엔드포인트 모두 at-least-once 전제로, 현재 상태를 WHERE 에 적은 조건부 UPDATE 만 쓴다.
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
@Controller('cron/notifications')
export class NotificationsCronController {
  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly expander: BroadcastExpanderService,
  ) {}

  @All('dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '대기 중인 이메일 아웃박스를 집어 Resend 로 발송' })
  dispatchPending(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.dispatch.dispatchPending(Number.isFinite(parsed) ? parsed : undefined);
  }

  @All('expand-broadcasts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '예약·확장 중인 공지의 다음 수신자 페이지를 펼친다' })
  async expandBroadcasts() {
    const expanded = await this.expander.pumpDue();
    // 통계 대사는 확장이 끝난 뒤에 돈다. sentCount 는 "쪽지를 만든 수"고 실제 스킵·실패는
    // 디스패처가 나중에 기록하므로, 확장 시점에 세면 언제나 0이다.
    const reconciled = await this.expander.reconcileCounters();

    return { ...expanded, reconciled: reconciled.updated };
  }

  @All('sweep-expired')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '만료된 알림을 목록에서 내린다 (soft delete)' })
  sweepExpired() {
    return this.dispatch.sweepExpiredNotifications();
  }
}
