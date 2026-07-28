import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditActorRole,
  EventCancelReason,
  EventCloseReason,
  EventStatus,
  VenueStatus,
} from '@prisma/client';
import { assertNoVisibilityLeak } from '@dibs/shared';

import { PrismaService } from '../prisma/prisma.service';
import { assertAffected, assertVersionMatch } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CancelEventDto, CloseEventDto, SuspendEventDto } from './dto/event-lifecycle.dto';
import { EventAuditService, actorLabelOf, type Tx } from './internal/event-audit.service';
import { requirePartnerProfileId } from './internal/event-context';
import { PARTNER_EVENT_SELECT } from './internal/event-select';

/**
 * 이벤트 상태 기계.
 *
 *   DRAFT ──publish──▶ SCHEDULED ──기간 도달──▶ OPEN ──마감──▶ CLOSED ──선정 확정──▶ FINALIZED
 *                                    └──────── cancel ────────┘
 *   어느 상태에서든 운영자가 SUSPENDED 로 묶고, 해제하면 statusBeforeSuspend 로 돌아온다(IC-62).
 *
 * 전이는 전부 **조건부 UPDATE 하나**다. 읽고 → 검사하고 → 쓰는 형태로 만들면 두 문장 사이가
 * 통째로 경합 창이 된다(서버리스 다중 인스턴스). 여기서 먼저 읽는 것은 **문구를 위한 것**이고,
 * 진짜 가드는 언제나 WHERE 절 안에 있다.
 */
@Injectable()
export class EventLifecycleService {
  private readonly logger = new Logger(EventLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EventAuditService,
  ) {}

  /**
   * 공개. DRAFT → SCHEDULED, 이미 신청 시작 시각이 지났으면 곧바로 OPEN.
   *
   * 두 갈래를 한 문장의 CASE 로 처리하는 이유: "지금 열려 있는가"를 TS 에서 판정하면 그 판정과
   * UPDATE 사이에 시작 시각이 지나갈 수 있고, 그러면 SCHEDULED 로 박힌 채 크론 한 바퀴를 기다린다.
   * 시간의 원천은 DB 의 now() 하나뿐이다.
   */
  async publish(user: AuthenticatedUser, eventId: string, ifMatchVersion: number) {
    const partnerId = requirePartnerProfileId(user);

    const current = await this.prisma.event.findFirst({
      where: { id: eventId, partnerId, deletedAt: null },
      select: {
        status: true,
        applyEndAt: true,
        venue: { select: { status: true, deletedAt: true } },
      },
    });

    if (!current) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    if (current.status !== EventStatus.DRAFT) {
      throw new ConflictException({
        code: 'EVENT_ALREADY_PUBLISHED',
        message: '이미 공개된 이벤트입니다.',
      });
    }

    if (current.applyEndAt.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'EVENT_DEADLINE_PASSED',
        message: '신청 마감 일시가 이미 지났습니다. 기간을 다시 정한 뒤 공개해 주세요.',
      });
    }

    // 시설이 살아 있어야 이벤트가 검색에 뜬다. 심사 중인 시설로 공개하면 유저에게는
    // 신청 가능한 것처럼 보이는데 시설 상세는 404 가 되는 상태가 만들어진다.
    if (current.venue.deletedAt !== null || current.venue.status !== VenueStatus.ACTIVE) {
      throw new ConflictException({
        code: 'VENUE_NOT_ACTIVE',
        message: '시설이 공개 상태가 아닙니다. 시설 심사가 끝난 뒤 공개해 주세요.',
      });
    }

    const affected = await this.prisma.$executeRaw`
      UPDATE "Event" e SET
        status = CASE WHEN now() >= e."applyStartAt"
                      THEN 'OPEN'::"EventStatus" ELSE 'SCHEDULED'::"EventStatus" END,
        "openedAt" = CASE WHEN now() >= e."applyStartAt"
                          THEN COALESCE(e."openedAt", now()) ELSE e."openedAt" END,
        -- rankingLockAt = 마감 + 예약금 윈도우 + 유예 1분 (D-04).
        -- 여기서 다시 계산하는 이유: DRAFT 동안 마감이나 윈도우가 여러 번 바뀌었을 수 있고,
        -- NULL 인 채로 OPEN 이 되면 event_ranking_lock_required_chk 가 트랜잭션을 죽인다.
        "rankingLockAt" = e."applyEndAt" + make_interval(
          mins => CASE WHEN e."depositRequired" THEN e."depositWindowMinutes" ELSE 0 END + 1
        ),
        "version" = e."version" + 1,
        -- @updatedAt 은 Prisma 클라이언트 기능이라 raw SQL 에는 적용되지 않는다. 직접 찍는다.
        "updatedAt" = now()
      WHERE e.id = ${eventId}
        AND e."partnerId" = ${partnerId}
        AND e."deletedAt" IS NULL
        AND e.status = 'DRAFT'
        AND e."version" = ${ifMatchVersion}
        AND now() < e."applyEndAt"
    `;

    assertVersionMatch(affected, 'EVENT_VERSION_MISMATCH');

    return this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: PARTNER_EVENT_SELECT,
    });
  }

  /**
   * 파트너 조기 마감. OPEN → CLOSED.
   *
   * `applyEndAt` 을 앞당기지 않는다. 조기 마감이 막는 것은 **새 신청**이고, 이미 예약금 시계가
   * 돌고 있는 사람의 10분은 그대로 남아야 한다(D-04). applyEndAt 을 now() 로 당기면
   * rankingLockAt 도 함께 당겨지면서 아직 유효한 홀드를 남긴 채 순위가 확정된다 — IC-26 이 막는 상황이다.
   */
  async closeEarly(
    user: AuthenticatedUser,
    eventId: string,
    ifMatchVersion: number,
    dto: CloseEventDto,
  ) {
    const partnerId = requirePartnerProfileId(user);

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lockChain(tx, eventId);

      const affected = await tx.$executeRaw`
        UPDATE "Event" e SET
          status = 'CLOSED'::"EventStatus",
          "closedAt" = now(),
          "closeReason" = 'PARTNER_EARLY_CLOSE'::"EventCloseReason",
          "version" = e."version" + 1,
          "updatedAt" = now()
        WHERE e.id = ${eventId}
          AND e."partnerId" = ${partnerId}
          AND e."deletedAt" IS NULL
          AND e.status = 'OPEN'
          AND e."version" = ${ifMatchVersion}
      `;

      assertVersionMatch(affected, 'EVENT_NOT_CLOSEABLE');

      await this.audit.append(tx, {
        eventId,
        actorUserId: user.id,
        actorRole: AuditActorRole.PARTNER,
        actorLabel: actorLabelOf(user),
        targetOwnerUserId: user.id,
        action: AuditAction.EVENT_FORCE_CLOSED,
        reasonCode: EventCloseReason.PARTNER_EARLY_CLOSE,
        summary: `파트너 조기 마감${dto.memo ? `: ${dto.memo}` : ''}`.slice(0, 500),
      });

      return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: PARTNER_EVENT_SELECT });
    });
  }

  /** 파트너 취소. 취소는 되돌릴 수 없고 신청자 전원에게 통보된다. */
  cancelByPartner(
    user: AuthenticatedUser,
    eventId: string,
    ifMatchVersion: number,
    dto: CancelEventDto,
  ) {
    const partnerId = requirePartnerProfileId(user);

    return this.cancel({
      eventId,
      ifMatchVersion,
      partnerId,
      actorUserId: user.id,
      actorRole: AuditActorRole.PARTNER,
      actorLabel: actorLabelOf(user),
      action: AuditAction.PARTNER_EVENT_CANCELED,
      reason: dto.reason,
      memo: dto.memo ?? null,
    });
  }

  /** 운영자 강제 취소. 파트너 소유 검사 없이 어떤 이벤트에도 걸 수 있다. */
  cancelByAdmin(
    user: AuthenticatedUser,
    eventId: string,
    ifMatchVersion: number,
    dto: CancelEventDto,
  ) {
    return this.cancel({
      eventId,
      ifMatchVersion,
      partnerId: null,
      actorUserId: user.id,
      actorRole: AuditActorRole.ADMIN,
      actorLabel: actorLabelOf(user),
      action: AuditAction.EVENT_FORCE_CANCELED,
      reason: dto.reason,
      memo: dto.memo ?? null,
    });
  }

  /**
   * 취소 본체.
   *
   * 락 순서는 전 코드베이스에서 하나다(IC-02): 자문 락 → Event → Application.
   * 감사 행을 쓰는 트랜잭션이므로 자문 락이 **첫 문장**이고, 그 다음 Event, 그 다음 Application 이다.
   * 이 순서를 뒤집으면 확정 트랜잭션과 만나 데드락이 나고, Vercel 함수 타임아웃 안에서는
   * 재시도조차 못 하고 500 이 나간다.
   */
  private async cancel(input: {
    eventId: string;
    ifMatchVersion: number;
    partnerId: string | null;
    actorUserId: string;
    actorRole: AuditActorRole;
    actorLabel: string;
    action: AuditAction;
    reason: EventCancelReason;
    memo: string | null;
  }) {
    const { eventId, ifMatchVersion, partnerId } = input;

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lockChain(tx, eventId);

      const event = await tx.event.findFirst({
        where: { id: eventId, deletedAt: null, ...(partnerId ? { partnerId } : {}) },
        select: { id: true, title: true, status: true, partner: { select: { userId: true } } },
      });

      if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

      // claimedCount 를 0 으로 내리는 것이 IC-15/IC-16 과 맞는 유일한 종료 상태다.
      // 취소된 이벤트에서 자리를 붙들고 있는 사람은 없어야 하고, 아래에서 slotClaimed 를
      // 전부 내리므로 "실측 = 0" 이 된다. 그대로 두면 대사 크론이 영구히 drift 를 보고한다.
      const affected = await tx.$executeRaw`
        UPDATE "Event" e SET
          status = 'CANCELED'::"EventStatus",
          "canceledAt" = now(),
          "cancelReason" = ${input.reason}::"EventCancelReason",
          "cancelMemo" = ${input.memo}::text,
          "claimedCount" = 0,
          "soldOutAt" = NULL,
          "version" = e."version" + 1,
          "updatedAt" = now()
        WHERE e.id = ${eventId}
          AND e."deletedAt" IS NULL
          AND e."version" = ${ifMatchVersion}
          AND e.status IN ('DRAFT','SCHEDULED','OPEN','CLOSED')
      `;

      assertVersionMatch(affected, 'EVENT_NOT_CANCELABLE');

      const affectedApplications = await this.terminateApplications(tx, eventId);
      const notified = await this.enqueueCancelNotifications(tx, event.id, event.title);

      await this.audit.append(tx, {
        eventId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        actorLabel: input.actorLabel,
        targetOwnerUserId: event.partner.userId,
        action: input.action,
        reasonCode: input.reason,
        // 대량 작업은 행마다 감사 행을 쓰지 않고 집계 1행을 쓴다(IC-61).
        // 신청 200건에 감사 행 200개면 그 트랜잭션이 자문 락을 200배 오래 든다.
        summary: `이벤트 취소(${input.reason}) — 신청 ${affectedApplications}건 종료, 알림 ${notified}건`,
        beforeJson: { status: event.status },
        afterJson: { status: EventStatus.CANCELED, canceledApplications: affectedApplications },
      });

      return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: PARTNER_EVENT_SELECT });
    });
  }

  /**
   * 신청을 EVENT_CANCELED 로 종료하고 INSTANT 자리를 반환한다.
   *
   * 자리 반환을 점유와 대칭으로 두는 것이 IC-15 의 요구다. 여기서는 이벤트 자체가 죽으므로
   * `slotClaimed = true` 인 행 전부를 한 번에 내리고 Event.claimedCount 는 위에서 0 으로 맞췄다 —
   * 행마다 감산하면 같은 Event 행을 신청 수만큼 UPDATE 하게 되어 D-03 이 없앤 병목이 되살아난다.
   *
   * 신청은 다른 애그리게이트지만 서비스를 주입하지 않고 DB 로만 닿는다.
   * 이벤트가 죽었는데 신청이 살아 있으면 예약금 환불 큐가 대상을 찾지 못한다 — 같은 트랜잭션이어야 한다.
   */
  private async terminateApplications(tx: Tx, eventId: string): Promise<number> {
    return tx.$executeRaw`
      UPDATE "Application" a SET
        status = 'EVENT_CANCELED'::"ApplicationStatus",
        "cancelReason" = 'EVENT_CANCELED'::"ApplicationCancelReason",
        "canceledAt" = COALESCE(a."canceledAt", now()),
        "lastCanceledAt" = now(),
        "slotClaimed" = false,
        "version" = a."version" + 1,
        "updatedAt" = now()
      WHERE a."eventId" = ${eventId}
        AND a.status NOT IN ('CANCELED','EXPIRED','NOT_SELECTED','REJECTED','EVENT_CANCELED')
    `;
  }

  /**
   * 취소 알림을 아웃박스로 넣는다. (IC-42)
   *
   * 도메인 쓰기와 **같은 트랜잭션**이다. 커밋 후에 만들면 취소는 됐는데 알림은 안 나간 상태가
   * 영구히 남고, 그건 이벤트 취소에서 가장 나쁜 실패 모드다.
   * INSERT ... SELECT 로 DB 안에서 팬아웃하는 이유: 신청자 목록을 애플리케이션으로 꺼냈다 넣으면
   * 함수 메모리와 트랜잭션 시간이 신청자 수에 비례해 늘어난다.
   * ON CONFLICT DO NOTHING 은 IC-41 의 skipDuplicates 와 같은 뜻이다 — 재시도된 취소 요청이
   * 유니크 위반으로 **취소 자체를 롤백시키면** 안 된다.
   */
  private async enqueueCancelNotifications(
    tx: Tx,
    eventId: string,
    title: string,
  ): Promise<number> {
    const payload = { eventId, eventTitle: title };

    // D-07: 알림 payload 도 공개 응답과 같은 규칙을 받는다(IC-44).
    // "8만원에 밀리셨습니다" 같은 문구는 커트라인을 그대로 알려주는 것과 같으므로,
    // 금액·순위·커트라인이 들어가면 템플릿에 닿기 전에 여기서 터진다.
    assertNoVisibilityLeak(payload, 'EVENT_CANCELED 알림 payload');

    const titleKo = '예약이 취소되었습니다';
    const bodyKo = `'${title}' 이벤트가 취소되었습니다. 납부하신 예약금은 전액 환불됩니다.`;
    // 중복 제거 단위는 수신자별이다 — 전역 유니크면 이벤트 단위 키가 두 번째 수신자에서 충돌하고,
    // 그 위반이 도메인 트랜잭션 안에 있으므로 "이벤트 취소" 자체를 롤백시킨다.
    const dedupeKey = `EVENT_CANCELED:${eventId}`;

    // 파라미터에 ::text 를 붙이는 이유: INSERT ... SELECT 는 SELECT 를 먼저 해석하므로
    // 대상 컬럼 타입으로 추론이 흐르지 않는 경우가 있고, 그때 "could not determine data type"이 난다.
    return tx.$executeRaw`
      INSERT INTO "Notification"
        ("id","userId","type","category","priority","titleKo","bodyKo","payload",
         "deepLinkPath","eventId","dedupeKey","updatedAt")
      SELECT
        gen_random_uuid()::text,
        a."userId",
        'EVENT_CANCELED'::"NotificationType",
        'EVENT_CHANGE'::"NotificationCategory",
        'HIGH'::"NotificationPriority",
        ${titleKo}::text,
        ${bodyKo}::text,
        ${JSON.stringify(payload)}::jsonb,
        ${`/events/${eventId}`}::text,
        ${eventId}::text,
        ${dedupeKey}::text,
        now()
      FROM "Application" a
      WHERE a."eventId" = ${eventId}
        AND a.status = 'EVENT_CANCELED'::"ApplicationStatus"
      ON CONFLICT ("userId","dedupeKey") DO NOTHING
    `;
  }

  /**
   * 운영자 정지. (IC-62)
   *
   * 현재 status 를 statusBeforeSuspend 에 보관한 뒤 SUSPENDED 로 바꾼다.
   * 이미 SUSPENDED 인 이벤트를 다시 정지하지 않는 것이 핵심이다 — 그러면 원래 상태를 잃고
   * 해제할 때 무엇으로 되돌릴지 추측해야 한다. OPEN 으로 일괄 복구하면 마감된 이벤트가 되살아나
   * 신청을 다시 받고, CLOSED 로 일괄 복구하면 기간이 남은 이벤트가 조기 마감된다. 둘 다 못 되돌린다.
   *
   * If-Match 를 받지 않는 이유: 정지는 사고를 멈추는 조치다. 낡은 토큰 때문에 412 로 튕기면
   * 운영자가 재조회하는 동안 신청이 계속 들어온다. 대신 version 은 올려서 진행 중이던
   * 파트너 PATCH 는 확실히 무효화한다(IC-63).
   */
  async suspend(user: AuthenticatedUser, eventId: string, dto: SuspendEventDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.audit.lockChain(tx, eventId);
      await assertEventExists(tx, eventId);

      const affected = await tx.$executeRaw`
        UPDATE "Event" e SET
          "statusBeforeSuspend" = e.status,
          status = 'SUSPENDED'::"EventStatus",
          "suspendedAt" = now(),
          "suspendedReason" = ${dto.reason},
          "version" = e."version" + 1,
          "updatedAt" = now()
        WHERE e.id = ${eventId}
          AND e."deletedAt" IS NULL
          AND e.status <> 'SUSPENDED'
      `;

      assertAffected(affected, 1, 'EVENT_ALREADY_SUSPENDED');

      await this.audit.append(tx, {
        eventId,
        actorUserId: user.id,
        actorRole: AuditActorRole.ADMIN,
        actorLabel: actorLabelOf(user),
        action: AuditAction.EVENT_UNPUBLISHED,
        summary: `이벤트 정지: ${dto.reason}`.slice(0, 500),
      });

      return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: PARTNER_EVENT_SELECT });
    });
  }

  /** 정지 해제. statusBeforeSuspend 로 되돌리고 두 컬럼을 NULL 로 만든다. (IC-62) */
  async unsuspend(user: AuthenticatedUser, eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.audit.lockChain(tx, eventId);
      await assertEventExists(tx, eventId);

      const affected = await tx.$executeRaw`
        UPDATE "Event" e SET
          status = COALESCE(e."statusBeforeSuspend", 'CLOSED'::"EventStatus"),
          "statusBeforeSuspend" = NULL,
          "suspendedAt" = NULL,
          "suspendedReason" = NULL,
          "version" = e."version" + 1,
          "updatedAt" = now()
        WHERE e.id = ${eventId}
          AND e."deletedAt" IS NULL
          AND e.status = 'SUSPENDED'
      `;

      assertAffected(affected, 1, 'EVENT_NOT_SUSPENDED');

      await this.audit.append(tx, {
        eventId,
        actorUserId: user.id,
        actorRole: AuditActorRole.ADMIN,
        actorLabel: actorLabelOf(user),
        action: AuditAction.EVENT_RESTORED,
        summary: '이벤트 정지 해제',
      });

      return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: PARTNER_EVENT_SELECT });
    });
  }

  /**
   * 라이프사이클 스위퍼. Vercel Cron 이 분 단위로 때린다.
   *
   * 서버리스라 상주 프로세스가 없다 — "시작 시각이 되면 연다"를 타이머로 만들 수 없으므로
   * 크론이 상태를 따라잡는다. 각 단계는 배치 조건부 UPDATE 하나이고, 대상이 없으면 0행이다
   * (0행은 오류가 아니다). 자문 락을 잡지 않는 이유는 감사 행을 쓰지 않기 때문이다 —
   * AuditAction 에 "크론이 이벤트를 열었다"에 해당하는 값이 없고, 열거형을 늘리는 것은
   * 스키마 변경이라 여기서 할 수 없다. 대신 로그로 남긴다.
   */
  async runLifecycleSweep() {
    const opened = await this.prisma.$executeRaw`
      UPDATE "Event" e SET
        status = 'OPEN'::"EventStatus",
        "openedAt" = COALESCE(e."openedAt", now()),
        "rankingLockAt" = COALESCE(
          e."rankingLockAt",
          e."applyEndAt" + make_interval(
            mins => CASE WHEN e."depositRequired" THEN e."depositWindowMinutes" ELSE 0 END + 1
          )
        ),
        "version" = e."version" + 1,
        "updatedAt" = now()
      WHERE e.status = 'SCHEDULED'
        AND e."suspendedAt" IS NULL
        AND e."deletedAt" IS NULL
        AND now() >= e."applyStartAt"
        AND now() <  e."applyEndAt"
    `;

    // 열리기도 전에 마감이 지난 이벤트. 파트너가 예약해 두고 방치한 경우인데,
    // SCHEDULED 로 남겨두면 공개 목록(IC-51)에 영원히 "예정"으로 떠 있는다.
    const expiredBeforeOpen = await this.prisma.$executeRaw`
      UPDATE "Event" e SET
        status = 'CLOSED'::"EventStatus",
        "closedAt" = now(),
        "closeReason" = 'PERIOD_ENDED'::"EventCloseReason",
        "rankingLockAt" = COALESCE(
          e."rankingLockAt",
          e."applyEndAt" + make_interval(mins => 1)
        ),
        "version" = e."version" + 1,
        "updatedAt" = now()
      WHERE e.status = 'SCHEDULED'
        AND e."suspendedAt" IS NULL
        AND e."deletedAt" IS NULL
        AND now() >= e."applyEndAt"
    `;

    // IC-26 의 finalize 게이트. rankingLockAt 이 지났어도 **열린 홀드가 남아 있으면 닫지 않는다**.
    // 마감 1분 전 신청자도 예약금 10분을 온전히 쓴다는 D-04 의 약속이 정확히 이 술어다.
    const closed = await this.prisma.$executeRaw`
      UPDATE "Event" e SET
        status = 'CLOSED'::"EventStatus",
        "closedAt" = now(),
        "closeReason" = 'PERIOD_ENDED'::"EventCloseReason",
        "version" = e."version" + 1,
        "updatedAt" = now()
      WHERE e.status = 'OPEN'
        AND e."suspendedAt" IS NULL
        AND e."deletedAt" IS NULL
        AND now() >= e."applyEndAt"
        AND NOT EXISTS (
          SELECT 1 FROM "Deposit" d
          WHERE d."eventId" = e.id AND d.status = 'PENDING' AND d."dueAt" > now()
        )
    `;

    const result = { opened, expiredBeforeOpen, closed };
    this.logger.log(`이벤트 라이프사이클 스위퍼: ${JSON.stringify(result)}`);

    return result;
  }
}

/**
 * 대상 이벤트가 존재하는지 먼저 확인한다.
 *
 * 조건부 UPDATE 의 0행은 "없는 행"이 아니라 "전제가 깨졌다"는 뜻이라 409 로 올라간다(IC-01).
 * 그런데 운영자가 오타 난 id 로 정지를 걸면 그 409 는 "이미 정지됨"이라고 거짓말을 한다.
 * 존재 여부만 미리 갈라두면 404 와 409 가 각각 맞는 뜻을 갖는다.
 */
async function assertEventExists(tx: Tx, eventId: string): Promise<void> {
  const found = await tx.event.findFirst({
    where: { id: eventId, deletedAt: null },
    select: { id: true },
  });

  if (!found) throw new NotFoundException('이벤트를 찾을 수 없습니다.');
}
