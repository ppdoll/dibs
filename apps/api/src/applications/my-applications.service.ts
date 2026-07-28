import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { CursorPage } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ApplicationDepositsService } from './application-deposits.service';
import {
  MY_APPLICATION_SELECT,
  toMyApplicationView,
  type MyApplicationView,
} from './internal/application-view';
import type { MyApplicationListQueryDto } from './dto/application.dto';

/**
 * "내 신청 내역" 조회. (D-07)
 *
 * ★ 이 서비스가 지키는 것은 하나다: **본인 금액은 보여주고, 본인 순위는 보여주지 않는다.**
 * 헷갈리기 쉬워서 다시 적는다 — 내 금액은 내 정보지만, 내 순위는 남들의 금액을 알아야 나오는
 * 값이라 공개하면 커트라인이 역산된다. 기간 중 공개되는 경쟁 정보는 경쟁률 하나뿐이다.
 *
 * 스키마에서 `Application.finalRank` 를 지우고 커트라인을 `SelectionCutoff` 로 분리한 것이
 * 1차 방어이고, 여기서 화이트리스트 매퍼로만 응답을 조립하는 것이 2차 방어다.
 * `include: { selections: true }` 한 줄이면 둘 다 무너진다(IC-35).
 */
@Injectable()
export class MyApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deposits: ApplicationDepositsService,
  ) {}

  /**
   * 목록. 커서 페이지네이션이다.
   *
   * offset 이 아니라 커서인 이유: 목록이 신청 순으로 계속 늘어나므로 offset 은 페이지를 넘기는
   * 사이 항목이 밀려 중복·누락이 생긴다. 정렬은 `application_my_list_idx`
   * (userId, status, createdAt DESC)를 그대로 탄다.
   */
  async list(
    user: AuthenticatedUser,
    query: MyApplicationListQueryDto,
  ): Promise<CursorPage<MyApplicationView>> {
    // 조회 시 지연 만료(D-05). 크론은 분 단위라, 이게 없으면 이미 죽은 홀드를 보고
    // 입금을 시도하는 사용자가 매번 생긴다.
    await this.deposits.expireOverdueHoldsOf(user.id);

    const rows = await this.prisma.application.findMany({
      where: {
        userId: user.id,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: MY_APPLICATION_SELECT,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map(toMyApplicationView),
      hasMore,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * 상세. 본인 입찰 이력을 함께 준다.
   *
   * 이력에 담기는 금액은 전부 **본인이 불렀던 금액**이다. 남의 금액도, 그 시점의 순위도 없다.
   * 롤백이 일어났을 때 "왜 내 금액이 내려갔나"에 답할 수 있어야 하므로 source 는 그대로 노출한다 —
   * 그 근거를 남기려고 `BidHistory` 를 append-only 로 둔 것이다(IC-13 / IC-23).
   */
  async get(user: AuthenticatedUser, applicationId: string) {
    await this.deposits.expireOverdueHoldsOf(user.id);

    const row = await this.prisma.application.findFirst({
      where: { id: applicationId, userId: user.id },
      select: MY_APPLICATION_SELECT,
    });

    if (!row) throw new NotFoundException('신청 내역을 찾을 수 없습니다.');

    const history = await this.prisma.bidHistory.findMany({
      where: { applicationId, userId: user.id },
      orderBy: { seq: 'asc' },
      // ipHash 는 포렌식용이라 본인에게도 돌려주지 않는다. 순위·커트라인 계열은 애초에 이 표에 없다.
      select: {
        seq: true,
        source: true,
        previousAmount: true,
        newAmount: true,
        deltaAmount: true,
        bidAt: true,
        restoredLastBidAt: true,
        triggeredSoftClose: true,
      },
    });

    const openHold = await this.prisma.deposit.findFirst({
      where: { applicationId, status: 'PENDING' },
      orderBy: { seq: 'desc' },
      select: { id: true, reason: true, amountDue: true, dueAt: true, windowMinutes: true },
    });

    return {
      ...toMyApplicationView(row),
      /** 내가 불렀던 금액의 전 이력. 남의 금액은 한 줄도 들어 있지 않다. */
      myBidHistory: history,
      /** 지금 열려 있는 예약금 홀드. 없으면 null 이다. */
      openDepositHold: openHold,
    };
  }
}
