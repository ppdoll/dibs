import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ApplicationApplyService } from './application-apply.service';
import { ApplicationBiddingService } from './application-bidding.service';
import { ApplicationDepositsService } from './application-deposits.service';
import { ApplicationsController } from './applications.controller';
import { MyApplicationsService } from './my-applications.service';
import { IdempotencyService } from './internal/idempotency.service';

/**
 * 신청·입찰·예약금 애그리게이트. 플랫폼에서 가장 뜨거운 쓰기 경로다.
 *
 * 서비스를 넷으로 쪼갠 기준은 "무엇을 잠그고 무엇을 전이시키는가"다:
 *  - ApplicationApplyService     신청 생성·재신청. BID 는 Event 에 FOR SHARE(IC-11),
 *                                INSTANT 는 단일 조건부 UPDATE 로 자리를 잡는다(IC-15).
 *  - ApplicationBiddingService   상향·취소. "올리기만"은 WHERE 절이 강제한다(IC-12/IC-13).
 *  - ApplicationDepositsService  홀드 확정(IC-21)과 조회 시 지연 만료·롤백(IC-23/IC-24).
 *  - MyApplicationsService       읽기 전용. D-07 화이트리스트 매퍼로만 응답을 조립한다.
 *  - IdempotencyService          모든 변경 엔드포인트의 상호배제 겸 응답 재생(IC-03).
 *
 * 다른 모듈의 서비스는 주입하지 않는다. 알림은 아웃박스 행(IC-42), 다른 애그리게이트 조회는
 * Prisma 직접 — 결합은 전부 DB 를 통해서만 생긴다. 순위는 여기서 절대 계산하지 않는다:
 * `ORDER BY amount DESC, lastBidAt ASC, applySeq ASC` 를 TS 로 흉내 내는 순간
 * Timestamptz(6) 이 JS Date 의 밀리초로 깎여 DB 인덱스와 다른 순서가 나온다(IC-04/IC-31).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ApplicationsController],
  providers: [
    ApplicationApplyService,
    ApplicationBiddingService,
    ApplicationDepositsService,
    MyApplicationsService,
    IdempotencyService,
  ],
  // 서비스를 내보내지 않는다. 파트너·선정 모듈이 신청을 읽어야 하면 Prisma 로 직접 읽는다 —
  // 서비스를 내보내는 순간 모듈 간 결합이 생기고, 그 결합은 트랜잭션 경계를 넘나들기 시작한다.
  exports: [],
})
export class ApplicationsModule {}
