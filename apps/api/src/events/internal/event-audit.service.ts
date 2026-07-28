import { Injectable } from '@nestjs/common';
import {
  AuditActorRole,
  AuditTargetType,
  Prisma,
  type AuditAction,
} from '@prisma/client';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/** 트랜잭션 클라이언트. 감사 행은 언제나 도메인 쓰기와 같은 트랜잭션에 든다. (IC-61) */
export type Tx = Prisma.TransactionClient;

export interface EventAuditEntry {
  /** 감사 체인의 샤드 키가 되는 이벤트. 이벤트 애그리게이트는 항상 자기 체인을 쓴다. */
  eventId: string;
  actorUserId: string | null;
  actorRole: AuditActorRole;
  actorLabel: string;
  action: AuditAction;
  /** EVENT 아니면 EVENT_IMAGE. 체인 키는 targetType 이 아니라 eventId 로 샤딩한다. */
  targetType?: AuditTargetType;
  /** 기본값은 eventId. 이미지 행이면 그 이미지 id. */
  targetId?: string;
  targetOwnerUserId?: string | null;
  summary: string;
  beforeJson?: Prisma.JsonValue | null;
  afterJson?: Prisma.JsonValue | null;
  reasonCode?: string | null;
  correlationId?: string | null;
}

/**
 * 이벤트 애그리게이트의 감사 체인. (IC-61 / IC-02)
 *
 * 체인 키를 `event:<eventId>` 로 샤딩한다. 'global' 단일 체인이면 순위 확정 트랜잭션이
 * 자문 락을 든 동안 플랫폼 전체의 감사 쓰기 — 파트너 승인도, 로그인 감사도 — 가 뒤에 줄을 선다.
 * 샤딩하면 이 이벤트를 만지는 트랜잭션끼리만 경합한다.
 *
 * prevHash 를 TS 로 읽어다 넣지 않고 DB 안에서 잇는 이유: 두 인스턴스가 같은 prevHash 를
 * 읽으면 체인이 조용히 갈라지는데 append-only 트리거는 커밋된 행만 보므로 그걸 못 잡는다.
 * 그래서 자문 락이 트랜잭션의 **첫 문장**이어야 한다(IC-02: 자문 락 → Event → Application 순).
 */
@Injectable()
export class EventAuditService {
  /** 락 키와 체인 키는 반드시 같은 문자열이어야 한다. 한 곳에서만 만든다. */
  chainKeyFor(eventId: string): string {
    return `event:${eventId}`;
  }

  /** 트랜잭션의 첫 문장으로 호출한다. 세션 락이 아니라 xact 락인 이유는 pgbouncer transaction 모드다. */
  async lockChain(tx: Tx, eventId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.chainKeyFor(eventId)}))`;
  }

  /**
   * 감사 행 1개를 체인에 잇는다.
   *
   * 체인의 첫 행은 prevHash 가 NULL 이어야 하므로 LEFT JOIN LATERAL 이다
   * (INNER JOIN 이면 그 체인의 최초 1행이 영원히 안 들어간다).
   * `updatedAt` 을 명시하는 이유: Prisma 의 @updatedAt 은 클라이언트 쪽 기능이라
   * raw INSERT 에는 DB 기본값이 없다 — 빼면 NOT NULL 위반이다.
   */
  async append(tx: Tx, entry: EventAuditEntry): Promise<void> {
    const chainKey = this.chainKeyFor(entry.eventId);
    const targetType = entry.targetType ?? AuditTargetType.EVENT;
    const targetId = entry.targetId ?? entry.eventId;
    const canonical = [
      entry.action,
      targetType,
      targetId,
      entry.actorUserId ?? '',
      entry.actorRole,
      entry.summary,
    ].join('|');

    await tx.$executeRaw`
      INSERT INTO "AuditLog"
        ("id","actorUserId","actorRole","actorLabel","action","targetType","targetId",
         "targetOwnerUserId","summary","beforeJson","afterJson","reasonCode","correlationId",
         "chainKey","prevHash","rowHash","updatedAt")
      SELECT
        gen_random_uuid()::text,
        ${entry.actorUserId},
        ${entry.actorRole}::"AuditActorRole",
        ${entry.actorLabel},
        ${entry.action}::"AuditAction",
        ${targetType}::"AuditTargetType",
        ${targetId},
        ${entry.targetOwnerUserId ?? null},
        ${entry.summary},
        ${toJsonParam(entry.beforeJson)}::jsonb,
        ${toJsonParam(entry.afterJson)}::jsonb,
        ${entry.reasonCode ?? null},
        ${entry.correlationId ?? null},
        ${chainKey},
        prev."rowHash",
        encode(sha256(convert_to(COALESCE(prev."rowHash",'') || ${canonical}, 'UTF8')), 'hex'),
        now()
      FROM (SELECT 1) d
      LEFT JOIN LATERAL (
        SELECT a."rowHash" FROM "AuditLog" a
        WHERE a."chainKey" = ${chainKey}
        ORDER BY a.seq DESC
        LIMIT 1
      ) prev ON true
    `;
  }
}

/** 감사 로그의 actorLabel. 계정이 지워져도 누구였는지 남아야 한다. */
export function actorLabelOf(user: AuthenticatedUser): string {
  return `${user.displayName}<${user.email ?? 'no-email'}>`.slice(0, 120);
}

function toJsonParam(value: Prisma.JsonValue | null | undefined): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}
