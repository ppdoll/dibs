import { randomUUID } from 'node:crypto';
import {
  BidSource,
  CoreActorType,
  DepositReason,
  DepositType,
  EventMode,
  EventStatus,
  NotificationCategory,
  NotificationPriority,
  NotificationType,
} from '@prisma/client';
import { assertNoVisibilityLeak } from '@dibs/shared';

import { assertAffected } from '../../common/db/assert-affected';
import { stateChanged, type Tx } from './application-context';
import type { EventDepositPolicy } from './deposit-policy';

/** 신청 경로가 이벤트에서 읽어야 하는 값 한 벌. 게이트 문장이 그대로 돌려준다. */
export interface EventApplyContext extends EventDepositPolicy {
  id: string;
  mode: EventMode;
  status: EventStatus;
  capacity: number;
  fixedAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  amountStep: number;
  policyVersion: number;
  applyEndAt: Date;
  softCloseEnabled: boolean;
  softCloseWindowMinutes: number | null;
  softCloseExtendMinutes: number | null;
  softCloseMaxExtensions: number;
  softCloseExtensionCount: number;
  softCloseHardEndAt: Date | null;
}

/**
 * ★ BID 신청·상향 트랜잭션의 **첫 문장**. (IC-11)
 *
 * `FOR SHARE` 는 읽기 락이다. 공유 락끼리는 충돌하지 않으므로 신청자들끼리는 직렬화되지 않고,
 * 행을 실제로 바꾸는 마감/연장 UPDATE 하고만 충돌한다. `FOR UPDATE` 로 바꾸는 순간
 * 마감 직전에 몰리는 수백 건이 한 줄로 서게 되어, 정원 초과를 허용해서(D-03) 없앤 병목을
 * 손으로 다시 만드는 꼴이 된다.
 *
 * 락이 아예 없으면 `applyEndAt` 을 읽은 뒤 INSERT 하기까지 사이에 이벤트가 CLOSED 로 전이될 수 있고,
 * 그 신청은 마감 이후에 커밋된 채로 랭킹에 포함된다 — 파트너 화면에 마감보다 늦은 입찰이 1등으로 뜬다.
 *
 * `suspendedAt` 을 함께 보는 이유: 운영자 정지가 이 가드에 반영되지 않으면 정지가 장식이 된다.
 */
export async function lockEventForApply(tx: Tx, eventId: string): Promise<EventApplyContext> {
  const rows = await tx.$queryRaw<EventApplyContext[]>`
    SELECT e.id, e.mode, e.status, e.capacity,
           e."fixedAmount", e."minAmount", e."maxAmount", e."amountStep",
           e."policyVersion", e."applyEndAt",
           e."depositRequired", e."depositType", e."depositFixedAmount", e."depositPercentBp",
           e."depositRoundingUnit", e."depositMinAmount", e."depositMaxAmount",
           e."depositWindowMinutes",
           e."softCloseEnabled", e."softCloseWindowMinutes", e."softCloseExtendMinutes",
           e."softCloseMaxExtensions", e."softCloseExtensionCount", e."softCloseHardEndAt"
    FROM "Event" e
    WHERE e.id = ${eventId}
      AND e.status = 'OPEN'
      AND e."suspendedAt" IS NULL
      AND e."deletedAt" IS NULL
      AND now() >= e."applyStartAt"
      AND now() <  e."applyEndAt"
    FOR SHARE
  `;

  const event = rows[0];
  if (!event) {
    throw stateChanged('EVENT_NOT_ACCEPTING', '지금은 신청을 받지 않는 이벤트입니다.');
  }

  return event;
}

/**
 * INSTANT 경로가 이벤트를 읽는다. **락을 잡지 않는다.**
 *
 * BID 와 다른 이유가 있다. INSTANT 는 곧바로 `Event.claimedCount` 를 올리는 배타 UPDATE 를
 * 실행하는데(IC-15), 그 전에 같은 행에 `FOR SHARE` 를 잡아두면 공유 락을 배타 락으로 승격시켜야 한다.
 * 두 신청이 동시에 그러면 서로의 공유 락을 기다리다 **데드락**이다.
 * INSTANT 에는 애초에 공유 락이 필요 없다 — 마감·정원·정지 가드가 전부
 * 그 단일 조건부 UPDATE 의 WHERE 절 안에 들어 있어서 그 문장 하나가 게이트다.
 *
 * 여기서 읽는 값은 금액·예약금 정책을 계산하기 위한 것이고, 그 값이 낡았을 가능성은
 * INSERT 문의 `policyVersion` 일치 조건이 잡는다.
 */
export async function readEventForInstantApply(
  tx: Tx,
  eventId: string,
): Promise<EventApplyContext> {
  const rows = await tx.$queryRaw<EventApplyContext[]>`
    SELECT e.id, e.mode, e.status, e.capacity,
           e."fixedAmount", e."minAmount", e."maxAmount", e."amountStep",
           e."policyVersion", e."applyEndAt",
           e."depositRequired", e."depositType", e."depositFixedAmount", e."depositPercentBp",
           e."depositRoundingUnit", e."depositMinAmount", e."depositMaxAmount",
           e."depositWindowMinutes",
           e."softCloseEnabled", e."softCloseWindowMinutes", e."softCloseExtendMinutes",
           e."softCloseMaxExtensions", e."softCloseExtensionCount", e."softCloseHardEndAt"
    FROM "Event" e
    WHERE e.id = ${eventId}
      AND e.status = 'OPEN'
      AND e."suspendedAt" IS NULL
      AND e."deletedAt" IS NULL
      AND now() >= e."applyStartAt"
      AND now() <  e."applyEndAt"
  `;

  const event = rows[0];
  if (!event) {
    throw stateChanged('EVENT_NOT_ACCEPTING', '지금은 신청을 받지 않는 이벤트입니다.');
  }

  return event;
}

/**
 * 소프트 클로즈 연장을 시도할 만한 상황인지 미리 본다. (IC-17 / D-08)
 *
 * ★ 이 판정이 락 전략을 가른다. 연장 UPDATE 는 이미 `FOR SHARE` 를 들고 있는 Event 행을
 * 배타 락으로 승격시키는 문장이라, 두 트랜잭션이 동시에 그러면 서로의 공유 락을 기다리다 **데드락**이다.
 * 그래서 연장을 시도할 트랜잭션만 `pg_advisory_xact_lock` 을 첫 문장으로 잡아 줄을 세운다.
 * 조건은 여기 한 곳에서만 판정하고, 락을 잡지 않은 트랜잭션은 연장도 시도하지 않는다 —
 * 이 두 가지가 함께여야 "승격을 시도하는 트랜잭션은 언제나 자문 락 아래에 있다"가 성립한다.
 *
 * 이벤트 행을 읽기 전(= 라우팅용 사전 조회)의 값으로 판정하므로 정확할 필요는 없다.
 * 틀리면 (a) 불필요하게 줄을 서거나 (b) 연장 기회를 한 번 놓칠 뿐이고, 둘 다 안전한 실패다.
 */
export function mayAttemptSoftClose(
  event: Pick<
    EventApplyContext,
    | 'softCloseEnabled'
    | 'softCloseWindowMinutes'
    | 'softCloseMaxExtensions'
    | 'softCloseExtensionCount'
    | 'applyEndAt'
  >,
  now: Date,
): boolean {
  if (!event.softCloseEnabled || event.softCloseWindowMinutes === null) return false;
  if (event.softCloseExtensionCount >= event.softCloseMaxExtensions) return false;

  const windowOpensAt = event.applyEndAt.getTime() - event.softCloseWindowMinutes * 60_000;
  return now.getTime() >= windowOpensAt && now.getTime() < event.applyEndAt.getTime();
}

/** 연장 시도 트랜잭션의 첫 문장. 세션 락이 아니라 xact 락인 이유는 pgbouncer transaction 모드다(IC-02). */
export async function lockSoftCloseChain(tx: Tx, eventId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`softclose:${eventId}`}))`;
}

export interface SoftCloseOutcome {
  extended: boolean;
  deadlineBefore: Date | null;
  deadlineAfter: Date | null;
}

const NO_EXTENSION: SoftCloseOutcome = {
  extended: false,
  deadlineBefore: null,
  deadlineAfter: null,
};

/**
 * 마감 연장. 단일 조건부 UPDATE 이고 **0행은 오류가 아니다**. (IC-17)
 *
 * 전체 상한과 1인당 상한을 둘 다 WHERE 에 넣는다. 예약금이 FIXED 면 금액을 올려도 부족분이 0이라
 * "부족분이 있으면 연장하지 않는다"는 보호가 통째로 무력해지고, 그 상태에서는 한 사람이
 * `amountStep` 만큼씩만 올리면서 마감을 혼자 6번 밀 수 있다.
 *
 * `LEAST(..., softCloseHardEndAt) > e."applyEndAt"` 을 조건에 넣는 이유: 하드 마감에 이미 닿아
 * 실제로는 1초도 안 밀리는 경우까지 "연장 1회"로 세면, 연장 카운터만 소모되고
 * `bid_history_softclose_chk`(deadlineAfter > deadlineBefore)에 걸려 입찰 자체가 죽는다.
 */
export async function tryExtendSoftClose(
  tx: Tx,
  eventId: string,
  userId: string,
): Promise<SoftCloseOutcome> {
  const rows = await tx.$queryRaw<{ deadlineBefore: Date; deadlineAfter: Date }[]>`
    WITH prev AS (
      SELECT id, "applyEndAt" AS "deadlineBefore" FROM "Event" WHERE id = ${eventId}
    )
    UPDATE "Event" e SET
      "applyEndAt"              = LEAST(e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
                                        e."softCloseHardEndAt"),
      "originalApplyEndAt"      = COALESCE(e."originalApplyEndAt", e."applyEndAt"),
      "rankingLockAt"           = LEAST(e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
                                        e."softCloseHardEndAt")
                                  + make_interval(mins => e."depositWindowMinutes" + 1),
      "softCloseExtensionCount" = e."softCloseExtensionCount" + 1,
      -- 낙관적 락 토큰이다. policyVersion 이 아니다(IC-63).
      "version"                 = e."version" + 1,
      "updatedAt"               = now()
    FROM prev
    WHERE e.id = prev.id
      AND e."softCloseEnabled" = true
      AND e.status = 'OPEN'
      AND e."suspendedAt" IS NULL
      AND e."softCloseExtendMinutes" IS NOT NULL
      AND e."softCloseWindowMinutes" IS NOT NULL
      AND e."softCloseExtensionCount" < e."softCloseMaxExtensions"
      AND now() >= e."applyEndAt" - make_interval(mins => e."softCloseWindowMinutes")
      AND now() <  e."applyEndAt"
      AND LEAST(e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
                e."softCloseHardEndAt") > e."applyEndAt"
      AND (SELECT count(*) FROM "BidHistory" b
           WHERE b."eventId" = e.id AND b."userId" = ${userId} AND b."triggeredSoftClose")
          < e."softCloseMaxExtensionsPerUser"
    RETURNING prev."deadlineBefore", e."applyEndAt" AS "deadlineAfter"
  `;

  const row = rows[0];
  if (!row) return NO_EXTENSION;

  return { extended: true, deadlineBefore: row.deadlineBefore, deadlineAfter: row.deadlineAfter };
}

/**
 * ★ INSTANT 자리 점유. 점유와 반환은 **대칭**이어야 한다. (IC-15)
 *
 * 신청 쪽을 `slotClaimed = false → true` 로 먼저 바꾸고, **그 UPDATE 가 1행을 바꿨을 때만**
 * 카운터를 올린다. 점유 쪽이 무조건 `claimedCount + 1` 이면 재시도된 재신청 하나가
 * 같은 신청에 대해 카운터를 두 번 올리는데, `slotClaimed` 는 이미 true 라 반환은 한 번뿐이다 —
 * **그 좌석은 영구히 소멸한다.** 정원 10석이 9석이 되고 아무도 이유를 모른다.
 *
 * `soldOutAt` 을 같은 문장 안에서 설정하는 이유: 별도 UPDATE 로 빼면 Event 행을 두 번 만지게 되고
 * 그 사이가 또 경합 창이 된다(D-02 가 약속한 "단일 원자적 조건부 UPDATE 하나"가 깨진다).
 *
 * @returns 새로 점유했으면 true, 이미 점유돼 있었으면 false(멱등 재생이므로 카운터를 건드리지 않는다).
 */
export async function claimInstantSlot(
  tx: Tx,
  applicationId: string,
  eventId: string,
): Promise<boolean> {
  const claimed = await tx.$executeRaw`
    UPDATE "Application" SET "slotClaimed" = true, "version" = "version" + 1, "updatedAt" = now()
    WHERE id = ${applicationId} AND "slotClaimed" = false
  `;

  if (claimed === 0) return false;

  const counted = await tx.$executeRaw`
    UPDATE "Event" e SET
      "claimedCount" = e."claimedCount" + 1,
      "soldOutAt"    = CASE WHEN e."claimedCount" + 1 >= e."capacity"
                            THEN COALESCE(e."soldOutAt", now()) ELSE e."soldOutAt" END,
      "version"      = e."version" + 1,
      "updatedAt"    = now()
    WHERE e.id = ${eventId}
      AND e.status = 'OPEN'
      AND e."suspendedAt" IS NULL
      AND e."deletedAt" IS NULL
      AND e."claimedCount" < e."capacity"
      AND now() >= e."applyStartAt"
      AND now() <  e."applyEndAt"
  `;

  // 0행이면 정원이 찼거나 이벤트가 닫혔다는 뜻이다. slotClaimed 만 true 로 남기면
  // 실측과 카운터가 어긋나므로(IC-16 이 경보할 drift) 트랜잭션 전체를 롤백한다.
  if (counted !== 1) {
    throw stateChanged('EVENT_SOLD_OUT', '정원이 모두 찼거나 신청이 마감되었습니다.');
  }

  return true;
}

/** 자리 반환. 점유와 정확히 대칭이다 — 가드가 `slotClaimed = true` 라 이중 차감이 불가능하다. (IC-15) */
export async function releaseInstantSlot(
  tx: Tx,
  applicationId: string,
  eventId: string,
): Promise<boolean> {
  const released = await tx.$executeRaw`
    UPDATE "Application" SET "slotClaimed" = false, "version" = "version" + 1, "updatedAt" = now()
    WHERE id = ${applicationId} AND "slotClaimed" = true
  `;

  if (released === 0) return false;

  await tx.$executeRaw`
    UPDATE "Event" e SET
      "claimedCount" = e."claimedCount" - 1,
      "soldOutAt"    = CASE WHEN e."claimedCount" - 1 < e."capacity" THEN NULL ELSE e."soldOutAt" END,
      "version"      = e."version" + 1,
      "updatedAt"    = now()
    WHERE e.id = ${eventId} AND e."claimedCount" > 0
  `;

  return true;
}

export interface BidHistoryEntry {
  applicationId: string;
  eventId: string;
  userId: string;
  source: BidSource;
  previousAmount: number | null;
  newAmount: number;
  depositRequiredAfter: number;
  depositId?: string | null;
  restoredLastBidAt?: Date | null;
  softClose?: SoftCloseOutcome;
  idempotencyKey?: string | null;
  ipHash?: string | null;
  actorType?: CoreActorType;
  actorUserId?: string | null;
}

/**
 * 금액이 움직인 모든 전이를 1행으로 남긴다. **취소도 포함이다.** (IC-13)
 *
 * `deltaAmount` 의 부호는 DB CHECK(`bid_history_delta_direction_chk`)가 소스별로 못 박고 있어서
 * 여기서 계산을 틀리면 트랜잭션이 죽는다 — 그게 의도다. 서비스 검사 하나가 회귀했을 때
 * "같은 금액 재입찰"(= 순수한 타이브레이크 시계 세탁)이 정상적인 RAISE 로 기록되면
 * 기록 자체가 거짓이 되고, 롤백도 감사도 복원할 근거를 잃는다.
 *
 * `bidAt` 을 now() 로 쓰는 이유: 같은 트랜잭션 안의 now() 는 전부 트랜잭션 시작 시각으로 동일하다.
 * 즉 Application.lastBidAt 과 이 행의 bidAt 이 **마이크로초까지 같은 값**이 된다 —
 * JS 로 만든 Date 를 넘기면 밀리초로 깎여 둘이 어긋난다(IC-04).
 */
export async function insertBidHistory(tx: Tx, entry: BidHistoryEntry): Promise<string> {
  const id = randomUUID();
  const softClose = entry.softClose ?? NO_EXTENSION;
  const delta = entry.newAmount - (entry.previousAmount ?? 0);

  await tx.$executeRaw`
    INSERT INTO "BidHistory"
      ("id","applicationId","eventId","userId","seq","source",
       "previousAmount","newAmount","deltaAmount","bidAt","restoredLastBidAt",
       "depositRequiredAfter","depositId","triggeredSoftClose","deadlineBefore","deadlineAfter",
       "idempotencyKey","actorType","actorUserId","ipHash","updatedAt")
    SELECT
      ${id}::text, ${entry.applicationId}::text, ${entry.eventId}::text, ${entry.userId}::text,
      COALESCE((SELECT MAX(b.seq) FROM "BidHistory" b
                WHERE b."applicationId" = ${entry.applicationId}), 0) + 1,
      ${entry.source}::"BidSource",
      ${entry.previousAmount}::int, ${entry.newAmount}::int, ${delta}::int,
      now(), ${entry.restoredLastBidAt ?? null}::timestamptz,
      ${entry.depositRequiredAfter}::int, ${entry.depositId ?? null}::text,
      ${softClose.extended}::boolean,
      ${softClose.deadlineBefore}::timestamptz, ${softClose.deadlineAfter}::timestamptz,
      ${entry.idempotencyKey ?? null}::text,
      ${entry.actorType ?? CoreActorType.USER}::"CoreActorType",
      ${entry.actorUserId ?? entry.userId}::text,
      ${entry.ipHash ?? null}::text,
      now()
  `;

  return id;
}

/**
 * 취소 이력. 금액을 **신청 행에서 직접 읽어** 쓴다. (IC-13)
 *
 * 서비스가 미리 읽어둔 값을 넘기지 않는 이유: 그 사이에 상향이 커밋됐으면 이력에는
 * 존재한 적 없는 금액이 남는다. `previousAmount = newAmount = 현재 amount`, `deltaAmount = 0` 은
 * `bid_history_delta_direction_chk` 가 CANCEL 에 대해 강제하는 형태 그 자체다.
 */
export async function insertCancelBidHistory(
  tx: Tx,
  entry: {
    applicationId: string;
    idempotencyKey: string | null;
    ipHash: string | null;
    actorType?: CoreActorType;
    actorUserId?: string | null;
  },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "BidHistory"
      ("id","applicationId","eventId","userId","seq","source",
       "previousAmount","newAmount","deltaAmount","bidAt",
       "depositRequiredAfter","idempotencyKey","actorType","actorUserId","ipHash","updatedAt")
    SELECT
      gen_random_uuid()::text, a.id, a."eventId", a."userId",
      COALESCE((SELECT MAX(b.seq) FROM "BidHistory" b WHERE b."applicationId" = a.id), 0) + 1,
      'CANCEL'::"BidSource",
      a."amount", a."amount", 0, now(),
      a."depositRequiredAmount",
      ${entry.idempotencyKey}::text,
      ${entry.actorType ?? CoreActorType.USER}::"CoreActorType",
      ${entry.actorUserId ?? null}::text,
      ${entry.ipHash}::text,
      now()
    FROM "Application" a
    WHERE a.id = ${entry.applicationId}
  `;
}

export interface OpenHoldInput {
  applicationId: string;
  eventId: string;
  userId: string;
  reason: DepositReason;
  policy: EventDepositPolicy;
  /** 산정 근거가 된 신청 금액 */
  basisAmount: number;
  /** 그 금액에 필요한 총 예약금 */
  requiredAmount: number;
  /** 이번 홀드로 받아야 하는 금액(상향이면 차액). 반드시 > 0 이어야 한다. */
  amountDue: number;
  /** 실제 PG 집행이 켜져 있었는지의 스냅샷 (D-05) */
  paymentEnabled: boolean;
}

/**
 * 예약금 홀드를 연다. **열린 홀드의 status 는 언제나 PENDING 하나다.** (IC-22)
 *
 * 상향 부족분인지 여부는 `reason` 이 구분한다. `SHORTFALL_PENDING` 을 여기에 쓰면
 * `one_open_deposit` 부분 유니크와 `deposit_sweep_idx` 술어 어디에도 안 걸려서
 * 홀드가 **영원히 만료되지 않고** 같은 신청에 또 다른 열린 홀드를 만들 수 있게 된다.
 * "금액만 올려놓고 차액은 안 내기"가 영구 이득이 되는 경로다.
 *
 * `windowMinutes` 를 행에 스냅샷하는 이유: 이벤트의 값은 나중에 바뀔 수 있는데(IC-26 은 감소만 막는다)
 * 이미 열린 홀드의 만기는 그때 약속한 창이어야 한다.
 */
export async function openDepositHold(tx: Tx, input: OpenHoldInput): Promise<string> {
  const id = randomUUID();
  const { policy } = input;

  await tx.$executeRaw`
    INSERT INTO "Deposit"
      ("id","applicationId","eventId","userId","seq","reason",
       "basisAmount","depositType","depositFixedAmount","depositPercentBp",
       "requiredAmount","amountDue","amountPaid","windowMinutes",
       "openedAt","dueAt","status","featureFlagSnapshot","updatedAt")
    SELECT
      ${id}::text, ${input.applicationId}::text, ${input.eventId}::text, ${input.userId}::text,
      COALESCE((SELECT MAX(d.seq) FROM "Deposit" d
                WHERE d."applicationId" = ${input.applicationId}), 0) + 1,
      ${input.reason}::"DepositReason",
      ${input.basisAmount}::int,
      ${policy.depositType ?? DepositType.FIXED}::"DepositType",
      ${policy.depositFixedAmount}::int, ${policy.depositPercentBp}::int,
      ${input.requiredAmount}::int, ${input.amountDue}::int, 0,
      ${policy.depositWindowMinutes}::int,
      now(), now() + make_interval(mins => ${policy.depositWindowMinutes}::int),
      'PENDING'::"DepositStatus", ${input.paymentEnabled}::boolean, now()
  `;

  return id;
}

/**
 * 이미 열려 있는 홀드의 청구 금액을 위로 조정한다. 시계는 **그대로 둔다**.
 *
 * 상향할 때마다 새 홀드를 열면 `depositDueAt` 이 매번 새로 열려서, 최소 단위로 계속 올리며
 * 예약금 납부를 무한히 미룰 수 있다(IC-14 가 재신청에서 막는 것과 같은 어뷰징이다).
 * 같은 홀드의 금액만 올리면 만기는 처음 약속한 그대로다.
 *
 * 만기가 이미 지난 홀드는 건드리지 않는다 — 그건 스위퍼(또는 지연 만료)가 처리할 대상이고,
 * 여기서 되살리면 만료된 홀드가 조용히 부활한다.
 */
export async function raiseOpenHold(
  tx: Tx,
  depositId: string,
  next: { basisAmount: number; requiredAmount: number; amountDue: number },
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "Deposit" d SET
      "basisAmount"    = ${next.basisAmount}::int,
      "requiredAmount" = ${next.requiredAmount}::int,
      "amountDue"      = ${next.amountDue}::int,
      "updatedAt"      = now()
    WHERE d.id = ${depositId}
      AND d.status = 'PENDING'
      AND d."dueAt" > now()
      AND d."amountDue" <= ${next.amountDue}::int
  `;

  assertAffected(affected, 1, 'DEPOSIT_HOLD_NOT_OPEN');
}

/** 취소·이벤트 종료로 홀드를 닫는다. 만료(EXPIRED)와 달리 사용자의 의사로 닫힌 것이다. */
export async function cancelOpenHold(tx: Tx, applicationId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Deposit" d SET
      status       = 'CANCELED'::"DepositStatus",
      "resolvedAt" = now(),
      "updatedAt"  = now()
    WHERE d."applicationId" = ${applicationId} AND d.status = 'PENDING'
  `;
}

export interface OutboxNotification {
  userId: string;
  type: NotificationType;
  category: NotificationCategory;
  priority?: NotificationPriority;
  titleKo: string;
  bodyKo: string;
  payload: Record<string, unknown>;
  /** payload 키 화이트리스트. 본인 금액처럼 "본인에게는 본인 정보"인 값만 넣는다. */
  allowKeys?: readonly string[];
  deepLinkPath: string;
  eventId: string;
  applicationId: string;
  dedupeKey: string;
  /** 메일 제목·본문. 생략하면 앱 내 알림만 만든다. */
  email?: { subjectKo: string; bodyText: string };
}

/**
 * 알림을 아웃박스에 넣는다. 도메인 쓰기와 **같은 트랜잭션**이다. (IC-42)
 *
 * 트랜잭션 안에서 Resend 를 부르면 (a) 락을 든 채 네트워크를 기다리고
 * (b) 커밋이 실패해도 메일은 이미 나갔다. 반대로 커밋 뒤에 부르면 그 사이 함수가 죽었을 때
 * 알림이 영영 안 나간다. 아웃박스가 이 둘을 동시에 푸는 유일한 방법이다.
 *
 * `ON CONFLICT DO NOTHING` 이 반드시 필요하다(IC-41). 재시도된 요청의 유니크 위반이
 * 예외로 튀면 **신청·상향 같은 도메인 연산 자체가 롤백**된다 — 중복 알림 하나 때문에
 * 입찰이 실패하는 건 우선순위가 완전히 뒤바뀐 것이다.
 */
export async function enqueueNotification(tx: Tx, input: OutboxNotification): Promise<void> {
  // D-07 / IC-44: 알림 payload 는 공개 응답과 같은 규칙을 받는다.
  // "8만원에 밀리셨습니다" 같은 문구는 커트라인을 그대로 알려주는 것과 같으므로,
  // 타인의 금액·커트라인·본인 순위가 섞이면 템플릿에 닿기 전에 여기서 터진다.
  assertNoVisibilityLeak(input.payload, `${input.type} 알림 payload`, {
    allow: input.allowKeys,
  });

  const notificationId = randomUUID();

  const created = await tx.$executeRaw`
    INSERT INTO "Notification"
      ("id","userId","type","category","priority","titleKo","bodyKo","payload",
       "deepLinkPath","eventId","applicationId","dedupeKey","updatedAt")
    VALUES (
      ${notificationId}, ${input.userId},
      ${input.type}::"NotificationType",
      ${input.category}::"NotificationCategory",
      ${input.priority ?? NotificationPriority.NORMAL}::"NotificationPriority",
      ${input.titleKo}, ${input.bodyKo},
      ${JSON.stringify(input.payload)}::jsonb,
      ${input.deepLinkPath}, ${input.eventId}, ${input.applicationId},
      ${input.dedupeKey}, now()
    )
    ON CONFLICT ("userId","dedupeKey") DO NOTHING
  `;

  // 중복이라 알림이 안 만들어졌으면 메일 행도 만들지 않는다.
  // 만들면 존재하지 않는 notificationId 를 가리켜 FK 위반으로 도메인 트랜잭션이 죽는다.
  if (created !== 1 || !input.email) return;

  const deliveryId = randomUUID();

  await tx.$executeRaw`
    INSERT INTO "EmailDelivery"
      ("id","notificationId","recipientUserId","channel","status",
       "toAddress","subjectKo","bodyText","idempotencyKey","nextAttemptAt","updatedAt")
    SELECT ${deliveryId}::text, ${notificationId}::text, u.id, 'EMAIL'::"NotificationChannel",
           'PENDING'::"DeliveryStatus",
           COALESCE(u."notificationEmail", u.email),
           ${input.email.subjectKo}::text, ${input.email.bodyText}::text,
           ${deliveryId}::text, now(), now()
    FROM "User" u
    WHERE u.id = ${input.userId}
      AND COALESCE(u."notificationEmail", u.email) IS NOT NULL
    ON CONFLICT DO NOTHING
  `;
}
