import type { AuditAction, AuditActorRole, AuditTargetType, Prisma } from '@prisma/client';

/** 인터랙티브 트랜잭션 클라이언트. 이 모듈의 모든 쓰기 헬퍼가 이걸 받는다. */
export type Tx = Prisma.TransactionClient;

/**
 * 감사 체인 샤딩 키. (IC-61)
 *
 * 공지 발송은 이벤트 애그리게이트를 건드리지 않는데도 `event:{id}` 체인을 쓰면,
 * 100만 명짜리 공지가 페이지를 넘길 때마다 그 이벤트의 finalize 와 자문 락을 두고 경합한다.
 * 발송은 발송끼리만 줄 세우면 충분하다.
 */
export function broadcastChainKey(broadcastId: string): string {
  return `broadcast:${broadcastId}`;
}

/**
 * 감사 체인 자문 락. **트랜잭션의 첫 문장이어야 한다.** (IC-02)
 *
 * 중간에서 잡으면 이미 확보한 행 락을 든 채로 대기하게 되어 잠금 순서 규칙이 깨진다.
 * pgbouncer transaction 모드라 세션 락은 트랜잭션 밖으로 넘어가지 않는다 — 무조건 xact 락이다.
 */
export async function acquireAuditChainLock(tx: Tx, chainKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chainKey}))`;
}

export interface AuditEntry {
  actorUserId: string | null;
  actorRole: AuditActorRole;
  actorLabel: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  targetOwnerUserId?: string | null;
  summary: string;
  chainKey: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reasonCode?: string | null;
  reasonMemo?: string | null;
  /** 크론 재실행이 같은 행을 두 번 남기지 않게 하는 키. */
  idempotencyKey?: string | null;
}

/**
 * 해시 체인에 감사 행 하나를 잇는다. (IC-61)
 *
 * 이 모듈이 selection/admin 의 같은 이름 헬퍼를 재사용하지 않는 이유는 규칙이다 —
 * 모듈끼리는 DI 가 아니라 DB 로만 이어진다. 대신 **행 포맷과 해시 입력 문자열을 반드시
 * 동일하게** 유지해야 한다. 체인은 chainKey 별로 독립이지만 검증기는 하나이기 때문이다.
 *
 * 대량 발송에 수신자마다 감사 행을 쓰지 않는다. 페이지당 1행, 완료 시 1행이다 —
 * 20만 행을 쓰면 그 트랜잭션이 자문 락을 20만 배 오래 든다.
 *
 * 체인의 첫 행에는 prev 가 없으므로 LEFT JOIN LATERAL 이다. INNER JOIN 이면 첫 행이
 * 아예 삽입되지 않아 체인이 시작조차 못 한다.
 */
export async function appendAuditLog(tx: Tx, entry: AuditEntry): Promise<void> {
  const canonical = [
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.actorUserId ?? '',
    entry.actorRole,
    entry.summary,
  ].join('|');

  const before = entry.beforeJson === undefined ? null : JSON.stringify(entry.beforeJson);
  const after = entry.afterJson === undefined ? null : JSON.stringify(entry.afterJson);

  await tx.$executeRaw`
    INSERT INTO "AuditLog"
      ("id","actorUserId","actorRole","actorLabel","action","targetType","targetId","targetOwnerUserId",
       "summary","beforeJson","afterJson","reasonCode","reasonMemo","idempotencyKey",
       "chainKey","prevHash","rowHash","updatedAt")
    SELECT
      gen_random_uuid()::text,
      ${entry.actorUserId},
      ${entry.actorRole}::"AuditActorRole",
      ${entry.actorLabel.slice(0, 120)},
      ${entry.action}::"AuditAction",
      ${entry.targetType}::"AuditTargetType",
      ${entry.targetId},
      ${entry.targetOwnerUserId ?? null},
      ${entry.summary.slice(0, 500)},
      ${before}::jsonb,
      ${after}::jsonb,
      ${entry.reasonCode ?? null},
      ${entry.reasonMemo ?? null},
      ${entry.idempotencyKey ?? null},
      ${entry.chainKey},
      prev."rowHash",
      encode(sha256(convert_to(COALESCE(prev."rowHash", '') || ${canonical}, 'UTF8')), 'hex'),
      now()
    FROM (SELECT 1) d
    LEFT JOIN LATERAL (
      SELECT a."rowHash"
      FROM "AuditLog" a
      WHERE a."chainKey" = ${entry.chainKey}
      ORDER BY a.seq DESC
      LIMIT 1
    ) prev ON true
    ON CONFLICT ("idempotencyKey") DO NOTHING
  `;
}
