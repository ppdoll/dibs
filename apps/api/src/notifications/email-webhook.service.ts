import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DeliveryStatus, EmailSuppressionReason, SuppressionScope } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { verifySvixSignature, type SvixHeaders } from './email/svix-signature';

/** 소프트 바운스가 몇 번 쌓이면 차단할 것인가. 일시 장애 몇 번으로 주소를 죽이면 안 된다. */
const SOFT_BOUNCE_THRESHOLD = 3;

/**
 * 상태 등급. **오직 올라가는 방향으로만** 반영한다. (IC-43)
 *
 * 프로바이더 웹훅은 재전송·역순 도착이 정상 동작이다. 시각 가드만 두면 같은 밀리초에
 * 도착한 두 이벤트에서 순서가 뒤집힐 수 있어서 등급 가드가 **함께** 필요하다.
 * SQL 쪽 `ELSE 99` 는 종착 상태(FAILED/SKIPPED/CANCELED/BOUNCED/COMPLAINED)를 뜻하며
 * 어떤 진행 이벤트로도 되돌리지 못한다. 이 표와 아래 SQL 의 CASE 는 **같이 고쳐야 한다**.
 */
const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  QUEUED: 1,
  SENDING: 2,
  DELAYED: 3,
  SENT: 4,
  DELIVERED: 5,
};

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; subType?: string; message?: string };
    reason?: string;
  };
}

export interface WebhookOutcome {
  applied: boolean;
  reason: string;
}

/**
 * Resend 배달 웹훅. (IC-43)
 *
 * 이 경로는 **인증 없이 열린 유일한 쓰기 엔드포인트**다. 그래서 방어가 세 겹이다.
 *   1. 서명 검증 — 원문 바이트에 대한 HMAC. 실패하면 401.
 *   2. 시각 가드 — `lastProviderEventAt` 보다 오래된 이벤트는 무시.
 *   3. 등급 가드 — 재생된 'sent' 가 'delivered' 를, 'delivered' 가 'bounced' 를 못 덮는다.
 *
 * 2번만 있으면 왜 부족한지가 이 규칙의 핵심이다: 같은 밀리초의 두 이벤트에서 순서가 뒤집히면
 * 재생된 delivered 가 bounced 를 덮고, 그러면 `EmailSuppression` 이 풀린 것처럼 보여
 * 재시도 스윕이 죽은 주소로 계속 발송한다. 도메인 발송 평판은 그렇게 깎인다.
 *
 * 서명이 맞기만 하면 알 수 없는 이벤트에도 200 을 준다. 4xx 를 돌려주면 Svix 가 몇 시간 동안
 * 같은 요청을 재전송하고, 그 사이 진짜 이벤트가 큐 뒤에 밀린다.
 */
@Injectable()
export class EmailWebhookService {
  private readonly logger = new Logger(EmailWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(headers: SvixHeaders, rawBody: string): Promise<WebhookOutcome> {
    // CronGuard 가 CRON_SECRET 을 다루는 방식과 같다 — 검증 스키마(env.schema.ts)에 없는
    // 시크릿이라 process.env 에서 직접 읽고, 없으면 요청 시점에 거부한다.
    const secret = process.env.RESEND_WEBHOOK_SECRET;

    if (!secret) {
      // 시크릿을 안 걸어두면 아무나 배달 상태를 조작할 수 있다. 열어주느니 막는다. (CronGuard 와 같은 판단)
      this.logger.error('RESEND_WEBHOOK_SECRET 이 설정되지 않아 웹훅을 거부합니다.');
      throw new UnauthorizedException();
    }

    const verified = verifySvixSignature(secret, headers, rawBody, new Date());
    if (!verified.ok) {
      this.logger.warn(`웹훅 서명 검증 실패: ${verified.reason}`);
      throw new UnauthorizedException();
    }

    const event = parseEvent(rawBody);
    if (!event) return { applied: false, reason: 'UNPARSEABLE_BODY' };

    const emailId = event.data?.email_id;
    if (!emailId) return { applied: false, reason: 'NO_EMAIL_ID' };

    const eventAt = event.created_at ? new Date(event.created_at) : new Date();
    if (Number.isNaN(eventAt.getTime())) return { applied: false, reason: 'INVALID_CREATED_AT' };

    if (event.type === 'email.opened' || event.type === 'email.clicked') {
      return this.recordOpen(emailId, eventAt);
    }

    const mapped = mapStatus(event.type);
    if (!mapped) return { applied: false, reason: `UNHANDLED_TYPE:${event.type}` };

    const failureMessage =
      event.data?.bounce?.message ?? event.data?.reason ?? (mapped.terminal ? event.type : null);

    const applied = await this.applyStatus(emailId, mapped, eventAt, failureMessage);

    // 차단 등록은 상태 반영이 실제로 일어났을 때만 한다. 재생된 bounce 로 차단을 다시 켜면
    // 운영자가 손으로 푼 주소(releasedAt)가 조용히 되막힌다.
    if (applied && mapped.suppress) {
      await this.recordSuppression(emailId, event);
    }

    return { applied, reason: applied ? mapped.status : 'SUPERSEDED_BY_NEWER_EVENT' };
  }

  /**
   * 열람은 상태를 바꾸지 않는다.
   *
   * `lastProviderEventAt` 도 건드리지 않는다 — 열람 이벤트가 그 시각을 밀어 올리면
   * 뒤늦게 도착한 delivered/bounced 가 시각 가드에 걸려 영영 반영되지 않는다.
   */
  private async recordOpen(emailId: string, eventAt: Date): Promise<WebhookOutcome> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "EmailDelivery"
      SET "openedAt" = ${eventAt}, "updatedAt" = now()
      WHERE "providerMessageId" = ${emailId} AND "openedAt" IS NULL
    `;

    return { applied: affected === 1, reason: affected === 1 ? 'OPENED' : 'ALREADY_OPENED' };
  }

  private async applyStatus(
    emailId: string,
    mapped: MappedStatus,
    eventAt: Date,
    failureMessage: string | null,
  ): Promise<boolean> {
    const rank = STATUS_RANK[mapped.status] ?? 99;
    const terminal = mapped.terminal;
    const isDelivered = mapped.status === DeliveryStatus.DELIVERED;
    const isSent = mapped.status === DeliveryStatus.SENT;
    const message = failureMessage?.slice(0, 1000) ?? null;

    // 같은 값을 여러 번 보간해도 자리마다 별개의 바인드 파라미터가 된다.
    // 하나를 재사용하면 Postgres 가 "$2 의 타입을 enum 으로도 text 로도 추론"하려다 실패한다.
    const affected = await this.prisma.$executeRaw`
      UPDATE "EmailDelivery" d
      SET status = ${mapped.status}::"DeliveryStatus",
          "lastProviderEventAt" = ${eventAt}::timestamptz,
          "deliveredAt" = CASE WHEN ${isDelivered}::boolean
                               THEN ${eventAt}::timestamptz ELSE d."deliveredAt" END,
          "sentAt" = CASE WHEN ${isSent}::boolean
                          THEN COALESCE(d."sentAt", ${eventAt}::timestamptz) ELSE d."sentAt" END,
          "failureCode" = CASE WHEN ${terminal}::boolean
                               THEN ${mapped.status}::text ELSE d."failureCode" END,
          "failureMessage" = CASE WHEN ${terminal}::boolean
                                  THEN ${message}::text ELSE d."failureMessage" END,
          "lockedUntil" = NULL,
          "nextAttemptAt" = CASE WHEN ${terminal}::boolean THEN NULL ELSE d."nextAttemptAt" END,
          "updatedAt" = now()
      WHERE d."providerMessageId" = ${emailId}
        AND (d."lastProviderEventAt" IS NULL OR ${eventAt}::timestamptz > d."lastProviderEventAt")
        AND d.status NOT IN ('BOUNCED', 'COMPLAINED')
        AND (
          ${terminal}::boolean
          OR (CASE d.status
                WHEN 'PENDING'   THEN 0
                WHEN 'QUEUED'    THEN 1
                WHEN 'SENDING'   THEN 2
                WHEN 'DELAYED'   THEN 3
                WHEN 'SENT'      THEN 4
                WHEN 'DELIVERED' THEN 5
                ELSE 99
              END) < ${rank}::int
        )
    `;

    return affected === 1;
  }

  /**
   * 바운스·스팸 신고를 주소 차단으로 옮긴다.
   *
   * 영구 바운스와 스팸 신고는 즉시 전면 차단(scope=ALL)이다. 일시 바운스는 세 번 쌓일 때까지
   * 마케팅만 막는다 — 수신함이 잠깐 가득 찼다는 이유로 예약금 안내를 영구히 끊으면
   * 사용자가 자리와 돈을 잃는다.
   */
  private async recordSuppression(emailId: string, event: ResendEvent): Promise<void> {
    const delivery = await this.prisma.emailDelivery.findFirst({
      where: { providerMessageId: emailId },
      select: { toAddress: true, recipientUserId: true },
    });

    const email = delivery?.toAddress ?? firstAddress(event.data?.to);
    if (!email) return;

    const complaint = event.type === 'email.complained';
    const permanent = complaint || (event.data?.bounce?.type ?? '').toLowerCase() !== 'transient';

    const scope = permanent ? SuppressionScope.ALL : SuppressionScope.MARKETING_ONLY;
    const reason = complaint
      ? EmailSuppressionReason.SPAM_COMPLAINT
      : permanent
        ? EmailSuppressionReason.HARD_BOUNCE
        : EmailSuppressionReason.SOFT_BOUNCE_THRESHOLD;

    // (email, scope) 유니크. 같은 주소가 여러 번 튕기면 bounceCount 만 오른다.
    await this.prisma.emailSuppression.upsert({
      where: { email_scope: { email, scope } },
      create: {
        email,
        scope,
        reason,
        userId: delivery?.recipientUserId ?? null,
        sourceProviderEventId: emailId,
        bounceCount: 1,
      },
      update: {
        bounceCount: { increment: 1 },
        // 운영자가 손으로 풀어 둔 주소가 다시 튕겼다면 차단이 되살아나야 한다.
        releasedAt: null,
        reason,
        sourceProviderEventId: emailId,
      },
    });

    if (permanent) return;

    // 소프트 바운스가 임계치를 넘으면 전면 차단으로 승격한다.
    const soft = await this.prisma.emailSuppression.findUnique({
      where: { email_scope: { email, scope: SuppressionScope.MARKETING_ONLY } },
      select: { bounceCount: true },
    });

    if ((soft?.bounceCount ?? 0) >= SOFT_BOUNCE_THRESHOLD) {
      await this.prisma.emailSuppression.upsert({
        where: { email_scope: { email, scope: SuppressionScope.ALL } },
        create: {
          email,
          scope: SuppressionScope.ALL,
          reason: EmailSuppressionReason.SOFT_BOUNCE_THRESHOLD,
          userId: delivery?.recipientUserId ?? null,
          sourceProviderEventId: emailId,
          bounceCount: soft?.bounceCount ?? SOFT_BOUNCE_THRESHOLD,
        },
        update: { bounceCount: soft?.bounceCount ?? SOFT_BOUNCE_THRESHOLD, releasedAt: null },
      });
    }
  }
}

interface MappedStatus {
  status: DeliveryStatus;
  /** 종착 실패 상태인가. 등급 가드를 건너뛰고 항상 반영된다. */
  terminal: boolean;
  suppress: boolean;
}

function mapStatus(type: string): MappedStatus | null {
  switch (type) {
    case 'email.sent':
      return { status: DeliveryStatus.SENT, terminal: false, suppress: false };
    case 'email.delivered':
      return { status: DeliveryStatus.DELIVERED, terminal: false, suppress: false };
    case 'email.delivery_delayed':
      return { status: DeliveryStatus.DELAYED, terminal: false, suppress: false };
    case 'email.bounced':
      return { status: DeliveryStatus.BOUNCED, terminal: true, suppress: true };
    case 'email.complained':
      return { status: DeliveryStatus.COMPLAINED, terminal: true, suppress: true };
    case 'email.failed':
      return { status: DeliveryStatus.FAILED, terminal: true, suppress: false };
    default:
      return null;
  }
}

function parseEvent(rawBody: string): ResendEvent | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const event = parsed as ResendEvent;
    return typeof event.type === 'string' ? event : null;
  } catch {
    return null;
  }
}

function firstAddress(to: string[] | string | undefined): string | null {
  if (typeof to === 'string') return to;
  if (Array.isArray(to)) return to[0] ?? null;
  return null;
}
