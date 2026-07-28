import type { AuditAction, AuditActorRole, AuditTargetType, Prisma } from '@prisma/client';

/** 인터랙티브 트랜잭션 클라이언트. 이 모듈의 모든 쓰기 헬퍼가 이걸 받는다. */
export type Tx = Prisma.TransactionClient;

/**
 * 감사 체인 샤딩 키. (IC-61)
 *
 * 'global' 단일 체인이면 finalize 가 자문 락을 든 동안 플랫폼 전체의 감사 쓰기가
 * 뒤에 줄을 선다. 이벤트 단위로 쪼개면 finalize 는 자기 이벤트하고만 경합한다.
 */
export function eventChainKey(eventId: string): string {
  return `event:${eventId}`;
}

/** 이벤트에 매이지 않는 시스템 배치용 체인. */
export const SYSTEM_CHAIN_KEY = 'system:cron';

/**
 * 감사 체인 자문 락. **트랜잭션의 첫 문장이어야 한다.** (IC-02)
 *
 * 중간에서 잡으면 이미 확보한 행 락을 든 채로 대기하게 되어 잠금 순서 규칙이 깨진다.
 * 세션 락이 아니라 xact 락인 이유는 pgbouncer transaction 모드라 세션 상태가
 * 트랜잭션 밖으로 넘어가지 않기 때문이다.
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
  correlationId?: string | null;
}

/**
 * 해시 체인에 감사 행 하나를 잇는다. (IC-61)
 *
 * 대량 작업은 행마다 쓰지 않고 **집계 1행**만 쓴다 — SelectionEntry 200건에 감사 200행을
 * 쓰면 그 트랜잭션이 자문 락을 200배 오래 들고, 같은 이벤트의 다른 쓰기가 전부 막힌다.
 *
 * 체인의 첫 행에는 prev 가 없으므로 LEFT JOIN LATERAL 이다. INNER JOIN 이면 첫 행이
 * 아예 삽입되지 않아 체인이 시작조차 못 한다.
 */
export async function appendAuditLog(tx: Tx, entry: AuditEntry): Promise<void> {
  // rowHash 의 입력 문자열. 순위 컬럼이 아니라 감사 메타데이터라 TS 에서 만들어도 된다(IC-04 대상 아님).
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
       "summary","beforeJson","afterJson","reasonCode","reasonMemo","idempotencyKey","correlationId",
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
      ${entry.correlationId ?? null},
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
