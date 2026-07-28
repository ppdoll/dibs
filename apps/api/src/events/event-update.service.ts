import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditActorRole, EventStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { assertVersionMatch } from '../common/db/assert-affected';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventAuditService, actorLabelOf, type Tx } from './internal/event-audit.service';
import { requirePartnerProfileId } from './internal/event-context';
import {
  EDITABLE_EVENT_STATUSES,
  LIVE_EVENT_STATUSES,
  TERMINAL_APPLICATION_STATUSES,
  computeRankingLockAt,
  toServiceDateKst,
  validateEventPolicy,
  type EventPolicyInput,
} from './internal/event-policy';
import { PARTNER_EVENT_SELECT, type EventSnapshot } from './internal/event-select';

/**
 * 진행 중에 잠기는 금액 규칙. (IC-64)
 * 이미 신청한 사람들은 그 시점의 규칙 아래에서 금액을 정했고, 그 신청에는 예약금이 걸려 있다.
 */
const AMOUNT_RULE_FIELDS = ['fixedAmount', 'minAmount', 'maxAmount', 'amountStep'] as const;

/**
 * 진행 중에 잠기는 예약금 산정 규칙.
 *
 * IC-26 은 `depositWindowMinutes` 축소만 명시하지만, 산정식 자체(정액↔정률, 비율, 상하한)가
 * 바뀌면 이미 낸 예약금이 소급해서 "부족분"이 된다 — 롤백(D-06) 대상이 아닌 신청이
 * 규칙 변경만으로 롤백 후보가 된다. 그건 IC-64 가 막으려는 것과 정확히 같은 사고다.
 * 윈도우는 여기 없다 — **늘리는 것은 언제나 허용**이기 때문이다.
 */
const DEPOSIT_RULE_FIELDS = [
  'depositRequired',
  'depositType',
  'depositFixedAmount',
  'depositPercentBp',
  'depositRoundingUnit',
  'depositMinAmount',
  'depositMaxAmount',
] as const;

/** 신청자에게 약속한 정책. 실제로 바뀔 때만 policyVersion 을 올린다. (IC-63) */
const POLICY_FIELDS = [
  ...AMOUNT_RULE_FIELDS,
  ...DEPOSIT_RULE_FIELDS,
  'depositWindowMinutes',
  'capacity',
] as const;

/** 하나라도 들어오면 정책 전체를 다시 검증해야 하는 필드. */
const POLICY_VALIDATION_FIELDS = [
  ...POLICY_FIELDS,
  'applyStartAt',
  'applyEndAt',
  'serviceStartAt',
  'serviceEndAt',
  'softCloseEnabled',
  'softCloseWindowMinutes',
  'softCloseExtendMinutes',
  'softCloseHardEndAt',
  'softCloseMaxExtensions',
  'softCloseMaxExtensionsPerUser',
] as const;

/** 이미 열린 뒤에는 손댈 수 없는 기간 필드. */
const OPENED_STATUSES: readonly EventStatus[] = [EventStatus.OPEN, EventStatus.CLOSED];

@Injectable()
export class EventUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EventAuditService,
  ) {}

  /**
   * 이벤트 부분 수정.
   *
   * 낙관적 락 토큰은 `Event.version` 이다 — `policyVersion` 이 아니다(IC-63).
   * 두 개념을 한 컬럼에 섞으면 둘 다 망가진다: 문구만 고쳐도 policyVersion 이 오르면
   * Application.policyVersion 스냅샷이 "내가 신청할 때의 정책"이라는 뜻을 잃고,
   * 반대로 소프트 클로즈 연장이 락 토큰을 안 올리면 연장 직후 도착한 PATCH 가
   * 낡은 토큰으로 통과해 방금 연장된 applyEndAt 을 덮어쓴다.
   */
  async patch(
    user: AuthenticatedUser,
    eventId: string,
    ifMatchVersion: number,
    dto: UpdateEventDto,
  ) {
    const partnerId = requirePartnerProfileId(user);

    return this.prisma.$transaction(async (tx) => {
      // 감사 행을 쓸 수 있는 트랜잭션이므로 자문 락이 첫 문장이다. (IC-02 / IC-61)
      await this.audit.lockChain(tx, eventId);

      const current = await tx.event.findFirst({
        where: { id: eventId, partnerId, deletedAt: null },
        select: PARTNER_EVENT_SELECT,
      });

      if (!current) throw new NotFoundException('이벤트를 찾을 수 없습니다.');

      this.assertEditable(current.status);
      await this.assertUnlockedFields(tx, current, dto);

      const merged = mergePolicy(current, dto);
      const touchesPolicy = POLICY_VALIDATION_FIELDS.some((f) => dto[f] !== undefined);

      if (touchesPolicy) {
        // 마감이 지난 이벤트에도 합법적인 수정(예약금 윈도우 연장)이 있으므로,
        // "마감이 미래여야 한다"는 아직 열리지 않은 이벤트에만 건다.
        validateEventPolicy(merged, new Date(), {
          enforceFuturePeriod: !OPENED_STATUSES.includes(current.status),
        });
      }

      const data = buildPatchData(current, dto, merged);
      const policyChanged = POLICY_FIELDS.some((f) => hasChanged(current[f], dto[f]));

      // 상태 전제를 WHERE 에 전부 적는다(IC-01). version 만으로도 충분해 보이지만,
      // status 를 함께 거는 쪽이 "무엇을 전제했는지"를 쿼리가 스스로 말해 준다.
      const { count } = await tx.event.updateMany({
        where: {
          id: eventId,
          partnerId,
          deletedAt: null,
          version: ifMatchVersion,
          status: current.status,
        },
        data: {
          ...data,
          version: { increment: 1 },
          ...(policyChanged ? { policyVersion: { increment: 1 } } : {}),
        },
      });

      assertVersionMatch(count, 'EVENT_VERSION_MISMATCH');

      await this.writeAuditTrail(tx, user, current, dto);

      return tx.event.findUniqueOrThrow({ where: { id: eventId }, select: PARTNER_EVENT_SELECT });
    });
  }

  /**
   * 초안 삭제. DRAFT 만 지운다.
   *
   * 공개된 뒤에는 삭제 대신 취소(cancel)여야 한다 — 신청자가 붙은 이벤트를 지우면
   * 그 사람들의 신청은 존재하는데 대상이 사라지고, 예약금 환불 근거도 함께 없어진다.
   */
  async softDelete(user: AuthenticatedUser, eventId: string, ifMatchVersion: number) {
    const partnerId = requirePartnerProfileId(user);

    const { count } = await this.prisma.event.updateMany({
      where: {
        id: eventId,
        partnerId,
        deletedAt: null,
        version: ifMatchVersion,
        status: EventStatus.DRAFT,
      },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    assertVersionMatch(count, 'EVENT_NOT_DELETABLE');

    return { id: eventId, deleted: true };
  }

  private assertEditable(status: EventStatus): void {
    if (EDITABLE_EVENT_STATUSES.includes(status)) return;

    throw new ConflictException({
      code: 'EVENT_NOT_EDITABLE',
      message:
        status === EventStatus.SUSPENDED
          ? '정지된 이벤트는 수정할 수 없습니다. 운영자에게 문의해 주세요.'
          : '확정되었거나 취소된 이벤트는 수정할 수 없습니다.',
    });
  }

  /**
   * 상태별로 잠긴 필드를 거른다.
   *
   * DB CHECK 로는 못 막는 것들이다 — CHECK 는 "현재 행이 말이 되는가"만 보지
   * "이 전이가 신청자에게 소급 적용인가"는 모른다.
   */
  private async assertUnlockedFields(
    tx: Tx,
    current: EventSnapshot,
    dto: UpdateEventDto,
  ): Promise<void> {
    const live = LIVE_EVENT_STATUSES.includes(current.status);

    if (live && AMOUNT_RULE_FIELDS.some((f) => hasChanged(current[f], dto[f]))) {
      const hasActive = await hasActiveApplications(tx, current.id);

      throw new ConflictException({
        code: hasActive ? 'EVENT_HAS_ACTIVE_APPLICATIONS' : 'EVENT_AMOUNT_RULE_LOCKED',
        message: hasActive
          ? '이미 신청·예약금이 들어온 이벤트의 금액 규칙은 바꿀 수 없습니다. 신청자들은 지금 조건을 보고 금액을 정했습니다.'
          : '공개된 이벤트의 금액 규칙은 바꿀 수 없습니다. 마감 후 새 이벤트로 다시 열어 주세요.',
      });
    }

    if (live && DEPOSIT_RULE_FIELDS.some((f) => hasChanged(current[f], dto[f]))) {
      throw new ConflictException({
        code: 'EVENT_DEPOSIT_POLICY_LOCKED',
        message: '공개된 이벤트의 예약금 산정 규칙은 바꿀 수 없습니다. 입금 시간 연장만 가능합니다.',
      });
    }

    // IC-26. 열린 홀드는 자기 windowMinutes 를 스냅샷으로 들고 있어서, 윈도우를 줄이면
    // rankingLockAt 만 앞당겨지고 홀드의 dueAt 은 그대로다 —
    // 즉 아직 만료되지 않은 홀드를 남긴 채로 순위가 확정된다.
    if (
      live &&
      dto.depositWindowMinutes !== undefined &&
      dto.depositWindowMinutes < current.depositWindowMinutes
    ) {
      throw new ConflictException({
        code: 'EVENT_DEPOSIT_WINDOW_DECREASE_FORBIDDEN',
        message: `진행 중인 이벤트의 입금 시간은 줄일 수 없습니다(현재 ${current.depositWindowMinutes}분). 늘리는 것만 가능합니다.`,
      });
    }

    if (!OPENED_STATUSES.includes(current.status)) return;

    if (hasChanged(current.applyStartAt, dto.applyStartAt)) {
      throw new ConflictException({
        code: 'EVENT_APPLY_START_LOCKED',
        message: '이미 시작된 이벤트의 신청 시작 일시는 바꿀 수 없습니다.',
      });
    }

    // 마감을 앞당기면 아직 예약금을 낼 시간이 남은 신청자의 시계가 통째로 사라진다.
    // originalApplyEndAt <= applyEndAt 이라는 CHECK 도 함께 깨진다.
    if (dto.applyEndAt !== undefined && dto.applyEndAt.getTime() < current.applyEndAt.getTime()) {
      throw new ConflictException({
        code: 'EVENT_DEADLINE_SHORTEN_FORBIDDEN',
        message: '진행 중인 이벤트의 마감은 앞당길 수 없습니다. 지금 닫으려면 조기 마감을 써 주세요.',
      });
    }
  }

  /**
   * 감사 로그.
   *
   * 모든 PATCH 를 남기지 않는다 — 문구·이미지 수정까지 체인에 얹으면 자문 락을 오래 들고
   * 정작 봐야 할 행이 묻힌다(IC-61 이 대량 작업에 집계 1행을 요구하는 것과 같은 이유).
   * 신청자에게 영향이 가는 두 가지, **정원 변경**과 **마감 연장**만 남긴다.
   */
  private async writeAuditTrail(
    tx: Tx,
    user: AuthenticatedUser,
    current: EventSnapshot,
    dto: UpdateEventDto,
  ): Promise<void> {
    const base = {
      eventId: current.id,
      actorUserId: user.id,
      actorRole: AuditActorRole.PARTNER,
      actorLabel: actorLabelOf(user),
      targetOwnerUserId: user.id,
    };

    if (hasChanged(current.capacity, dto.capacity)) {
      await this.audit.append(tx, {
        ...base,
        action: AuditAction.EVENT_CAPACITY_EDITED,
        summary: `정원 ${current.capacity} → ${dto.capacity}`,
        beforeJson: { capacity: current.capacity },
        afterJson: { capacity: dto.capacity ?? null },
      });
    }

    if (dto.applyEndAt !== undefined && dto.applyEndAt.getTime() > current.applyEndAt.getTime()) {
      await this.audit.append(tx, {
        ...base,
        action: AuditAction.PARTNER_DEADLINE_EXTENDED,
        summary: `마감 ${current.applyEndAt.toISOString()} → ${dto.applyEndAt.toISOString()}`,
        beforeJson: { applyEndAt: current.applyEndAt.toISOString() },
        afterJson: { applyEndAt: dto.applyEndAt.toISOString() },
      });
    }
  }
}

/** IC-64 의 술어. 종결되지 않은 신청이 하나라도 있으면 금액 규칙 변경은 소급 적용이 된다. */
async function hasActiveApplications(tx: Tx, eventId: string): Promise<boolean> {
  const found = await tx.application.findFirst({
    where: { eventId, status: { notIn: [...TERMINAL_APPLICATION_STATUSES] } },
    select: { id: true },
  });

  return found !== null;
}

/**
 * 값이 실제로 바뀌는가. `undefined` 는 "안 보냈다"이지 "null 로 지워라"가 아니다.
 * Date 는 참조 비교가 항상 false 라 반드시 시각으로 비교한다 — 안 그러면 마감을 안 바꾼 PATCH 마다
 * policyVersion 이 오르고 Application.policyVersion 스냅샷이 의미를 잃는다.
 */
function hasChanged(before: unknown, after: unknown): boolean {
  if (after === undefined) return false;
  if (before instanceof Date && after instanceof Date) return before.getTime() !== after.getTime();

  return before !== after;
}

/** 현재 행 위에 PATCH 를 얹은 "적용 후" 정책. 검증은 항상 이 병합 결과를 본다. */
function mergePolicy(current: EventSnapshot, dto: UpdateEventDto): EventPolicyInput {
  const pick = <T>(next: T | undefined, prev: T): T => (next === undefined ? prev : next);

  return {
    mode: current.mode,
    capacity: pick(dto.capacity, current.capacity),
    fixedAmount: pick(dto.fixedAmount, current.fixedAmount),
    minAmount: pick(dto.minAmount, current.minAmount),
    maxAmount: pick(dto.maxAmount, current.maxAmount),
    amountStep: pick(dto.amountStep, current.amountStep),
    applyStartAt: pick(dto.applyStartAt, current.applyStartAt),
    applyEndAt: pick(dto.applyEndAt, current.applyEndAt),
    serviceStartAt: pick(dto.serviceStartAt, current.serviceStartAt),
    serviceEndAt: pick(dto.serviceEndAt, current.serviceEndAt),
    depositRequired: pick(dto.depositRequired, current.depositRequired),
    depositType: pick(dto.depositType, current.depositType),
    depositFixedAmount: pick(dto.depositFixedAmount, current.depositFixedAmount),
    depositPercentBp: pick(dto.depositPercentBp, current.depositPercentBp),
    depositRoundingUnit: pick(dto.depositRoundingUnit, current.depositRoundingUnit),
    depositMinAmount: pick(dto.depositMinAmount, current.depositMinAmount),
    depositMaxAmount: pick(dto.depositMaxAmount, current.depositMaxAmount),
    depositWindowMinutes: pick(dto.depositWindowMinutes, current.depositWindowMinutes),
    softCloseEnabled: pick(dto.softCloseEnabled, current.softCloseEnabled),
    softCloseWindowMinutes: pick(dto.softCloseWindowMinutes, current.softCloseWindowMinutes),
    softCloseExtendMinutes: pick(dto.softCloseExtendMinutes, current.softCloseExtendMinutes),
    softCloseHardEndAt: pick(dto.softCloseHardEndAt, current.softCloseHardEndAt),
    softCloseMaxExtensions: pick(dto.softCloseMaxExtensions, current.softCloseMaxExtensions),
    softCloseMaxExtensionsPerUser: pick(
      dto.softCloseMaxExtensionsPerUser,
      current.softCloseMaxExtensionsPerUser,
    ),
  };
}

/**
 * 실제로 쓸 컬럼만 골라 담는다. DTO 를 그대로 펼치지 않는 이유는
 * 새 DTO 필드가 검증 없이 UPDATE 로 흘러드는 걸 막기 위해서다.
 */
function buildPatchData(
  current: EventSnapshot,
  dto: UpdateEventDto,
  merged: EventPolicyInput,
): Prisma.EventUpdateManyMutationInput {
  const data: Prisma.EventUpdateManyMutationInput = {};

  if (dto.title !== undefined) data.title = dto.title;
  if (dto.description !== undefined) data.description = dto.description;
  if (dto.tags !== undefined) data.tags = dto.tags;
  if (dto.depositRefundNote !== undefined) data.depositRefundNote = dto.depositRefundNote;
  if (dto.showCompetitionRatio !== undefined) data.showCompetitionRatio = dto.showCompetitionRatio;
  if (dto.ratioMinApplicantsToShow !== undefined) {
    data.ratioMinApplicantsToShow = dto.ratioMinApplicantsToShow;
  }
  if (dto.cutoffVisibility !== undefined) data.cutoffVisibility = dto.cutoffVisibility;
  if (dto.rankVisibility !== undefined) data.rankVisibility = dto.rankVisibility;
  if (dto.amountDistributionVisibility !== undefined) {
    data.amountDistributionVisibility = dto.amountDistributionVisibility;
  }

  for (const field of POLICY_FIELDS) {
    if (dto[field] !== undefined) {
      (data as Record<string, unknown>)[field] = dto[field];
    }
  }

  for (const field of [
    'softCloseEnabled',
    'softCloseWindowMinutes',
    'softCloseExtendMinutes',
    'softCloseHardEndAt',
    'softCloseMaxExtensions',
    'softCloseMaxExtensionsPerUser',
  ] as const) {
    if (dto[field] !== undefined) {
      (data as Record<string, unknown>)[field] = dto[field];
    }
  }

  if (dto.applyStartAt !== undefined) data.applyStartAt = dto.applyStartAt;
  if (dto.serviceEndAt !== undefined) data.serviceEndAt = dto.serviceEndAt;

  if (dto.serviceStartAt !== undefined) {
    data.serviceStartAt = dto.serviceStartAt;
    // 검색 필터용 파생값이라 원본이 바뀌면 반드시 같은 트랜잭션에서 함께 바뀌어야 한다.
    data.serviceDateKst = toServiceDateKst(dto.serviceStartAt);
  }

  if (dto.applyEndAt !== undefined) {
    data.applyEndAt = dto.applyEndAt;

    // 연장 전 원래 마감을 한 번만 박아 둔다. 이미 값이 있으면 덮지 않는다 —
    // 소프트 클로즈가 여러 번 밀었을 수 있고, "원래"는 최초 한 번의 값이다.
    if (
      OPENED_STATUSES.includes(current.status) &&
      dto.applyEndAt.getTime() > current.applyEndAt.getTime()
    ) {
      data.originalApplyEndAt = current.originalApplyEndAt ?? current.applyEndAt;
    }
  }

  // 마감·예약금 윈도우·예약금 필요 여부 중 무엇이 움직여도 순위 확정 시각이 따라가야 한다(D-04).
  // depositRequired 가 여기 함께 있는 이유: rankingLockAt 은 예약금이 필요할 때만 윈도우를 더한다.
  // 이 토글만 켜고 lockAt 을 그대로 두면 확정 시각이 마감 +1분에 머물고, 그러면 아직 시계가
  // 돌고 있는 홀드를 남긴 채 확정 크론이 이벤트를 집어간다 — IC-26 이 막는 바로 그 상황이다.
  // (DRAFT 에서만 닿는 경로이고 publish 가 SQL 로 다시 계산하지만, 그때까지 남는 잘못된 값을
  //  스위퍼의 COALESCE 분기가 그대로 채택해 버린다.)
  if (
    dto.applyEndAt !== undefined ||
    dto.depositWindowMinutes !== undefined ||
    dto.depositRequired !== undefined
  ) {
    data.rankingLockAt = computeRankingLockAt(merged);
  }

  return data;
}
