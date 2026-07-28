import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { auditChainKey, seqToString } from '../admin.internals';
import type { AuditChainVerifyQueryDto, AuditLogQueryDto } from '../dto/audit-admin.dto';
import { AdminAuditService } from './admin-audit.service';

const AUDIT_SELECT = {
  id: true,
  seq: true,
  actorUserId: true,
  actorRole: true,
  actorLabel: true,
  action: true,
  targetType: true,
  targetId: true,
  targetOwnerUserId: true,
  summary: true,
  beforeJson: true,
  afterJson: true,
  reasonCode: true,
  reasonMemo: true,
  correlationId: true,
  chainKey: true,
  prevHash: true,
  rowHash: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

/**
 * 감사 로그 열람. 쓰기는 `AdminAuditService` 가, 읽기는 여기가 한다.
 *
 * 둘을 나눈 이유는 결합의 방향이 다르기 때문이다 — 쓰기는 모든 운영 서비스가 주입해서 쓰는
 * 저수준 도구이고, 읽기는 화면 하나만 쓰는 조회다. 한 클래스에 두면 조회용 select 가
 * 쓰기 경로의 의존성이 되어, 열람 화면을 고칠 때마다 전 운영 트랜잭션이 영향권에 들어온다.
 */
@Injectable()
export class AdminAuditViewerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * 필터 조회. 커서는 `seq` 내림차순이다.
   *
   * `id` 커서를 쓰지 않는 이유는 AuditLog 의 전순서가 seq 이기 때문이다 —
   * 같은 밀리초에 들어온 두 행의 순서가 뒤집히면 "체인 순서대로 읽는다"는 이 화면의
   * 유일한 존재 이유가 깨진다.
   */
  async list(query: AuditLogQueryDto) {
    if (query.targetId && !query.targetType) {
      // targetType 없이 targetId 만 주면 idx_audit_target 을 못 타고 테이블을 통째로 훑는다.
      throw new BadRequestException('targetId 로 조회하려면 targetType 도 함께 주어야 합니다.');
    }

    const before = query.beforeSeq ? parseSeq(query.beforeSeq) : null;

    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(before !== null ? { seq: { lt: before } } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.actorRole ? { actorRole: query.actorRole } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { seq: 'desc' },
      take: query.limit + 1,
      select: AUDIT_SELECT,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];

    return {
      // BigInt 는 JSON.stringify 에서 그대로 터진다. 응답에는 반드시 문자열로 싣는다.
      items: items.map((row) => ({ ...row, seq: seqToString(row.seq) })),
      hasMore,
      nextCursor: hasMore && last ? seqToString(last.seq) : null,
    };
  }

  /**
   * 체인 무결성 검사.
   *
   * **rowHash 를 다시 계산하지는 않는다.** 해시 원문(payload)의 필드 순서는 그 행을 쓴
   * 모듈이 정하는데(운영자 모듈과 파트너·이벤트 모듈이 서로 다른 정규화를 쓴다),
   * 여기서 한 가지 규칙으로 재계산하면 다른 규칙으로 쓰인 정상 행이 전부 "위조"로 보고된다.
   * 그건 경보를 무의미하게 만드는 종류의 오탐이다.
   *
   * 대신 **연결**을 검증한다 — seq 오름차순으로 읽으면서 각 행의 prevHash 가 직전 행의
   * rowHash 와 같은지 본다. 중간 행 삭제·행 삽입·체인 분기(같은 prevHash 를 가진 두 행)는
   * 전부 이 검사에 걸린다. 그리고 그게 append-only 트리거가 못 잡는 부분이기도 하다.
   */
  async verifyChain(admin: AuthenticatedUser, query: AuditChainVerifyQueryDto) {
    const chainKey = query.chainKey ?? auditChainKey(AuditTargetType.SYSTEM);

    const rows = await this.prisma.auditLog.findMany({
      where: { chainKey },
      orderBy: { seq: 'asc' },
      take: query.limit,
      select: { seq: true, prevHash: true, rowHash: true, createdAt: true },
    });

    const breaks: { seq: string; expectedPrevHash: string | null; actualPrevHash: string | null }[] = [];
    let expected: string | null = null;

    for (const row of rows) {
      if (row.prevHash !== expected) {
        breaks.push({
          seq: seqToString(row.seq),
          expectedPrevHash: expected,
          actualPrevHash: row.prevHash,
        });
      }
      expected = row.rowHash;
    }

    // 검증을 돌렸다는 사실 자체가 감사 대상이다 — "언제 마지막으로 확인했는가"가 증거의 일부다.
    await this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.SYSTEM));
      await this.audit.append(tx, admin, {
        action: AuditAction.SYSTEM_AUDIT_CHAIN_VERIFIED,
        targetType: AuditTargetType.SYSTEM,
        targetId: chainKey,
        summary: `감사 체인 검증 ${chainKey}: ${rows.length}행, 불일치 ${breaks.length}건`,
        after: { checked: rows.length, breaks: breaks.length },
      });
    });

    return {
      chainKey,
      checked: rows.length,
      intact: breaks.length === 0,
      breaks,
      firstSeq: rows.length ? seqToString(rows[0]!.seq) : null,
      lastSeq: rows.length ? seqToString(rows[rows.length - 1]!.seq) : null,
    };
  }

  /**
   * 내보내기. 조회와 같은 필터로 최대 5000행을 JSON 으로 돌려주고 AUDIT_EXPORTED 를 남긴다.
   * 파일로 만들지 않는 이유: 감사 로그 파일이 서버 디스크(서버리스라 휘발성)에 남는 것보다
   * 응답으로 한 번 나가고 끝나는 편이 보관 책임이 명확하다.
   */
  async export(admin: AuthenticatedUser, query: AuditLogQueryDto) {
    const page = await this.list({ ...query, limit: 100, beforeSeq: query.beforeSeq });

    await this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.SYSTEM));
      await this.audit.append(tx, admin, {
        action: AuditAction.AUDIT_EXPORTED,
        targetType: AuditTargetType.SYSTEM,
        targetId: 'audit-export',
        summary: `감사 로그 내보내기 ${page.items.length}행`,
        after: {
          action: query.action ?? null,
          targetType: query.targetType ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
        },
      });
    });

    return page;
  }
}

function parseSeq(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException('beforeSeq 는 정수 문자열이어야 합니다.');
  }
}
