import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  EventMode,
  FeeScope,
  FeeType,
  Prisma,
  SettlementStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { toCursorPage } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assertAffected, auditChainKey } from '../admin.internals';
import type {
  ComputeSettlementDto,
  CreatePlatformFeeDto,
  EndPlatformFeeDto,
  PlatformFeeListQueryDto,
  SettlementListQueryDto,
  UpdateSettlementStatusDto,
} from '../dto/billing-admin.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminSettingsService } from './admin-settings.service';

/** 부가세율(10%). 정률로 박아두는 이유는 이 값이 바뀌면 정산 로직 자체를 다시 봐야 하기 때문이다. */
const VAT_BPS = 1_000;

/** 상태 전이표. 여기 없는 전이는 400 이다 — PAID 에서 DRAFT 로 돌아가는 길은 없다. */
const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  [SettlementStatus.DRAFT]: [SettlementStatus.COMPUTED, SettlementStatus.CANCELED],
  [SettlementStatus.COMPUTED]: [
    SettlementStatus.READY,
    SettlementStatus.ON_HOLD,
    SettlementStatus.CANCELED,
  ],
  [SettlementStatus.READY]: [SettlementStatus.PAID, SettlementStatus.ON_HOLD, SettlementStatus.CANCELED],
  [SettlementStatus.ON_HOLD]: [SettlementStatus.READY, SettlementStatus.CANCELED],
  [SettlementStatus.PAID]: [],
  [SettlementStatus.CANCELED]: [],
};

/**
 * 수수료 정책 · 정산. **플레이스홀더다** (D-05 / 보류 항목).
 *
 * 여기서 하는 일은 금액을 계산해 행에 적는 것까지이고, 실제 이체는 하지 않는다.
 * `PAID` 로 넘기는 것도 "밖에서 이체가 끝났다"를 사람이 기록하는 행위이지
 * 이 코드가 돈을 옮기는 것이 아니다 — 지급 연동이 붙을 자리는
 * `markPaid()` 안에 주석으로 표시해 두었다.
 *
 * 그럼에도 상태기계와 감사를 제대로 만들어 두는 이유: 나중에 PG 를 붙일 때
 * 바꿔야 하는 것이 "한 함수의 속"이어야 하고, 그 함수를 부르는 조건·순서·기록이
 * 그때 새로 설계되면 안 되기 때문이다.
 */
@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly settings: AdminSettingsService,
  ) {}

  // --- 수수료 정책 ---

  async listFees(query: PlatformFeeListQueryDto) {
    const rows = await this.prisma.platformFee.findMany({
      where: {
        deletedAt: null,
        ...(query.scope ? { scope: query.scope } : {}),
        ...(query.activeOnly
          ? { isActive: true, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    return toCursorPage(rows, query.limit);
  }

  /**
   * 정책 생성.
   *
   * 기존 정책을 수정하지 않고 새로 만든다 — 이미 계산된 `Settlement.feePolicySnapshot` 과
   * 현재 정책이 어긋났을 때 그 차이를 설명할 근거가 남아야 한다.
   * 겹치는 기간을 막지는 않는다(스코프가 다르면 겹치는 것이 정상이다). 대신 해석 규칙은
   * "가장 좁은 스코프 + 가장 늦게 시작한 정책"이고, 그건 `resolveFee()` 한 곳에만 있다.
   */
  async createFee(admin: AuthenticatedUser, dto: CreatePlatformFeeDto) {
    if (dto.scope !== FeeScope.GLOBAL && !dto.scopeRefId) {
      throw new BadRequestException('GLOBAL 이 아닌 스코프에는 scopeRefId 가 필요합니다.');
    }

    if (dto.feeType !== FeeType.FIXED && dto.percentBps === undefined) {
      throw new BadRequestException('PERCENT/HYBRID 정책에는 percentBps 가 필요합니다.');
    }

    if (dto.feeType !== FeeType.PERCENT && dto.fixedAmountKrw === undefined) {
      throw new BadRequestException('FIXED/HYBRID 정책에는 fixedAmountKrw 가 필요합니다.');
    }

    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;

    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('종료 시각은 시작 시각보다 뒤여야 합니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.PLATFORM_FEE));

      const fee = await tx.platformFee.create({
        data: {
          name: dto.name,
          scope: dto.scope,
          scopeRefId: dto.scopeRefId ?? null,
          eventMode: dto.eventMode ?? null,
          feeType: dto.feeType,
          percentBps: dto.percentBps ?? null,
          fixedAmountKrw: dto.fixedAmountKrw ?? null,
          minFeeKrw: dto.minFeeKrw ?? null,
          maxFeeKrw: dto.maxFeeKrw ?? null,
          vatIncluded: dto.vatIncluded ?? false,
          effectiveFrom,
          effectiveTo,
          createdByUserId: admin.id,
        },
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.FEE_POLICY_CREATED,
        targetType: AuditTargetType.PLATFORM_FEE,
        targetId: fee.id,
        summary: `수수료 정책 생성: ${fee.name} (${fee.scope}/${fee.feeType})`,
        after: {
          scope: fee.scope,
          feeType: fee.feeType,
          percentBps: fee.percentBps,
          fixedAmountKrw: fee.fixedAmountKrw,
          effectiveFrom: fee.effectiveFrom.toISOString(),
        },
      });

      return fee;
    });
  }

  /** 정책 종료. 삭제하지 않는다 — 과거 정산의 근거라 지우면 재계산이 불가능해진다. */
  async endFee(admin: AuthenticatedUser, feeId: string, dto: EndPlatformFeeDto) {
    const effectiveTo = new Date(dto.effectiveTo);

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.PLATFORM_FEE));

      const { count } = await tx.platformFee.updateMany({
        where: {
          id: feeId,
          deletedAt: null,
          isActive: true,
          effectiveFrom: { lt: effectiveTo },
        },
        data: { effectiveTo, isActive: false },
      });

      assertAffected(count, 1, 'FEE_POLICY_NOT_ENDABLE');

      await this.audit.append(tx, admin, {
        action: AuditAction.FEE_POLICY_ENDED,
        targetType: AuditTargetType.PLATFORM_FEE,
        targetId: feeId,
        summary: `수수료 정책 종료: ${effectiveTo.toISOString()}`,
        after: { effectiveTo: effectiveTo.toISOString(), isActive: false },
        reasonMemo: dto.reason,
      });

      return tx.platformFee.findUniqueOrThrow({ where: { id: feeId } });
    });
  }

  // --- 정산 ---

  async listSettlements(query: SettlementListQueryDto) {
    const rows = await this.prisma.settlement.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.partnerProfileId ? { partnerProfileId: query.partnerProfileId } : {}),
        ...(query.periodKstMonth ? { periodKstMonth: query.periodKstMonth } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    return toCursorPage(rows, query.limit);
  }

  /**
   * 정산 계산. 같은 (eventId, periodKstMonth) 는 언제 다시 돌려도 같은 결과여야 한다.
   *
   * 집계를 SQL 한 문장으로 가져오는 이유는 금액 때문이다 — 행을 TS 로 끌어와 더하면
   * 페이지네이션 경계에서 조용히 일부만 더해지는 사고가 난다. 합계는 DB 가 낸다.
   *
   * 실제 이체는 없다. `SETTLEMENT_ENABLED` 가 꺼져 있으면 계산조차 하지 않는다 —
   * 꺼진 기능이 데이터를 남기면 나중에 "이 숫자는 언제 기준인가"를 아무도 모른다.
   */
  async computeSettlement(admin: AuthenticatedUser, dto: ComputeSettlementDto) {
    if (!(await this.settings.getBool('SETTLEMENT_ENABLED'))) {
      throw new BadRequestException({
        code: 'SETTLEMENT_DISABLED',
        message: '정산 기능이 꺼져 있습니다. 설정에서 SETTLEMENT_ENABLED 를 먼저 켜세요.',
      });
    }

    const event = await this.prisma.event.findFirst({
      where: { id: dto.eventId, deletedAt: null },
      select: { id: true, title: true, mode: true, partnerId: true, categoryId: true, sigunguCode: true },
    });

    if (!event) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

    const [totals] = await this.prisma.$queryRaw<
      { confirmedCount: number; grossAmountKrw: number; depositCollectedKrw: number; depositRefundedKrw: number }[]
    >`
      SELECT
        count(*)::int                                   AS "confirmedCount",
        COALESCE(sum(a."amount"), 0)::int               AS "grossAmountKrw",
        COALESCE(sum(a."depositPaidAmount"), 0)::int    AS "depositCollectedKrw",
        COALESCE(sum(a."depositRefundedAmount"), 0)::int AS "depositRefundedKrw"
      FROM "Application" a
      WHERE a."eventId" = ${dto.eventId}
        AND a.status = 'CONFIRMED'
    `;

    const fee = await this.resolveFee(event);
    const platformFeeKrw = computeFee(totals!.grossAmountKrw, fee);
    const vatKrw = fee?.vatIncluded ? 0 : Math.round((platformFeeKrw * VAT_BPS) / 10_000);
    const netPayoutKrw = totals!.grossAmountKrw - platformFeeKrw - vatKrw;

    // 스냅샷은 Date 가 없는 평문 객체여야 한다 — Prisma 의 Json 입력은 Date 를 받지 않고,
    // 무엇보다 이 값은 "그때 이 규칙이었다"를 나중에 사람이 읽는 용도다.
    const feeSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull = fee
      ? {
          id: fee.id,
          name: fee.name,
          scope: fee.scope,
          scopeRefId: fee.scopeRefId,
          feeType: fee.feeType,
          percentBps: fee.percentBps,
          fixedAmountKrw: fee.fixedAmountKrw,
          minFeeKrw: fee.minFeeKrw,
          maxFeeKrw: fee.maxFeeKrw,
          vatIncluded: fee.vatIncluded,
          effectiveFrom: fee.effectiveFrom.toISOString(),
        }
      : Prisma.JsonNull;

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.SETTLEMENT));

      const settlement = await tx.settlement.upsert({
        where: {
          eventId_periodKstMonth: { eventId: dto.eventId, periodKstMonth: dto.periodKstMonth },
        },
        create: {
          eventId: dto.eventId,
          partnerProfileId: event.partnerId,
          periodKstMonth: dto.periodKstMonth,
          ...totals!,
          feePolicyId: fee?.id ?? null,
          feePolicySnapshot: feeSnapshot,
          platformFeeKrw,
          vatKrw,
          netPayoutKrw,
          status: SettlementStatus.COMPUTED,
          computedAt: new Date(),
          confirmedByUserId: admin.id,
        },
        update: {
          ...totals!,
          feePolicyId: fee?.id ?? null,
          feePolicySnapshot: feeSnapshot,
          platformFeeKrw,
          vatKrw,
          netPayoutKrw,
          computedAt: new Date(),
          confirmedByUserId: admin.id,
        },
      });

      await this.audit.append(tx, admin, {
        action: AuditAction.SETTLEMENT_COMPUTED,
        targetType: AuditTargetType.SETTLEMENT,
        targetId: settlement.id,
        summary: `정산 계산 ${dto.periodKstMonth} / ${event.title}: 수수료 ${platformFeeKrw}원`,
        after: {
          confirmedCount: settlement.confirmedCount,
          grossAmountKrw: settlement.grossAmountKrw,
          platformFeeKrw,
          vatKrw,
          netPayoutKrw,
        },
        idempotencyKey: `settlement-compute:${dto.eventId}:${dto.periodKstMonth}:${settlement.computedAt?.getTime() ?? 0}`,
      });

      return settlement;
    });
  }

  /**
   * 상태 전이. 전이표에 없는 조합은 400 이다.
   *
   * `PAID` 로 보내는 것이 **지급 연동이 붙을 자리**다. 지금은 사람이 밖에서 이체를 마치고
   * 그 사실을 기록하는 것이므로, 여기서 외부 API 를 부르지 않는다.
   * 나중에 붙일 때는 이 함수 안에서 (a) 지급 요청 → (b) payoutRefId 기록 → (c) 상태 전이가
   * 같은 트랜잭션이 될 수 없다는 점을 먼저 풀어야 한다(외부 호출은 롤백되지 않는다).
   */
  async updateSettlementStatus(
    admin: AuthenticatedUser,
    settlementId: string,
    dto: UpdateSettlementStatusDto,
  ) {
    if (dto.status === SettlementStatus.ON_HOLD && !dto.holdReason) {
      throw new BadRequestException('보류로 보내려면 holdReason 이 필요합니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.audit.lock(tx, auditChainKey(AuditTargetType.SETTLEMENT));

      const before = await tx.settlement.findUnique({
        where: { id: settlementId },
        select: { id: true, status: true, periodKstMonth: true },
      });

      if (!before) throw new NotFoundException('정산 건을 찾을 수 없습니다.');

      if (!SETTLEMENT_TRANSITIONS[before.status].includes(dto.status)) {
        throw new BadRequestException({
          code: 'SETTLEMENT_TRANSITION_NOT_ALLOWED',
          from: before.status,
          to: dto.status,
        });
      }

      const { count } = await tx.settlement.updateMany({
        where: { id: settlementId, status: before.status },
        data: {
          status: dto.status,
          holdReason: dto.status === SettlementStatus.ON_HOLD ? dto.holdReason! : null,
          confirmedByUserId: admin.id,
        },
      });

      assertAffected(count, 1, 'SETTLEMENT_STATE_CHANGED');

      await this.audit.append(tx, admin, {
        action: AuditAction.SETTLEMENT_STATUS_CHANGED,
        targetType: AuditTargetType.SETTLEMENT,
        targetId: settlementId,
        summary: `정산 상태 ${before.status} → ${dto.status} (${before.periodKstMonth})`,
        before: { status: before.status },
        after: { status: dto.status },
        reasonMemo: dto.reason,
      });

      return tx.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    });
  }

  /**
   * 적용할 정책 하나를 고른다.
   *
   * 우선순위는 좁은 스코프부터다: PARTNER → CATEGORY → REGION → GLOBAL.
   * 같은 스코프가 여럿이면 가장 늦게 시작한 정책이 이긴다.
   * 이 규칙이 여기 한 곳에만 있어야 계산과 화면이 서로 다른 답을 내지 않는다.
   */
  private async resolveFee(event: {
    partnerId: string;
    categoryId: string | null;
    sigunguCode: string | null;
    mode: EventMode;
  }) {
    const scopeOr: Prisma.PlatformFeeWhereInput[] = [
      { scope: FeeScope.GLOBAL },
      { scope: FeeScope.PARTNER, scopeRefId: event.partnerId },
    ];

    if (event.categoryId) {
      scopeOr.push({ scope: FeeScope.CATEGORY, scopeRefId: event.categoryId });
    }
    if (event.sigunguCode) {
      scopeOr.push({ scope: FeeScope.REGION, scopeRefId: event.sigunguCode });
    }

    const now = new Date();

    const candidates = await this.prisma.platformFee.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        AND: [{ OR: [{ eventMode: null }, { eventMode: event.mode }] }, { OR: scopeOr }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const priority = { PARTNER: 0, CATEGORY: 1, REGION: 2, GLOBAL: 3 } as const;

    return (
      [...candidates].sort(
        (a, b) =>
          priority[a.scope] - priority[b.scope] ||
          b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
      )[0] ?? null
    );
  }
}

/**
 * 수수료 금액. 전부 정수 연산이다 — 원 단위 통화에서 부동소수를 쓰면
 * 1원씩 어긋난 정산서가 나오고, 그 1원은 사람이 손으로 찾아야 한다.
 */
function computeFee(
  gross: number,
  fee: { feeType: FeeType; percentBps: number | null; fixedAmountKrw: number | null; minFeeKrw: number | null; maxFeeKrw: number | null } | null,
): number {
  if (!fee || gross <= 0) return 0;

  const percentPart =
    fee.feeType === FeeType.FIXED ? 0 : Math.floor((gross * (fee.percentBps ?? 0)) / 10_000);
  const fixedPart = fee.feeType === FeeType.PERCENT ? 0 : (fee.fixedAmountKrw ?? 0);

  let amount = percentPart + fixedPart;

  if (fee.minFeeKrw !== null) amount = Math.max(amount, fee.minFeeKrw);
  if (fee.maxFeeKrw !== null) amount = Math.min(amount, fee.maxFeeKrw);

  return Math.min(amount, gross);
}
