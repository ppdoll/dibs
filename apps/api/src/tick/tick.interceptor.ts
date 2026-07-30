import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, concatMap } from 'rxjs';

import { TICK_AWAIT_BUDGET_MS, TickRegistry } from './tick-registry.service';

/**
 * 들어오는 요청에 스케줄러를 얹는다.
 *
 * Vercel Hobby 는 크론을 하루 1회까지만 돌려준다. 그래서 **트래픽이 시계 역할을 한다.**
 * 대부분의 요청은 인스턴스 로컬 타이머에서 걸러지고, 게이트까지 가는 요청도
 * UPDATE 한 방으로 끝난다. 실제로 잡을 돌리는 요청은 주기당 한 번뿐이다.
 *
 * ★ 여기서 절대 하면 안 되는 것: 틱 실패를 사용자 응답에 새게 하는 것.
 *   스케줄러는 어디까지나 곁다리다. 무슨 일이 있어도 원래 응답을 그대로 통과시킨다.
 */
@Injectable()
export class TickInterceptor implements NestInterceptor {
  constructor(private readonly registry: TickRegistry) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (shouldSkip(request)) {
      return next.handle();
    }

    // 핸들러가 끝난 **뒤에** 얹는다 — 사용자가 요청한 일이 먼저다.
    return next.handle().pipe(
      concatMap(async (value) => {
        await this.pump();
        return value;
      }),
    );
  }

  /**
   * 예산 안에서만 기다린다.
   *
   * 예산을 넘기면 응답을 먼저 내보내고 틱은 그대로 진행시킨다. 서버리스에서는
   * 응답 이후의 작업이 얼어붙을 수 있으므로 **완주를 보장하지 않는다** — 그래도 괜찮은 이유는
   * 모든 잡이 at-least-once 전제로 짜여 있어 다음 틱이 같은 대상을 다시 집기 때문이다.
   */
  private async pump(): Promise<void> {
    const tick = this.registry.runIfDue().catch(() => null);

    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, TICK_AWAIT_BUDGET_MS);
      // 틱이 먼저 끝나면 이 타이머 때문에 람다가 살아 있을 이유가 없다.
      timer.unref?.();
    });

    try {
      await Promise.race([tick, budget]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

function shouldSkip(request: Request): boolean {
  // 프리플라이트는 본문도 인증도 없다. 여기에 일을 얹을 이유가 없다.
  if (request.method === 'OPTIONS') {
    return true;
  }

  // 크론 엔드포인트 자신은 제외한다 — 틱 안에서 틱을 부르는 꼴이 된다.
  return (request.originalUrl ?? request.url ?? '').includes('/cron/');
}
