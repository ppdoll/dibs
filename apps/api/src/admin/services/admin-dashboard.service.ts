import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/** 대시보드 한 벌. 전부 int 로 캐스팅해서 받는다 — count(*) 는 bigint 라 JSON 직렬화에서 터진다. */
export interface DashboardCounts {
  pendingPartners: number;
  overduePartners: number;
  pendingBusinesses: number;
  pendingVenues: number;
  openEvents: number;
  closingSoonEvents: number;
  applicationsToday: number;
  expiringHolds: number;
  overdueHolds: number;
  suspendedUsers: number;
  sendingBroadcasts: number;
  quarantinedImages: number;
}

/**
 * 운영 대시보드.
 *
 * 열두 개의 카운트를 **한 문장**으로 가져온다. 서버리스에서 12번 왕복하면 그 자체가
 * 대시보드 열기의 지연이 되고, 커넥션 풀(pgbouncer)도 그만큼 오래 잡는다.
 * 각 스칼라 서브쿼리는 자기 인덱스(partner_sla_overdue_idx, venue_review_queue_idx,
 * event_status_apply_end_idx, deposit_sweep_idx …)를 그대로 탄다.
 */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(): Promise<DashboardCounts & { generatedAt: string }> {
    // "오늘"은 KST 자정 기준이다. UTC 자정으로 자르면 한국 운영자에게는 오전 9시에
    // 카운트가 리셋되는, 설명할 수 없는 숫자가 된다.
    const [row] = await this.prisma.$queryRaw<DashboardCounts[]>`
      SELECT
        (SELECT count(*) FROM "PartnerProfile"
          WHERE "approvalStatus" = 'PENDING' AND "deletedAt" IS NULL)::int
          AS "pendingPartners",
        (SELECT count(*) FROM "PartnerProfile"
          WHERE "approvalStatus" = 'PENDING' AND "deletedAt" IS NULL
            AND "slaDueAt" IS NOT NULL AND "slaDueAt" <= now())::int
          AS "overduePartners",
        (SELECT count(*) FROM "Business"
          WHERE "verificationStatus" = 'PENDING' AND "deletedAt" IS NULL)::int
          AS "pendingBusinesses",
        (SELECT count(*) FROM "Venue"
          WHERE status = 'PENDING_REVIEW' AND "deletedAt" IS NULL)::int
          AS "pendingVenues",
        (SELECT count(*) FROM "Event"
          WHERE status = 'OPEN' AND "deletedAt" IS NULL)::int
          AS "openEvents",
        (SELECT count(*) FROM "Event"
          WHERE status = 'OPEN' AND "deletedAt" IS NULL
            AND "applyEndAt" <= now() + interval '24 hours')::int
          AS "closingSoonEvents",
        (SELECT count(*) FROM "Application"
          WHERE "createdAt" >=
            (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'))::int
          AS "applicationsToday",
        (SELECT count(*) FROM "Deposit"
          WHERE status = 'PENDING' AND "dueAt" > now()
            AND "dueAt" <= now() + interval '30 minutes')::int
          AS "expiringHolds",
        (SELECT count(*) FROM "Deposit"
          WHERE status = 'PENDING' AND "dueAt" <= now())::int
          AS "overdueHolds",
        (SELECT count(*) FROM "User"
          WHERE status = 'SUSPENDED' AND "deletedAt" IS NULL)::int
          AS "suspendedUsers",
        (SELECT count(*) FROM "Broadcast"
          WHERE status IN ('SENDING','EXPANDING') AND "deletedAt" IS NULL)::int
          AS "sendingBroadcasts",
        (SELECT count(*) FROM "VenueImage"
          WHERE status = 'QUARANTINED' AND "deletedAt" IS NULL)::int
          AS "quarantinedImages"
    `;

    return { ...row!, generatedAt: new Date().toISOString() };
  }

  /**
   * 만료가 임박한 홀드 목록. 대시보드의 `expiringHolds` 를 눌렀을 때 보는 화면이다.
   *
   * 금액을 싣지 않는다. 운영자는 자기 권한으로 볼 수 있지만(D-07), 이 화면의 목적은
   * "스위퍼가 제때 도는가"를 보는 것이지 개별 금액을 보는 것이 아니다 —
   * 필요 없는 곳에 금액을 실어두면 언젠가 그 응답이 다른 화면에 재사용된다.
   */
  async expiringHolds(limit = 50) {
    const rows = await this.prisma.deposit.findMany({
      where: { status: 'PENDING', dueAt: { lte: new Date(Date.now() + 30 * 60_000) } },
      orderBy: { dueAt: 'asc' },
      take: Math.min(limit, 200),
      select: {
        id: true,
        applicationId: true,
        eventId: true,
        userId: true,
        reason: true,
        openedAt: true,
        dueAt: true,
        reminderSentAt: true,
        event: { select: { title: true, status: true } },
      },
    });

    return { items: rows };
  }

  /**
   * 최근 SLA 초과 심사 건. 큐가 밀리고 있는지 한눈에 보라고 대시보드에 붙인다.
   */
  async overduePartnerQueue(limit = 20) {
    const rows = await this.prisma.partnerProfile.findMany({
      where: {
        approvalStatus: 'PENDING',
        deletedAt: null,
        slaDueAt: { lte: new Date() },
      },
      orderBy: { slaDueAt: 'asc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        contactName: true,
        contactEmail: true,
        submittedAt: true,
        slaDueAt: true,
        resubmitCount: true,
      },
    });

    return { items: rows };
  }
}
