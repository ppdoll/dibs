import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeliverySkipReason,
  EmailSuppressionReason,
  NotificationCategory,
  NotificationPriority,
  Prisma,
  SuppressionScope,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ResendMailer } from './email/resend.mailer';
import {
  applyAdPrefix,
  renderEmailHtml,
  renderEmailText,
  type EmailBodyInput,
} from './email/email-body';
import { decideEmailDelivery } from './internal/delivery-gate';
import { DISPATCH_LEASE_SECONDS, retryDelaySeconds } from './notification-policy';

export interface DispatchResult {
  reclaimed: number;
  leased: number;
  sent: number;
  skipped: number;
  delayed: number;
  failed: number;
  /** 리스를 잡은 뒤 다른 경로(웹훅·공지 취소)가 상태를 바꿔 반영하지 못한 행. */
  stale: number;
}

/** 한 번의 크론 호출에서 처리할 최대 건수. Vercel 함수 타임아웃 안에 끝나야 한다. */
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

/** 발송에 필요한 것만 읽는다. 여기에 없는 컬럼은 발송 판단에 쓰이지 않는다는 뜻이다. */
const DISPATCH_SELECT = {
  id: true,
  toAddress: true,
  subjectKo: true,
  bodyText: true,
  idempotencyKey: true,
  attemptCount: true,
  maxAttempts: true,
  messageId: true,
  notification: {
    select: { category: true, priority: true, titleKo: true, bodyKo: true, deepLinkPath: true },
  },
  message: {
    select: { titleKo: true, bodyKo: true, broadcast: { select: { category: true } } },
  },
  recipient: {
    select: {
      status: true,
      deletedAt: true,
      marketingEmailAgreedAt: true,
      marketingEmailWithdrawnAt: true,
      notificationSetting: {
        select: { emailGloballyEnabled: true, nightMarketingConsentAt: true },
      },
      notificationPreferences: { select: { category: true, emailEnabled: true } },
    },
  },
} satisfies Prisma.EmailDeliverySelect;

type DispatchRow = Prisma.EmailDeliveryGetPayload<{ select: typeof DISPATCH_SELECT }>;

interface ActiveSuppression {
  scope: SuppressionScope;
  reason: EmailSuppressionReason;
}

/**
 * 이메일 아웃박스 디스패처. (IC-42, D-10)
 *
 * 도메인 트랜잭션은 `EmailDelivery(status='PENDING')` 행만 남기고 끝난다. 실제 발송은
 * 여기서만 일어난다 — 트랜잭션 안에서 Resend 를 부르면 커밋이 실패해도 메일은 이미 나가 있고,
 * "선정되셨습니다" 를 보낸 뒤 롤백되는 게 정확히 그 경우다.
 *
 * 상태기계:
 *
 * ```
 * PENDING ─lease─> SENDING ─┬─ ok ─────────> SENT ─(웹훅)─> DELIVERED / BOUNCED …
 *                           ├─ 게이트 차단 ─> SKIPPED (+ skipReason)
 *                           ├─ 일시 실패 ───> DELAYED (nextAttemptAt = 백오프)
 *                           └─ 영구 실패 ───> FAILED
 * ```
 *
 * at-least-once 전제다. Vercel Cron 은 겹쳐 실행되고 함수는 타임아웃으로 죽는다. 그래서
 * (a) 배치 클레임은 `FOR UPDATE SKIP LOCKED`, (b) 리스가 만료된 SENDING 행은 되살리고,
 * (c) 발송에는 행마다 고정된 `idempotencyKey` 를 실어 프로바이더가 중복을 흡수하게 한다.
 * 셋이 다 있어야 "죽어도 안 잃고, 겹쳐도 두 번 안 간다"가 된다.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: ResendMailer,
    config: ConfigService,
  ) {
    this.webAppUrl = config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
  }

  async dispatchPending(requestedLimit?: number): Promise<DispatchResult> {
    const limit = Math.min(Math.max(requestedLimit ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);

    const result: DispatchResult = {
      reclaimed: await this.reclaimStaleLeases(),
      leased: 0,
      sent: 0,
      skipped: 0,
      delayed: 0,
      failed: 0,
      stale: 0,
    };

    const leasedIds = await this.leaseBatch(limit);
    result.leased = leasedIds.length;
    if (leasedIds.length === 0) return result;

    // 개발 환경에는 Resend 키가 없다. 여기서 던지면 로컬에서 이 상태기계를 한 번도 못 돌려보고,
    // 그러면 프로덕션이 첫 실행이 된다. SKIPPED 로 기록하면 행은 남으므로 키를 넣은 뒤
    // 무엇이 안 나갔는지 그대로 보인다.
    if (!this.mailer.enabled) {
      for (const id of leasedIds) {
        const applied = await this.markSkipped(id, DeliverySkipReason.FEATURE_FLAG_OFF);
        if (applied) result.skipped += 1;
        else result.stale += 1;
      }
      this.logger.warn(`RESEND_API_KEY 미설정 — ${leasedIds.length}건을 SKIPPED 로 기록했습니다.`);
      return result;
    }

    const now = await this.dbNow();
    const rows = await this.prisma.emailDelivery.findMany({
      where: { id: { in: leasedIds } },
      select: DISPATCH_SELECT,
    });
    const suppressions = await this.loadSuppressions(
      rows.map((row) => row.toAddress),
      now,
    );

    for (const row of rows) {
      await this.dispatchOne(row, suppressions, now, result);
    }

    return result;
  }

  private async dispatchOne(
    row: DispatchRow,
    suppressions: Map<string, ActiveSuppression>,
    now: Date,
    result: DispatchResult,
  ): Promise<void> {
    const category =
      row.notification?.category ??
      row.message?.broadcast?.category ??
      NotificationCategory.MESSAGE;
    const priority = row.notification?.priority ?? NotificationPriority.NORMAL;
    const toAddress = row.toAddress;

    const skipReason = decideEmailDelivery({
      category,
      priority,
      toAddress,
      recipient: row.recipient,
      nightMarketingConsentAt: row.recipient?.notificationSetting?.nightMarketingConsentAt ?? null,
      emailGloballyEnabled: row.recipient?.notificationSetting?.emailGloballyEnabled ?? true,
      categoryEmailEnabled:
        row.recipient?.notificationPreferences.find((pref) => pref.category === category)
          ?.emailEnabled ?? true,
      suppression: toAddress ? (suppressions.get(toAddress) ?? null) : null,
      now,
    });

    // 주소가 없으면 게이트가 NO_EMAIL_ON_ACCOUNT 를 돌려준다. 이 분기 뒤에서는 toAddress 가 있다.
    if (skipReason || !toAddress) {
      const applied = await this.markSkipped(
        row.id,
        skipReason ?? DeliverySkipReason.NO_EMAIL_ON_ACCOUNT,
      );
      if (applied) result.skipped += 1;
      else result.stale += 1;
      return;
    }

    const body = this.buildBody(row, category);
    const outcome = await this.mailer.send({
      to: toAddress,
      subject: applyAdPrefix(body.titleKo, category).slice(0, 200),
      text: renderEmailText(body),
      html: renderEmailHtml(body),
      idempotencyKey: row.idempotencyKey,
    });

    if (outcome.ok) {
      const applied = await this.markSent(row.id, outcome.providerMessageId);
      if (applied) result.sent += 1;
      else result.stale += 1;
      return;
    }

    const canRetry = outcome.retryable && row.attemptCount < row.maxAttempts;
    const applied = canRetry
      ? await this.markDelayed(row.id, row.attemptCount, outcome.code, outcome.message)
      : await this.markFailed(row.id, outcome.code, outcome.message);

    if (!applied) result.stale += 1;
    else if (canRetry) result.delayed += 1;
    else result.failed += 1;
  }

  /**
   * 만료된 알림을 목록에서 내린다.
   *
   * 물리 삭제가 아니라 soft delete 다. 알림은 "언제 무엇을 통보했는가"의 증거이고,
   * 예약금·선정 통보는 분쟁이 붙으면 그게 유일한 근거다.
   */
  async sweepExpiredNotifications(): Promise<{ expired: number }> {
    const expired = await this.prisma.$executeRaw`
      UPDATE "Notification"
      SET "deletedAt" = now(), "updatedAt" = now()
      WHERE "expiresAt" IS NOT NULL AND "expiresAt" < now() AND "deletedAt" IS NULL
    `;

    return { expired };
  }

  /**
   * 리스가 만료된 SENDING 행을 되살린다.
   *
   * 함수가 발송 직후·상태 반영 직전에 죽으면 그 행은 SENDING 으로 굳고, 리스 시각이 없으면
   * 영원히 아무도 집지 않는다. 되살릴 때 이미 보내졌을 수 있지만 행마다 고정된
   * idempotencyKey 덕분에 프로바이더가 두 번째 요청을 흡수한다.
   */
  private async reclaimStaleLeases(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "EmailDelivery"
      SET status = 'DELAYED', "lockedUntil" = NULL, "nextAttemptAt" = now(), "updatedAt" = now()
      WHERE status = 'SENDING' AND "lockedUntil" IS NOT NULL AND "lockedUntil" < now()
    `;
  }

  /**
   * 배치 클레임. `FOR UPDATE SKIP LOCKED` 로 동시에 돈 크론끼리 서로 다른 행을 집는다.
   *
   * attemptCount 를 **집을 때** 올린다. 발송 뒤에 올리면 함수가 발송 도중 죽었을 때
   * 시도 횟수가 늘지 않아 같은 행을 무한히 재시도한다.
   */
  private async leaseBatch(limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "EmailDelivery" d
      SET status = 'SENDING',
          "lockedUntil" = now() + make_interval(secs => ${DISPATCH_LEASE_SECONDS}),
          "attemptCount" = d."attemptCount" + 1,
          "updatedAt" = now()
      WHERE d.id IN (
        SELECT c.id
        FROM "EmailDelivery" c
        WHERE c.status IN ('PENDING', 'QUEUED', 'DELAYED')
          AND (c."nextAttemptAt" IS NULL OR c."nextAttemptAt" <= now())
          AND (c."lockedUntil" IS NULL OR c."lockedUntil" < now())
          AND c."attemptCount" < c."maxAttempts"
        ORDER BY c."createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING d.id
    `;

    return rows.map((row) => row.id);
  }

  /** 한 배치는 하나의 시계를 쓴다. 야간 광고 판정이 행마다 갈리면 재현이 안 된다. */
  private async dbNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    return rows[0]?.now ?? new Date();
  }

  /**
   * 차단 목록은 **주소 기준**이다(userId 아님). 같은 사람이 주소를 바꾸면 다시 받을 수 있어야 하고,
   * 반대로 여러 계정이 한 주소를 쓰면 스팸 신고 한 번으로 전부 막혀야 한다.
   */
  private async loadSuppressions(
    addresses: (string | null)[],
    now: Date,
  ): Promise<Map<string, ActiveSuppression>> {
    const unique = [...new Set(addresses.filter((value): value is string => value !== null))];
    if (unique.length === 0) return new Map();

    const rows = await this.prisma.emailSuppression.findMany({
      where: {
        email: { in: unique },
        releasedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { email: true, scope: true, reason: true },
    });

    const map = new Map<string, ActiveSuppression>();
    for (const row of rows) {
      const existing = map.get(row.email);
      // 한 주소에 (MARKETING_ONLY, ALL) 두 행이 있을 수 있다. 더 센 쪽이 이긴다.
      if (!existing || existing.scope !== SuppressionScope.ALL) {
        map.set(row.email, { scope: row.scope, reason: row.reason });
      }
    }

    return map;
  }

  private buildBody(row: DispatchRow, category: NotificationCategory): EmailBodyInput {
    return {
      titleKo: row.subjectKo ?? row.notification?.titleKo ?? row.message?.titleKo ?? '알림',
      bodyKo: row.bodyText ?? row.notification?.bodyKo ?? row.message?.bodyKo ?? '',
      // 쪽지는 딥링크가 행에 없다. 수신함 상세로 보낸다.
      deepLinkPath:
        row.notification?.deepLinkPath ?? (row.messageId ? `/my/messages/${row.messageId}` : null),
      webAppUrl: this.webAppUrl,
      includeUnsubscribe: category === NotificationCategory.MARKETING,
    };
  }

  // --- 결과 반영 ---------------------------------------------------------
  // 전부 `status = 'SENDING'` 을 WHERE 에 달고 있다(IC-01). 리스를 잡은 뒤 웹훅이나 공지 취소가
  // 먼저 상태를 바꿨다면 이 UPDATE 는 0행이어야 하고, 그때 SENT 로 덮어쓰면 이미 확정된
  // BOUNCED 가 되살아난다. 0행은 던지지 않고 `stale` 로 센다 — 배치 워커가 행 하나 때문에
  // 통째로 죽으면 뒤의 수십 건이 리스 만료까지 멈춘다.

  private async markSkipped(id: string, reason: DeliverySkipReason): Promise<boolean> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "EmailDelivery"
      SET status = 'SKIPPED', "skipReason" = ${reason}::"DeliverySkipReason",
          "lockedUntil" = NULL, "nextAttemptAt" = NULL, "updatedAt" = now()
      WHERE id = ${id} AND status = 'SENDING'
    `;
    return affected === 1;
  }

  private async markSent(id: string, providerMessageId: string | null): Promise<boolean> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "EmailDelivery"
      SET status = 'SENT', "sentAt" = now(), "lockedUntil" = NULL, "nextAttemptAt" = NULL,
          "providerMessageId" = COALESCE(${providerMessageId}, "providerMessageId"),
          "failureCode" = NULL, "failureMessage" = NULL, "updatedAt" = now()
      WHERE id = ${id} AND status = 'SENDING'
    `;
    return affected === 1;
  }

  private async markDelayed(
    id: string,
    attemptCount: number,
    code: string,
    message: string,
  ): Promise<boolean> {
    const delaySeconds = retryDelaySeconds(attemptCount);
    const affected = await this.prisma.$executeRaw`
      UPDATE "EmailDelivery"
      SET status = 'DELAYED',
          "nextAttemptAt" = now() + make_interval(secs => ${delaySeconds}),
          "lockedUntil" = NULL,
          "failureCode" = ${code.slice(0, 100)},
          "failureMessage" = ${message.slice(0, 1000)},
          "updatedAt" = now()
      WHERE id = ${id} AND status = 'SENDING'
    `;
    return affected === 1;
  }

  private async markFailed(id: string, code: string, message: string): Promise<boolean> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "EmailDelivery"
      SET status = 'FAILED', "lockedUntil" = NULL, "nextAttemptAt" = NULL,
          "failureCode" = ${code.slice(0, 100)},
          "failureMessage" = ${message.slice(0, 1000)},
          "updatedAt" = now()
      WHERE id = ${id} AND status = 'SENDING'
    `;
    return affected === 1;
  }
}
