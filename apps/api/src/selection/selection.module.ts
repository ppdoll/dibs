import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { DepositSweeperService } from './deposit-sweeper.service';
import { RankingService } from './ranking.service';
import { SelectionAdminController } from './selection-admin.controller';
import { SelectionCronController } from './selection-cron.controller';
import { SelectionFinalizeService } from './selection-finalize.service';
import { SelectionController } from './selection.controller';
import { SelectionService } from './selection.service';

/**
 * 순위·선정 애그리게이트 + 시간이 만드는 모든 전이(크론).
 *
 * 서비스를 넷으로 쪼갠 기준은 "무엇을 얼리는가"다:
 *  - RankingService           라운드 개시. 순위를 계산해 **스냅샷으로 얼린다**(IC-31/IC-34).
 *  - SelectionService         얼린 명단 위의 파트너 심사. 스냅샷은 절대 건드리지 않는다.
 *  - SelectionFinalizeService 확정. 신청 상태 종결 + 환불 큐 + 결과 알림까지 한 트랜잭션.
 *  - DepositSweeperService    만료 스위퍼. 순위에 들어갈 자격을 시간이 회수하는 쪽(D-05/D-06).
 *
 * 다른 모듈의 서비스는 주입하지 않는다. 결합은 전부 DB 를 통해서만 생긴다 —
 * 알림은 같은 트랜잭션의 아웃박스 행(IC-42), 감사는 같은 트랜잭션의 AuditLog 행(IC-61),
 * 다른 애그리게이트(Event/Application/Deposit) 는 Prisma 로 직접 읽고 쓴다.
 *
 * 소프트 클로즈만 예외적으로 **SQL 조각**을 내보낸다(`internal/soft-close.sql.ts`).
 * 연장을 실제로 유발하는 곳은 신청·입찰 모듈의 상향 경로인데, 서비스를 주입하면 모듈이 묶이고
 * SQL 을 복붙하면 IC-17 의 술어가 한쪽에서만 빠지는 날이 온다. events 모듈이 `PUBLIC_EVENT_WHERE`
 * 를 상수로 내보내는 것과 같은 방식이다 — 공유되는 것은 코드가 아니라 **문장**이다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SelectionController, SelectionAdminController, SelectionCronController],
  providers: [RankingService, SelectionService, SelectionFinalizeService, DepositSweeperService],
  // 서비스는 내보내지 않는다. 내보내는 순간 다른 모듈이 주입할 수 있게 되고, 그게 이 프로젝트가
  // 피하려는 결합이다. 공유가 필요한 것은 soft-close.sql.ts 의 SQL 빌더뿐이고 그건 모듈 밖에 있다.
  exports: [],
})
export class SelectionModule {}
