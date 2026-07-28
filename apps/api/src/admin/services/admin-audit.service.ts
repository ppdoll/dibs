import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditActorRole,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { actorLabel, assertAffected, auditChainKey, toJsonParam } from '../admin.internals';

/** 감사 행 1개분. 대량 작업은 행마다 쓰지 않고 집계 1행으로 남긴다 (IC-61). */
export interface AuditEntry {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  /** 대상의 소유자. 나중에 "이 사람에 대해 무슨 일이 있었나"를 역추적할 때 쓴다. */
  targetOwnerUserId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  reasonCode?: string | null;
  reasonMemo?: string | null;
  correlationId?: string | null;
  /** 크론·배치 재실행이 두 번 적용되지 않게 하는 키. AuditLog.idempotencyKey 는 전역 유니크다. */
  idempotencyKey?: string | null;
  /** 지정하지 않으면 targetType 샤드. 이벤트에 매달린 것은 `event:{id}` 를 넘긴다. */
  chainKey?: string;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 감사 체인 샤드의 자문 락. **트랜잭션의 첫 문장이어야 한다.** (IC-61 ★ / IC-02)
   *
   * 중간에서 잡으면 이미 쥔 행 락을 든 채 대기하게 되어 락 순서 규칙이 깨지고,
   * finalize 트랜잭션과 만나는 순간 데드락이다. Vercel 함수 타임아웃 안에서는
   * 재시도조차 못 하고 500이 나간다.
   *
   * 세션 락(pg_advisory_lock)이 아니라 xact 락인 이유는 pgbouncer transaction 모드다 —
   * 세션 단위 상태는 트랜잭션 밖으로 넘어가지 못한다.
   */
  async lock(tx: Prisma.TransactionClient, chainKey: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chainKey}))`;
  }

  /** 이벤트 샤드 락. `event:{eventId}` 체인을 쓰는 트랜잭션의 첫 문장. */
  lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
    return this.lock(tx, auditChainKey(AuditTargetType.EVENT, eventId));
  }

  /**
   * 감사 행을 체인에 잇는다. 반드시 `lock()` 을 먼저 잡은 트랜잭션 안에서 호출한다.
   *
   * 체인의 첫 행은 prev 가 없으므로 LEFT JOIN LATERAL 이다. INNER JOIN 이면
   * 새 샤드의 첫 행이 조용히 0행 삽입으로 사라진다.
   */
  async append(
    tx: Prisma.TransactionClient,
    admin: AuthenticatedUser | null,
    entry: AuditEntry,
  ): Promise<void> {
    const chainKey = entry.chainKey ?? auditChainKey(entry.targetType);
    const actorRole = admin ? AuditActorRole.ADMIN : AuditActorRole.SYSTEM;
    const label = admin ? actorLabel(admin) : 'SYSTEM';

    const beforeJson = toJsonParam(entry.before);
    const afterJson = toJsonParam(entry.after);

    // rowHash 원문. 필드 순서를 여기서 고정한다 — 순서가 흔들리면 과거 체인을
    // 재계산할 수 없고, 그러면 해시가 증명할 수 있는 게 아무것도 없다.
    const payload = [
      entry.action,
      entry.targetType,
      entry.targetId,
      admin?.id ?? '',
      entry.summary,
      beforeJson ?? '',
      afterJson ?? '',
      entry.reasonCode ?? '',
    ].join('|');

    const affected = await tx.$executeRaw`
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "actorRole", "actorLabel", "action",
        "targetType", "targetId", "targetOwnerUserId", "summary",
        "beforeJson", "afterJson", "reasonCode", "reasonMemo",
        "correlationId", "idempotencyKey", "chainKey", "prevHash", "rowHash", "updatedAt"
      )
      SELECT
        gen_random_uuid()::text,
        ${admin?.id ?? null},
        ${actorRole}::"AuditActorRole",
        ${label},
        ${entry.action}::"AuditAction",
        ${entry.targetType}::"AuditTargetType",
        ${entry.targetId},
        ${entry.targetOwnerUserId ?? null},
        ${entry.summary.slice(0, 500)},
        ${beforeJson}::jsonb,
        ${afterJson}::jsonb,
        ${entry.reasonCode ?? null},
        ${entry.reasonMemo?.slice(0, 1000) ?? null},
        ${entry.correlationId ?? null},
        ${entry.idempotencyKey ?? null},
        ${chainKey},
        prev."rowHash",
        encode(sha256(convert_to(COALESCE(prev."rowHash", '') || ${payload}, 'UTF8')), 'hex'),
        now()
      FROM (SELECT 1) d
      LEFT JOIN LATERAL (
        SELECT a."rowHash"
        FROM "AuditLog" a
        WHERE a."chainKey" = ${chainKey}
        ORDER BY a.seq DESC
        LIMIT 1
      ) prev ON true
    `;

    assertAffected(affected, 1, 'AUDIT_APPEND_FAILED');
  }
}
