import { Global, Module } from '@nestjs/common';

import { TickController } from './tick.controller';
import { TickRegistry } from './tick-registry.service';

/**
 * 스케줄 레지스트리.
 *
 * `@Global()` 인 이유: 도메인 모듈들이 부팅 시점에 자기 잡을 등록해야 하는데,
 * 그러자고 모듈마다 `imports: [TickModule]` 을 붙이면 의존 그래프에 선이 6개 늘어난다.
 * 레지스트리는 PrismaModule 과 같은 성격의 인프라라 전역으로 둔다.
 */
@Global()
@Module({
  controllers: [TickController],
  providers: [TickRegistry],
  exports: [TickRegistry],
})
export class TickModule {}
