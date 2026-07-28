import { Injectable } from '@nestjs/common';
import { Prisma, type AuditAction, type AuditActorRole, type AuditTargetType } from '@prisma/client';

/** 트랜잭션 클라이언트. 감사 행은 언제나 도메인 쓰기와 같은 트랜잭션에 든다. (IC-61) */
export type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  actorUserId: string | null;
  actorRole: AuditActorRole;
  /** 사람이 읽는 행위자 표시. 계정이 지워져도 누구였는지 남아야 한다. */
  actorLabel: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  /** 대상 소유자. 파트너 행이면 파트너 계정의 userId. */
  targetOwnerUserId?: string | null;
  summary: string;
  beforeJson?: Prisma.JsonValue | null;
  afterJson?: Prisma.JsonValue | null;
  reasonCode?: string | null;
  /** 한 요청이 만든 여러 감사 행을 묶는다(예: 시설 생성 + 이미지 등록). */
  correlationId?: string | null;
}

/**
 * 감사 체인 기록기. (IC-61 / IC-02)
 *
 * 이 모듈이 만지는 대상(PARTNER_PROFILE / BUSINESS / VENUE / VENUE_IMAGE)은
 * 이벤트 애그리게이트가 아니므로 체인은 **targetType 단위**로 샤딩한다.
 * 'global' 단일 체인이면 이벤트 확정 트랜잭션이 자문 락을 든 동안 시설 수정까지 줄을 선다.
 *
 * prevHash 는 DB 안에서 직전 행을 읽어 채운다. TS 로 꺼냈다 넣으면 두 인스턴스가
 * 같은 prevHash 를 읽어 체인이 갈라지는데, 그건 append-only 트리거가 잡아주지 못한다
 * (트리거는 커밋된 행만 본다). 그래서 자문 락이 트랜잭션의 **첫 문장**이어야 한다.
 */
@Injectable()
export class PartnerAuditService {
  /** targetType 그대로가 체인 키다. 락 키와 체인 키는 반드시 같은 문자열이어야 한다. */
  chainKeyFor(targetType: AuditTargetType): string {
    return targetType;
  }

  /**
   * 트랜잭션의 첫 문장으로 호출한다. (IC-02)
   * 세션 락이 아니라 xact 락인 이유는 pgbouncer transaction 모드라 세션 상태가 넘어가지 않아서다.
   */
  async lockChain(tx: Tx, chainKey: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chainKey}))`;
  }

  /**
   * 감사 행 1개를 체인에 잇는다.
   *
   * 체인의 첫 행은 prevHash 가 NULL 이어야 하므로 LEFT JOIN LATERAL 이다
   * (INNER JOIN 이면 최초 1행이 영원히 안 들어간다).
   * `updatedAt` 을 명시하는 이유: Prisma 의 @updatedAt 은 클라이언트 쪽 기능이라
   * raw INSERT 에는 DB 기본값이 없다 — 빼면 NOT NULL 위반이다.
   */
  async append(tx: Tx, entry: AuditEntry): Promise<void> {
    const chainKey = this.chainKeyFor(entry.targetType);
    const canonical = canonicalize(entry);

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
        ${entry.targetType}::"AuditTargetType",
        ${entry.targetId},
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

/**
 * 해시에 들어갈 정규 문자열.
 * 필드 순서와 구분자를 고정한다 — 나중에 체인을 재검증할 때 같은 규칙으로 다시 만들어야 한다.
 */
function canonicalize(entry: AuditEntry): string {
  return [
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.actorUserId ?? '',
    entry.actorRole,
    entry.summary,
  ].join('|');
}

function toJsonParam(value: Prisma.JsonValue | null | undefined): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}
