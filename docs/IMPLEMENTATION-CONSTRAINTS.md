# Dibs — 구현 제약

> 확정일: 2026-07-27
> 이 문서는 **애플리케이션 코드가 반드시 지켜야 하는 규칙**을 남기는 곳입니다.
> 제품 의도는 `DECISIONS.md`, 자료구조는 `apps/api/prisma/schema.prisma` 를 보세요.
>
> 여기 적힌 것들은 스타일 권고가 아니다. 전부 **스키마만으로는 막을 수 없어서 코드로 내려온 불변식**이고,
> 하나씩 어길 때마다 대응하는 구체적인 경합·어뷰징 경로가 열린다. 그 경로를 각 항목의 **왜**에 적어뒀다.
>
> 각 규칙은 `규칙 / 왜 / 코드` 세 덩어리다. **코드 블록은 예시가 아니라 형태 그 자체**다.
> 특히 조건부 UPDATE 의 WHERE 절에서 조건을 하나 빼면 그 규칙은 무효가 된다.

---

## 읽기 전에 — 이 문서가 서 있는 전제 3개

1. **서버리스다.** 상주 프로세스가 없고 인스턴스가 동시에 여러 개 뜬다.
   "서비스 레이어에서 먼저 확인하고 그다음 쓴다"는 전부 TOCTOU 다. 확인은 **쓰기 문장의 WHERE 절 안에** 있어야 한다.
2. **pgbouncer transaction 모드다.** 세션 단위 상태(세션 자문 락, `SET LOCAL` 밖의 설정, 준비된 문장)를
   트랜잭션 밖으로 넘길 수 없다. 자문 락은 무조건 `pg_advisory_xact_lock` 이다.
3. **시간의 원천은 DB 의 `now()` 하나뿐이다.** 서버리스 인스턴스들의 벽시계는 서로 어긋나고,
   `lastBidAt` 은 D-04 의 순위 결정 키다. JS 에서 만든 `new Date()` 를 순위에 영향 주는 컬럼에 넣는 순간
   그 이벤트의 공정성은 인스턴스 시계 오차에 종속된다.

---

# IC-0. 공통 — 모든 모듈에 적용

## IC-01. 조건부 UPDATE 의 영향 행 수를 반드시 검사한다

**규칙**: 상태를 전이시키는 모든 쓰기는 `WHERE` 에 **현재 상태 전제를 전부** 적고,
영향 행 수가 기대값(대부분 1)이 아니면 **트랜잭션 전체를 롤백**한다. `updateMany` 의 `count` 를 버리지 않는다.

**왜**: `findUnique` 로 읽고 → 검사하고 → `update` 하는 코드는 두 문장 사이에 다른 인스턴스가 끼어들 수 있다.
디파짓 확인에서 이게 터지면 이미 만료되어 자리가 남에게 넘어간 신청이 `CONFIRMED` 로 되살아난다.
`update({ where: { id } })` 는 "행이 있으면 무조건 덮어쓴다"는 뜻이라 이 계열 버그를 구조적으로 막지 못한다.

**코드**:

```ts
// apps/api/src/common/db/assert-affected.ts
export function assertAffected(count: number, expected: number, code: string): void {
  // 0 이면 "그 사이에 전제가 깨졌다"는 뜻이지 "없는 행"이 아니다. 409 로 올려 클라이언트가 재조회하게 한다.
  if (count !== expected) throw new ConflictException({ code, expected, actual: count });
}

const { count } = await tx.application.updateMany({
  where: { id, version: expectedVersion, status: 'PENDING_DEPOSIT' },
  data: { status: 'VALID', version: { increment: 1 } },
});
assertAffected(count, 1, 'APPLICATION_STATE_CHANGED');
```

---

## IC-02. 락 획득 순서는 전 코드베이스에서 하나다

**규칙**: 한 트랜잭션 안에서 락을 두 개 이상 잡는다면 순서는 **항상**
`pg_advisory_xact_lock(감사 체인) → Event → Application → Deposit → SelectionEntry` 다.
자문 락이 필요한 트랜잭션이면 그게 **첫 문장**이다.

**왜**: finalize 트랜잭션은 Event → Application 순으로, 감사 로그를 먼저 쓰는 트랜잭션은
Application → Event 순으로 잡기 쉽다. 이 둘이 만나면 데드락이고,
Vercel 함수 타임아웃 안에서는 재시도조차 못 하고 500 이 나간다.
자문 락을 트랜잭션 중간에서 잡으면 이미 잡은 행 락을 든 채로 대기하게 되어 순서 규칙이 깨진다.

**코드**:

```sql
-- 감사 행을 쓰는 트랜잭션의 첫 문장. 반드시 xact(세션 아님) — pgbouncer transaction 모드다.
SELECT pg_advisory_xact_lock(hashtext($1));  -- $1 = chainKey, 예: 'event:clx...'
```

---

## IC-03. 멱등성 레코드는 도메인 쓰기와 **같은 트랜잭션**에 넣는다

**규칙**: 상태를 바꾸는 모든 엔드포인트는 `Idempotency-Key` 를 요구하고,
`IdempotencyRecord` 삽입을 도메인 쓰기와 같은 Postgres 트랜잭션에서 수행한다.
Vercel KV·Redis 로 대체 금지.

프로토콜은 넷이다.
- 삽입 성공 → 처음 보는 요청. 도메인 로직 수행 후 같은 트랜잭션에서 `responseStatus/responseBody/completedAt` 채움.
- 충돌 + `requestHash` 동일 + `completedAt` 있음 → **저장된 응답을 그대로 재생**.
- 충돌 + `requestHash` 동일 + `completedAt` NULL → 아직 진행 중. **409 + Retry-After**.
- 충돌 + `requestHash` 다름 → 재생이 아니라 키 재사용이다. **422**. (409 아님 — 재시도로 풀리는 상황이 아니다.)

**왜**: 마감 직전 상향 요청이 네트워크로 유실되면 클라이언트는 재시도한다.
그런데 첫 시도는 이미 커밋됐으므로 재시도는 `WHERE version=$expected` 에서 밀려 409 를 받는다.
사용자에게는 "실패"로 보이고, 클라이언트가 이를 "더 높은 금액으로 다시"로 해석하면 **돈이 나가는 실패**가 된다.
외부 저장소(KV)로 빼면 `claimedCount` 를 올리는 트랜잭션에 참여할 수 없어서,
"KV 에는 기록됐는데 DB 는 롤백된" 상태 — 즉 영구 유령 성공 — 이 만들어진다.

**코드**:

```sql
-- 1) 선점. PK insert 자체가 상호배제다.
INSERT INTO "IdempotencyRecord" ("userId","endpoint","key","requestHash","lockedAt","expiresAt")
VALUES ($1, $2, $3, $4, now(), now() + interval '24 hours')
ON CONFLICT ("userId","endpoint","key") DO NOTHING
RETURNING 1;

-- 2) 0행이면 기존 행을 읽어 분기한다.
SELECT "requestHash", "responseStatus", "responseBody", "completedAt"
FROM "IdempotencyRecord" WHERE "userId"=$1 AND "endpoint"=$2 AND "key"=$3;

-- 3) 도메인 로직이 끝나면 같은 트랜잭션에서 마감한다.
UPDATE "IdempotencyRecord"
SET "responseStatus"=$5, "responseBody"=$6, "completedAt"=now()
WHERE "userId"=$1 AND "endpoint"=$2 AND "key"=$3;
```

---

## IC-04. 순위·시각에 닿는 값은 JS 에서 만들지 않는다

**규칙**: `lastBidAt`, `firstAppliedAt`, `settledLastBidAt`, `*Snapshot` 계열은 **SQL 안에서만** 설정·비교·정렬한다.
`new Date()` 를 넣지 않고, TS 에서 정렬하지 않고, TS 에서 해시하지 않는다.

**왜**: 이 컬럼들은 `Timestamptz(6)` — 마이크로초다. Prisma 는 이걸 JS `Date` 로 역직렬화하는데
JS `Date` 는 **밀리초**다. 즉 DB 안에서는 순서가 확정된 두 입찰이 TS 에서는 동점으로 보인다.
그러면 (a) TS 정렬 결과가 `application_rank_idx` 의 순서와 어긋나고,
(b) TS 에서 계산한 `rankingSnapshotHash` 는 **DB 에서 재현 불가능**해진다.
분쟁이 생겼을 때 "그때 순위가 이랬음"을 증명하려고 만든 해시가 증명을 못 하면 존재 이유가 없다.

**코드**:

```sql
-- 시각 설정: 항상 now(). 애플리케이션이 만든 타임스탬프를 넣지 않는다.
UPDATE "Application" SET "lastBidAt" = now() WHERE ...

-- 해시: 문자열화도 SQL 안에서. 마이크로초(US)까지 포함해야 컬럼과 1:1 대응한다.
--       sha256() 은 PG 내장이라 pgcrypto 없이 동작한다.
SELECT encode(sha256(convert_to(string_agg(
         a.id || '|' || a."amount"::text || '|' ||
         to_char(a."lastBidAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
         a."applySeq"::text,
         E'\n' ORDER BY a."amount" DESC, a."lastBidAt" ASC, a."applySeq" ASC
       ), 'UTF8')), 'hex')
FROM "Application" a
WHERE a."eventId" = $1 AND a.status IN ('VALID','CONFIRMED');
```

> TS 가 정확한 값을 정말 필요로 하는 날이 오면, 컬럼을 읽어 변환하지 말고
> `lastBidAtUs BigInt` 를 추가해서 **정수로** 내보내라.

---

## IC-05. 공개 응답에 금액·순위·커트라인을 절대 싣지 않는다 ★

**규칙**: 이용자 응답을 만드는 경로는 전용 Prisma 클라이언트(`publicPrisma`)를 쓴다.
아래 필드는 `omit` 으로 **클라이언트 레벨에서** 제거한다. 매퍼에서 골라 담는 것에 의존하지 않는다.
그리고 공개 DTO 의 키 집합을 고정하는 **계약 테스트**를 둔다.

**왜**: D-07 은 "자기 순위도 볼 수 없다"이고 커트라인은 파트너 화면 밖으로 절대 나가면 안 된다.
그런데 방어가 매퍼 화이트리스트뿐이면, `include` 를 한 줄 추가하거나 새 핸들러를 하나 만드는 것만으로 규칙이 깨진다.
그건 코드 리뷰로 잡아야 하는 종류의 실수이고, 리뷰는 반드시 언젠가 놓친다.
스키마 쪽에서 `Application.finalRank` 를 지우고 커트라인을 `SelectionCutoff` 로 분리한 것이 1차 방어,
이 `omit` 맵이 2차 방어다. **둘 다 필요하다.**

**코드**:

```ts
// apps/api/src/prisma/public-prisma.client.ts
export const publicPrisma = new PrismaClient({
  omit: {
    application:     { settledAmount: true, settledLastBidAt: true, highestAmountEver: true, partnerNote: true },
    selectionEntry:  { amountSnapshot: true, rankNo: true, tieOrdinal: true, tieGroupKey: true, withinCapacity: true },
    selectionCutoff: { cutoffAmount: true, cutoffLastBidAt: true, hasCutoffTie: true },
    bidHistory:      { ipHash: true },
  },
});
```

```ts
// 계약 테스트 — 필드가 늘어나면 여기서 먼저 깨져야 한다.
expect(Object.keys(dto)).toEqual([
  'id', 'eventId', 'status', 'amount', 'depositStatus', 'depositDueAt', 'createdAt',
]); // amount 는 "본인이 적어낸 금액"이라 본인에게는 공개다. rank/cutoff 는 아니다.
```

> 파트너·운영자 조회는 **별도 리포지토리**를 통해서만 기본 클라이언트에 접근한다.
> 알림 문구 `payload` 도 같은 규칙을 받는다 → IC-44.

---

# IC-1. 신청·입찰 모듈

## IC-11. BID 신청 트랜잭션의 첫 문장은 Event 에 대한 `FOR SHARE` 다 ★

**규칙**: BID 신청·상향 트랜잭션은 **가장 먼저** 아래 문장을 실행하고, 0행이면 즉시 409 로 끝낸다.
`FOR UPDATE` 가 아니라 `FOR SHARE` 다.

**왜**: 마감 UPDATE(크론 또는 소프트 클로즈 종료)와 신청 INSERT 사이에 경합이 있다.
잠금이 없으면 `applyEndAt` 을 읽은 뒤 INSERT 하기까지 사이에 이벤트가 `CLOSED` 로 전이될 수 있고,
그 신청은 **마감 이후에 커밋된 채로 랭킹에 포함된다**. 이후 파트너 화면에는 마감 시각보다 늦은 입찰이 1등으로 뜬다.

`FOR SHARE` 인 이유: 공유 락은 서로 충돌하지 않으므로 **신청자들끼리는 직렬화되지 않고**,
행을 실제로 바꾸는 마감/연장 UPDATE 하고만 충돌한다. `FOR UPDATE` 로 하면 마감 직전 몰리는
수백 건의 신청이 한 줄로 서게 되어, 정원 초과를 허용해서(D-03) 없앤 병목을 손으로 다시 만드는 꼴이 된다.

`status='SUSPENDED'` 검사가 같이 들어가는 이유: 운영자 정지가 이 가드에 반영되지 않으면 정지가 장식이 된다.

**코드**:

```sql
-- 트랜잭션 첫 문장. 0행이면 EVENT_NOT_ACCEPTING(409).
SELECT 1
FROM "Event"
WHERE id = $1
  AND status = 'OPEN'
  AND "suspendedAt" IS NULL
  AND "deletedAt" IS NULL
  AND now() >= "applyStartAt"
  AND now() <  "applyEndAt"
FOR SHARE;
```

```ts
await prisma.$transaction(async (tx) => {
  const gate = await tx.$queryRaw<{ ok: number }[]>`... FOR SHARE`;
  if (gate.length === 0) throw new ConflictException('EVENT_NOT_ACCEPTING');
  // 이 아래부터만 신청 INSERT / 상향 UPDATE
});
```

---

## IC-12. "상향만 가능"은 서비스 검사가 아니라 WHERE 절이다

**규칙**: 상향(RAISE)과 재신청(REAPPLY)은 아래 술어를 **쓰기 문장 안에** 넣는다.
`amount < $new` 와 `highestAmountEver <= $new` 둘 다 필요하다.

**왜**: D-06 은 하향 금지이고, "취소 후 재신청으로 시각을 리셋하는 우회"도 금지다.
서비스 레이어에서 읽고 비교하면 동시 요청 두 개가 각각 통과해서 낮은 쪽이 나중에 커밋될 수 있다.
`highestAmountEver` 를 함께 거는 이유는 취소·롤백을 거친 뒤 **과거에 한 번 불렀던 금액보다 낮게**
다시 들어오는 경로를 막기 위해서다. `amount` 만 보면 롤백(D-06)으로 내려간 금액이 새 바닥이 된다.

**코드**:

```sql
UPDATE "Application"
SET "amount"            = $new,
    "lastBidAt"         = now(),          -- IC-04: 반드시 DB 시계
    "highestAmountEver" = GREATEST("highestAmountEver", $new),
    "rebidCount"        = "rebidCount" + 1,
    "version"           = "version" + 1
WHERE id = $1
  AND "version" = $2
  AND status IN ('PENDING_DEPOSIT','VALID')
  AND "amount" < $new
  AND "highestAmountEver" <= $new
  AND ($new - COALESCE($minAmount, 0)) % $amountStep = 0;   -- amountStep >= 1 은 DB CHECK 가 보장
-- affected = 1 아니면 롤백 (IC-01)
```

---

## IC-13. 취소는 반드시 `BidSource.CANCEL` 이력 1행을 남긴다

**규칙**: 취소 시 `Application` 상태 전이와 **같은 트랜잭션**에서 `BidHistory` 에 `source='CANCEL'` 행을 쓴다.
`previousAmount = newAmount = 현재 amount`, `deltaAmount = 0`, `actorType`, `ipHash` 를 채운다.
`Application.canceledAt` 은 **최초 1회만** 채우고(덮어쓰지 않는다), `lastCanceledAt` 을 갱신한다.

**왜**: 취소를 스칼라 컬럼 하나로만 남기면 재신청 때 덮어써져 흔적이 사라진다.
그러면 "취소 → 대기 → 재신청"을 반복해 타이브레이크 시계를 세탁하는 어뷰징을
사후에 탐지할 수도, 증명할 수도 없다. `bid_history_user_time_idx` 로 **이벤트를 가로질러** 추적하려면
그 행이 실제로 있어야 한다.

**코드**:

```sql
INSERT INTO "BidHistory"
  ("id","applicationId","eventId","userId","seq","source",
   "previousAmount","newAmount","deltaAmount","bidAt","actorType","ipHash")
SELECT $1, a.id, a."eventId", a."userId",
       COALESCE((SELECT MAX(b.seq) FROM "BidHistory" b WHERE b."applicationId"=a.id), 0) + 1,
       'CANCEL', a."amount", a."amount", 0, now(), $2, $3
FROM "Application" a
WHERE a.id = $4;

UPDATE "Application"
SET status='CANCELED',
    "cancelReason"=$5,
    "canceledAt"=COALESCE("canceledAt", now()),   -- 최초 취소 시각은 보존
    "lastCanceledAt"=now(),
    "version"="version"+1
WHERE id=$4 AND "version"=$6 AND status IN ('PENDING_DEPOSIT','VALID');
```

---

## IC-14. 재신청은 새 시계를 받는다. 그리고 10분에 1회다

**규칙**: 재신청은 `lastBidAt = now()` 로 **새로 받는다** — 취소 이전의 시계를 되돌려주지 않는다.
`highestAmountEver` 하한이 그대로 적용되고, 레이트리밋은 서비스 검사가 아니라 **UPDATE 의 WHERE 절**에 넣는다.
`BidHistory` 에 `source='REAPPLY'`, `deltaAmount >= 0` 으로 남긴다.

**왜**: D-06 이 막으려는 "취소 후 재신청으로 시각을 리셋하는 우회"가 정확히 이것이다.
D-04 의 2순위 키는 **오름차순 — 먼저 부른 사람이 이긴다**. 즉 이른 `lastBidAt` 이 자산이다.
재신청 때 옛 값을 이어주면, 취소로 디파짓 의무나 롤백을 회피한 사람이 **그 자산을 그대로 들고 돌아온다**.
그게 `BidSource.CANCEL` 을 추가하면서 스키마 주석에 적어둔 "타이브레이크 시계 세탁"이다.
새 시계를 받으면 그 사람은 방금 들어온 신규 신청자와 정확히 같은 대우를 받고, 세탁할 대상이 사라진다.

레이트리밋이 별도로 필요한 이유는 남은 이득이 하나 더 있어서다 —
재신청마다 `depositDueAt` 이 새로 열린다. 상한이 없으면 취소·재신청을 반복해
디파짓을 영원히 미루면서 INSTANT 자리를 잡았다 놨다 할 수 있다.
WHERE 절에 두는 이유는 서비스 검사로 하면 동시 요청 두 개가 같이 통과하기 때문이다.

**코드**:

```sql
UPDATE "Application"
SET status='PENDING_DEPOSIT',
    "amount"=$new,
    "lastBidAt"=now(),                      -- 새 시계. 옛 시계를 돌려주지 않는 것이 D-06 이다.
    "highestAmountEver"=GREATEST("highestAmountEver", $new),
    "reapplyCount"="reapplyCount"+1,
    "lastReapplyAt"=now(),
    "version"="version"+1
WHERE id=$1
  AND status='CANCELED'
  AND "highestAmountEver" <= $new          -- 하향 재진입 차단 (IC-12 와 같은 하한)
  AND ("lastReapplyAt"  IS NULL OR "lastReapplyAt"  <= now() - interval '10 minutes')
  AND ("lastCanceledAt" IS NULL OR "lastCanceledAt" <= now() - interval '10 minutes');
-- affected = 0 → REAPPLY_RATE_LIMITED(429) 또는 상태 충돌(409).
-- 둘을 구분해 응답하려면 별도 SELECT 로 사유를 조회한다(쓰기 경로에는 넣지 않는다).
```

> `firstAppliedAt` 은 그대로 둔다. 그건 표시·포렌식 값이고 랭킹 키가 아니다(IC-33 의 자격 술어에서만 쓰인다).

---

## IC-15. INSTANT 자리 점유와 반환은 **대칭**이어야 한다 ★

**규칙**: 자리를 잡는 경로도 반환 경로와 똑같이 조건부여야 한다.
`Application.slotClaimed` 를 먼저 `false → true` 로 바꾸고, **그 UPDATE 가 1행을 바꿨을 때만**
`Event.claimedCount` 를 증가시킨다. Event UPDATE 가 0행이면 트랜잭션 전체를 롤백한다.
`soldOutAt` 은 **같은 문장 안에서** 설정한다.

**왜**: 지금까지 반환 경로만 `WHERE slotClaimed = true` 로 보호돼 있었다.
점유 쪽이 무조건 `claimedCount + 1` 이면, 재시도된 재신청 요청 하나가 같은 신청에 대해
카운터를 두 번 올린다. `slotClaimed` 는 이미 true 라 반환은 한 번밖에 안 일어나므로
**그 좌석은 영구히 소멸한다** — 정원 10석짜리가 9석으로 줄고, 아무도 이유를 모른다.
`soldOutAt` 을 별도 UPDATE 로 빼면 D-02 가 약속한 "단일 원자적 조건부 UPDATE 하나"가 깨져서
Event 행을 두 번 만지게 되고, 그 사이가 또 경합 창이 된다.

**코드**:

```sql
-- (1) 신청 쪽 점유. 재생된 요청은 여기서 0행이 나온다.
UPDATE "Application" SET "slotClaimed" = true, "version" = "version" + 1
WHERE id = $1 AND "slotClaimed" = false;
-- 0행 → 이미 점유됨. 카운터를 건드리지 말고 멱등 재생 응답을 돌려준다(IC-03).

-- (2) 1행이었을 때만 실행. 0행이면 트랜잭션 전체 롤백.
UPDATE "Event"
SET "claimedCount" = "claimedCount" + 1,
    "soldOutAt"    = CASE WHEN "claimedCount" + 1 >= "capacity"
                          THEN COALESCE("soldOutAt", now()) ELSE "soldOutAt" END,
    "version"      = "version" + 1
WHERE id = $2
  AND status = 'OPEN' AND "suspendedAt" IS NULL
  AND "claimedCount" < "capacity"
  AND now() >= "applyStartAt" AND now() < "applyEndAt";
```

```sql
-- 반환(만료/취소). 대칭이다.
UPDATE "Application" SET "slotClaimed" = false WHERE id = $1 AND "slotClaimed" = true;
UPDATE "Event"
SET "claimedCount" = "claimedCount" - 1,
    "soldOutAt"    = CASE WHEN "claimedCount" - 1 < "capacity" THEN NULL ELSE "soldOutAt" END,
    "version"      = "version" + 1
WHERE id = $2 AND "claimedCount" > 0;
```

---

## IC-16. `claimedCount` 는 주기적으로 실측과 대사한다

**규칙**: `/api/cron/event-stats-refresh` 에 `mode='INSTANT'` 대상 재계산 단계를 넣는다.
자문 락 아래에서 돌리고, `claimedCountRefreshedAt` 를 찍고, **차이가 0이 아니면 경보**한다.

**왜**: IC-15 를 다 지켜도 스위퍼가 중간에 죽거나 운영자가 손으로 상태를 고치면 카운터는 어긋난다.
그리고 지금까지 그걸 **탐지할 방법이 아예 없었다**. 카운터가 실제보다 크면 남은 자리가 조용히 사라지고,
작으면 정원을 넘겨 판다. 둘 다 사용자가 먼저 발견하고 CS 로 들어온다.

**코드**:

```sql
SELECT pg_advisory_xact_lock(hashtext('claimed-reconcile:' || $1));

WITH before AS (
  SELECT "claimedCount" AS c FROM "Event" WHERE id = $1 FOR UPDATE
), actual AS (
  SELECT count(*)::int AS c FROM "Application"
  WHERE "eventId" = $1 AND "slotClaimed" = true
)
UPDATE "Event" e
SET "claimedCount" = (SELECT c FROM actual),
    "claimedCountRefreshedAt" = now()
WHERE e.id = $1 AND e.mode = 'INSTANT'
RETURNING (SELECT c FROM before) - (SELECT c FROM actual) AS drift;
-- drift <> 0 이면 로그가 아니라 경보다. 원인이 코드에 남아 있다는 뜻이다.
```

---

## IC-17. 소프트 클로즈 연장에는 **1인당 상한**이 걸린다

**규칙**: 연장은 단일 조건부 UPDATE 이고, WHERE 에 전체 상한(`softCloseMaxExtensions`)과
**1인당 상한**(`softCloseMaxExtensionsPerUser`) 을 모두 넣는다.
연장에 성공한 입찰의 `BidHistory.triggeredSoftClose` 를 true 로 남기고 `deadlineBefore/After` 를 채운다.

**왜**: 예약금이 FIXED 면 금액을 올려도 부족분이 0이라 "부족분이 있으면 연장하지 않는다"는 보호가 통째로 무력하다.
그 상태에서는 한 사람이 `amountStep` 만큼씩만 올리면서 마감을 혼자 6번 밀 수 있다(D-08 의 의도가 아니다).
1인당 카운트는 `bid_history_softclose_by_user_idx` 로 센다.
`LEAST(..., softCloseHardEndAt)` 이 있어야 무한 연장이 막히는데, `softCloseHardEndAt` 이 NULL 이면
`LEAST` 가 NULL 을 반환해 `applyEndAt` NOT NULL 위반이 나므로 그 조합은 DB CHECK 로 금지돼 있다.

**코드**:

```sql
UPDATE "Event" e
SET "applyEndAt"              = LEAST(e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
                                      e."softCloseHardEndAt"),
    "originalApplyEndAt"      = COALESCE(e."originalApplyEndAt", e."applyEndAt"),
    "rankingLockAt"           = LEAST(e."applyEndAt" + make_interval(mins => e."softCloseExtendMinutes"),
                                      e."softCloseHardEndAt")
                                + make_interval(mins => e."depositWindowMinutes" + 1),
    "softCloseExtensionCount" = e."softCloseExtensionCount" + 1,
    "version"                 = e."version" + 1     -- policyVersion 아님 (IC-63)
WHERE e.id = $1
  AND e."softCloseEnabled" = true
  AND e.status = 'OPEN'
  AND e."softCloseExtensionCount" < e."softCloseMaxExtensions"
  AND now() >= e."applyEndAt" - make_interval(mins => e."softCloseWindowMinutes")
  AND now() <  e."applyEndAt"
  AND (SELECT count(*) FROM "BidHistory" b
       WHERE b."eventId" = e.id AND b."userId" = $2 AND b."triggeredSoftClose")
      < e."softCloseMaxExtensionsPerUser"
RETURNING e."applyEndAt";
-- 0행은 오류가 아니다. "연장 조건에 해당하지 않음"이며 입찰 자체는 성공해야 한다.
```

---

## IC-18. 신청 생성에는 휴대폰 인증을 요구한다

**규칙**: `Application` INSERT 는 같은 트랜잭션에서 `User.phoneVerifiedAt IS NOT NULL` 을 검증한다.
그리고 신청 시점의 `ipHash` 를 `BidHistory` 에 남겨 `UserIdentityLink` 채우기의 근거로 쓴다.

**왜**: 구글 가입은 무제한이다. `phone` 은 nullable 이고 부분 유니크(`user_phone_uq`)는
`phoneVerifiedAt IS NOT NULL` 인 행에만 걸린다. 즉 **미인증 계정은 얼마든지 만들 수 있다**.
계정 3개면 INSTANT 자리 3개, BID 순위 3개를 먹고 D-07 의 경쟁률 표시까지 부풀린다.
`application_event_user_uq` 는 "1인 1신청"이 아니라 "1계정 1신청"만 보장한다 — 차이가 이 규칙이다.

**코드**:

```sql
INSERT INTO "Application" ("id","eventId","userId","eventMode","amount",
                           "lastBidAt","firstAppliedAt","settledAmount","settledLastBidAt","highestAmountEver", ...)
SELECT $1, $2, u.id, $3, $4, now(), now(), 0, now(), $4, ...
FROM "User" u
WHERE u.id = $5
  AND u."phoneVerifiedAt" IS NOT NULL
  AND u."deletedAt" IS NULL AND u."anonymizedAt" IS NULL
  AND u.status = 'ACTIVE';
-- 0행 → PHONE_VERIFICATION_REQUIRED(403). application_event_user_uq 위반 → ALREADY_APPLIED(409).
```

---

# IC-2. 디파짓 모듈

## IC-21. 디파짓 확인은 조건부 UPDATE 두 개이고 둘 다 정확히 1행이어야 한다 ★

**규칙**: 홀드 확정과 신청 상태 전이를 **하나의 트랜잭션 안 두 개의 조건부 UPDATE** 로 처리한다.
각각 영향 행 수 1을 단언하고, 어느 하나라도 아니면 전체를 롤백한다.

**왜**: PG 웹훅은 재전송이 정상이다. 조건 없이 `status='PAID'` 를 쓰면,
이미 만료되어 `EXPIRED` 로 넘어가고 **그 자리가 다른 사람에게 넘어간 뒤에** 도착한 재생 웹훅이
신청을 `CONFIRMED` 로 되살린다. 결과는 같은 좌석에 두 명이 확정된 상태이고,
DB 에는 그게 정상으로 보인다. 두 번째 UPDATE 의 `status='PENDING_DEPOSIT'` 조건이 이걸 막는 유일한 장치다.

**코드**:

```sql
-- (1) 홀드
UPDATE "Deposit"
SET status='PAID', "amountPaid"=$amount, "paidAt"=now(), "resolvedAt"=now()
WHERE id=$1 AND status='PENDING';
-- affected <> 1 → 롤백. (이미 만료 / 이미 납부 / 상향으로 대체됨)

-- (2) 신청
UPDATE "Application"
SET "depositStatus"     = 'PAID',
    "depositPaidAmount" = "depositPaidAmount" + $amount,
    status              = CASE WHEN "eventMode" = 'INSTANT' THEN 'CONFIRMED' ELSE 'VALID' END,
    "settledAmount"     = "amount",        -- 완납된 금액을 롤백 목표로 승격
    "settledLastBidAt"  = "lastBidAt",     -- 반드시 금액과 "쌍으로" 갱신
    "confirmedAt"       = COALESCE("confirmedAt", now()),
    "version"           = "version" + 1
WHERE id=$2 AND "version"=$3 AND status='PENDING_DEPOSIT';
-- affected <> 1 → 롤백.
```

> `settledAmount` 와 `settledLastBidAt` 을 따로 갱신하면 롤백(IC-23) 시 금액과 시각이 어긋난 조합이 복원되고,
> 그 조합은 D-04 의 순위 규칙상 존재한 적 없는 순위를 만든다. 항상 함께 쓴다.

---

## IC-22. 열린 홀드의 status 는 언제나 `PENDING` 하나다

**규칙**: `Deposit.status` 에 `SHORTFALL_PENDING` 을 **절대 쓰지 않는다**.
상향 부족분인지 여부는 `Deposit.reason`(`RAISE_SHORTFALL`)이 구분한다.
`SHORTFALL_PENDING` 은 `Application.depositStatus` 전용 값이다.

**왜**: `one_open_deposit` 부분 유니크와 `deposit_sweep_idx` 술어가 둘 다 `status='PENDING'` 을 본다.
`SHORTFALL_PENDING` 을 홀드에 쓰면 그 행은 두 술어 어디에도 안 걸린다.
결과: 그 홀드는 **영원히 만료되지 않고**, 동시에 같은 신청에 또 다른 열린 홀드를 만들 수 있게 된다.
"금액만 올려놓고 차액은 안 내기"가 영구 이득이 된다 — D-06 이 막으려던 바로 그 어뷰징이다.
이 규칙은 DB CHECK 로도 강제되지만, 코드가 그 값을 쓰려 하는 순간 런타임 500 이 나므로 여기 적어둔다.

**코드**:

```ts
// 상향 부족분 홀드 생성 — status 는 PENDING, 구분은 reason 이 한다.
await tx.deposit.create({
  data: {
    applicationId, eventId, userId,
    seq: nextSeq,
    reason: 'RAISE_SHORTFALL',     // ← 여기가 구분자
    status: 'PENDING',             // ← 언제나 PENDING
    /* ... */
  },
});
// 신청 쪽 비정규화 사본만 SHORTFALL_PENDING 을 가진다.
await tx.application.updateMany({
  where: { id: applicationId, version: expected },
  data: { depositStatus: 'SHORTFALL_PENDING', version: { increment: 1 } },
});
```

---

## IC-23. 부족분 미납 롤백은 금액과 시각을 쌍으로 되돌린다

**규칙**: 스위퍼가 `RAISE_SHORTFALL` 홀드를 만료시키면 신청은 무효화하지 않고
`settledAmount / settledLastBidAt` 조합으로 되돌린다. `BidHistory` 에 `source='ROLLBACK'`,
`deltaAmount < 0`, `restoredLastBidAt` 을 남긴다.

**왜**: D-06 이 명시적으로 정한 동작이다. 신청을 통째로 무효화하면 완납했던 금액까지 잃게 되어
사용자에게 부당하고, 아무것도 안 하면 "올리기만 하고 안 내기"가 이득이 된다.
`restoredLastBidAt` 이 이력에 없으면 나중에 "왜 내 순위가 내려갔나" 문의에 답할 근거가 없다.

**코드**:

```sql
UPDATE "Application"
SET "amount"        = "settledAmount",
    "lastBidAt"     = "settledLastBidAt",
    "depositStatus" = 'PAID',
    "version"       = "version" + 1
WHERE id = $1
  AND "depositStatus" = 'SHORTFALL_PENDING'
  AND "settledAmount" < "amount";
-- highestAmountEver 는 되돌리지 않는다. 그게 IC-12 의 재상향 하한이다.
```

---

## IC-24. 만료 스위퍼는 `SKIP LOCKED` 로 배치를 클레임한다

**규칙**: 크론 스위퍼는 `FOR UPDATE SKIP LOCKED` + `LIMIT` 으로 배치를 잡는다.
지연 만료(lazy expiry)도 같은 술어를 쓴다. 두 경로가 같은 행을 동시에 처리해도 안전해야 한다.

**왜**: Vercel Cron 은 겹쳐서 실행될 수 있고(이전 실행이 끝나기 전 다음 실행 시작), 함수는 타임아웃으로 죽는다.
`SKIP LOCKED` 가 없으면 두 실행이 같은 행에서 서로 기다리다 둘 다 타임아웃한다.
그리고 D-05 가 정한 대로 조회 시 지연 만료도 동시에 돌기 때문에, 만료 처리는 반드시 재진입 가능해야 한다.

**코드**:

```sql
SELECT id, "applicationId", "eventId"
FROM "Deposit"
WHERE status = 'PENDING' AND "dueAt" <= now()
ORDER BY "dueAt"
LIMIT 200
FOR UPDATE SKIP LOCKED;
```

---

## IC-25. 리마인더는 홀드당 정확히 1회 — `reminderSentAt` 로 클레임한다

**규칙**: 리마인더 발송은 "먼저 `reminderSentAt` 을 조건부로 찍고, 찍힌 행에 대해서만 알림을 만든다"는 순서다.
반대 순서로 하지 않는다.

**왜**: 매분 도는 크론이 상태 컬럼 없이 열린 홀드 전부에 대해 알림 INSERT 를 시도하면
`uq_notification_user_dedupe` 위반으로 트랜잭션을 굴려서 중복을 막는 꼴이 된다.
그건 중복 제거가 아니라 실패를 중복 제거로 착각하는 것이고, 같은 트랜잭션에 든 다른 도메인 쓰기까지 함께 롤백시킨다.

**코드**:

```sql
UPDATE "Deposit"
SET "reminderSentAt" = now()
WHERE id = ANY($1)
  AND status = 'PENDING'
  AND "reminderSentAt" IS NULL
  AND "dueAt" > now()
RETURNING id, "applicationId", "userId", "dueAt";
-- RETURNING 된 행에 대해서만 Notification 을 만든다 (IC-41).
```

---

## IC-26. 진행 중인 이벤트의 디파짓 윈도우는 줄일 수 없다

**규칙**: `status IN ('SCHEDULED','OPEN','CLOSED')` 인 이벤트에 대해
`depositWindowMinutes` 를 **감소**시키는 PATCH 는 거부한다(증가는 허용).
finalize 게이트에도 방어를 하나 더 둔다.

**왜**: 열린 홀드는 자기 `windowMinutes` 를 스냅샷으로 들고 있다. 윈도우를 줄이면 `rankingLockAt` 이 앞당겨지는데,
이미 열린 홀드의 `dueAt` 은 그대로다. 즉 **아직 만료되지 않은 홀드를 남긴 채로 순위가 확정된다**.
D-04 가 "마감 1분 전 신청자도 디파짓 10분을 온전히 쓴다"고 정한 것이 정확히 이 상황을 막으려는 것이다.

**코드**:

```sql
-- finalize 게이트: rankingLockAt 이 지났어도 열린 홀드가 남아 있으면 확정하지 않는다.
UPDATE "Event" e
SET status = 'CLOSED', "closedAt" = now(), "version" = e."version" + 1
WHERE e.id = $1
  AND e."rankingLockAt" <= now()
  AND NOT EXISTS (
        SELECT 1 FROM "Deposit" d
        WHERE d."eventId" = e.id AND d.status = 'PENDING' AND d."dueAt" > now()
      );
```

---

# IC-3. 순위·선정 모듈

## IC-31. 순위는 `ROW_NUMBER()` 로 계산한다. TS 정렬 금지 ★

**규칙**: 순위 계산·스냅샷 복사·해시는 전부 raw SQL 이다.
`ORDER BY "amount" DESC, "lastBidAt" ASC, "applySeq" ASC` — 이 세 키의 순서와 방향을 바꾸지 않는다.
스냅샷은 `INSERT ... SELECT` 로 DB 안에서 복사한다. 애플리케이션으로 꺼냈다가 다시 넣지 않는다.

**왜**: IC-04 에서 말한 마이크로초 문제가 여기서 실제 손해로 바뀐다.
Prisma 가 `Timestamptz(6)` 을 밀리초 `Date` 로 깎아서 주기 때문에,
DB 인덱스에서는 순서가 확정된 두 입찰이 TS 정렬에서는 임의 순서가 된다.
3순위 키를 `id`(cuid) 가 아니라 `applySeq`(BIGSERIAL) 로 만든 이유도 같다 —
cuid v1 이 "우연히" 시간순인 것에 공정성을 기대면, id 생성기를 바꾸는 순간 조용히 임의 순서가 된다.

**코드**:

```sql
INSERT INTO "SelectionEntry"
  ("id","selectionId","eventId","applicationId","userId",
   "displayNameSnapshot","amountSnapshot","lastBidAtSnapshot","appliedAtSnapshot",
   "rebidCountSnapshot","depositStatusSnapshot","depositPaidSnapshot",
   "rankNo","tieGroupKey","tieOrdinal","withinCapacity","source")
SELECT
  -- id 를 SQL 에서 만드는 이유: 애플리케이션으로 꺼냈다 넣으면 그 왕복에서 lastBidAt 이 밀리초로 깎인다.
  -- 다른 모델은 cuid 지만 이 컬럼은 String @id 라 형식을 강제하지 않는다.
  gen_random_uuid()::text, $1, a."eventId", a.id, a."userId",
  u."displayName", a."amount", a."lastBidAt", a."firstAppliedAt",
  a."rebidCount", a."depositStatus", a."depositPaidAmount",
  r.rank_no, r.tie_key, r.tie_ord, r.rank_no <= $2,
  CASE WHEN a."eventMode" = 'INSTANT' THEN 'INSTANT_CLAIM' ELSE 'AUTO_RANK' END
FROM (
  SELECT a2.id,
         ROW_NUMBER() OVER (ORDER BY a2."amount" DESC, a2."lastBidAt" ASC, a2."applySeq" ASC) AS rank_no,
         a2."amount"::text || '-' ||
           to_char(a2."lastBidAt" AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS')            AS tie_key,
         ROW_NUMBER() OVER (PARTITION BY a2."amount", a2."lastBidAt" ORDER BY a2."applySeq") AS tie_ord
  FROM "Application" a2
  WHERE a2."eventId" = $3
    AND a2.status IN ('VALID','CONFIRMED')      -- IC-32
    AND a2."firstAppliedAt" < $4                -- IC-33
) r
JOIN "Application" a ON a.id = r.id
JOIN "User" u        ON u.id = a."userId";
```

---

## IC-32. 자격 술어는 `status IN ('VALID','CONFIRMED')` 다. `= 'VALID'` 아니다

**규칙**: 라운드 개시·순위 계산·파트너 최종명단 조회의 술어는 언제나 두 값을 함께 본다.

**왜**: 두 모드의 종착 상태가 다르다. BID 신청은 디파짓 완납 후 `VALID` 에서 멈춰 파트너 심사를 기다리고,
INSTANT 신청은 즉시확정이라 `CONFIRMED` 에서 끝난다(D-02).
`status = 'VALID'` 로 거르면 **INSTANT 이벤트의 파트너 최종명단 화면이 통째로 빈다** — 0건이 나오고,
에러도 아니라서 아무도 눈치채지 못한다.
같은 이유로 `application_rank_idx` 는 일부러 부분 인덱스가 아닌 전체 인덱스다.

**코드**:

```ts
const ELIGIBLE_STATUSES = ['VALID', 'CONFIRMED'] as const satisfies readonly ApplicationStatus[];
// packages/shared 에 상수로 두고, 순위·선정 쿼리는 전부 이 상수만 참조한다.
```

---

## IC-33. 라운드 자격에 `firstAppliedAt < effectiveDeadlineAt` 을 함께 건다

**규칙**: 라운드 개시 쿼리는 이벤트 마감 조건에 더해 신청 자체의 시각도 확인한다.

**왜**: IC-11 의 `FOR SHARE` 가 있으면 마감 이후 신청은 원칙적으로 못 들어온다.
하지만 운영자 수동 조정, 크론 부분 실패, 과거 데이터 이관 같은 경로가 남아 있고,
순위 확정은 되돌리기 가장 비싼 연산이다. 술어를 하나 더 거는 비용은 인덱스 한 번이고,
안 걸었을 때의 비용은 확정된 명단을 뒤집는 것이다.

---

## IC-34. 스냅샷 컬럼은 write-once 다 — 코드가 UPDATE 하지 않는다

**규칙**: `SelectionEntry` 의 동결 스냅샷 필드
(`amountSnapshot`, `lastBidAtSnapshot`, `appliedAtSnapshot`, `rankNo`, `withinCapacity`,
`displayNameSnapshot`, `depositStatusSnapshot`, `depositPaidSnapshot`, `tieGroupKey`, `tieOrdinal`)
는 INSERT 이후 절대 UPDATE 하지 않는다. 심사 상태(`status`, `source`, `position`, override 계열)만 바꾼다.
재계산이 필요하면 **라운드를 새로 연다**(`roundNo + 1`).

**왜**: 스냅샷의 존재 이유는 "그 시점의 순위가 이랬음"을 나중에 증명하는 것이고,
`rankingSnapshotHash` 가 그 위에서 계산된다. 스냅샷을 나중에 고치면 해시가 재현 불가능해지고,
파트너가 순위를 사후에 조정할 수 있게 되어 D-04 의 규칙 자체가 무의미해진다.
DB 쪽 BEFORE UPDATE 트리거(`selection_entry_snapshot_immutable`)가 최종 방어선이지만,
그 트리거에 걸리는 건 이미 코드가 잘못 짜였다는 뜻이다.

---

## IC-35. 커트라인은 `SelectionCutoff` 에만 쓰고, 어떤 공개 경로에서도 읽지 않는다

**규칙**: 커트라인 계산 결과는 `SelectionCutoff` 에 upsert 한다.
`Event → selections` 를 타고 내려가는 공개 조회에서 `include: { cutoff: true }` 를 쓰지 않는다.
파트너·운영자 전용 리포지토리에서만 조인한다.

**왜**: D-07 이 비공개로 정한 숫자 중 커트라인이 가장 위험하다. 커트라인 하나가 새면
그 이벤트의 모든 참가자가 최소 낙찰가를 알게 되어 밀봉입찰이 공개입찰이 된다.
스칼라로 `Selection` 에 있을 때는 `include: { selections: true }` 한 줄로 공개됐다.
관계로 분리한 지금은 **기본 경로로는 절대 따라오지 않는다** — 그 구조를 코드가 되돌리면 안 된다.

**코드**:

```ts
// 파트너 전용 리포지토리에서만.
const cutoff = await prisma.selectionCutoff.findUnique({ where: { selectionId } });

// 공개 경로는 publicPrisma 를 쓰고(IC-05), selections 를 include 하지 않는다.
const event = await publicPrisma.event.findUnique({
  where: { id },
  select: { id: true, title: true, capacity: true, liveApplicantCount: true, competitionRatioX10: true },
});
```

---

# IC-4. 알림 모듈

## IC-41. 팬아웃은 언제나 `skipDuplicates: true` 다

**규칙**: `Notification` / `Message` 대량 삽입은 전부 `createMany({ data, skipDuplicates: true })` 다.
개별 `create` 를 루프로 돌리지 않는다.

**왜**: 알림 삽입은 도메인 트랜잭션 안에서 일어난다(트랜잭셔널 아웃박스).
`uq_notification_user_dedupe` 위반이 예외로 튀면 **"이벤트 취소" 같은 도메인 연산 자체가 롤백**된다.
중복 알림 하나 때문에 이벤트 취소가 실패하는 건 우선순위가 완전히 뒤바뀐 것이다.
`dedupeKey` 를 전역 유니크에서 `(userId, dedupeKey)` 로 바꾼 것도 같은 이유다 —
`EVENT_CANCELED:{eventId}` 같은 이벤트 단위 키는 두 번째 수신자에서 반드시 충돌한다.

**코드**:

```ts
await tx.notification.createMany({
  data: recipients.map((userId) => ({
    userId,
    type: 'EVENT_CANCELED',
    category: 'EVENT',
    dedupeKey: `EVENT_CANCELED:${eventId}`,   // 수신자별로 유니크 — 같은 키를 써도 된다
    titleKo, bodyKo, eventId,
  })),
  skipDuplicates: true,
});
```

---

## IC-42. 아웃박스 행은 도메인 쓰기와 같은 트랜잭션에서 만든다

**규칙**: `Notification` 과 대응하는 `EmailDelivery(status='PENDING')` 를 도메인 상태 변경과 같은 트랜잭션에서 삽입한다.
트랜잭션 안에서 Resend 를 호출하지 않는다. 실제 발송은 디스패치 크론이 `idx_email_delivery_dispatch` 로 집는다.

**왜**: 트랜잭션 안에서 외부 API 를 부르면 (a) 락을 든 채로 네트워크를 기다리게 되고,
(b) 커밋이 실패해도 메일은 이미 나갔다. "선정되셨습니다" 메일을 보낸 뒤 롤백되는 게 정확히 그 케이스다.
반대로 커밋 후에 부르면 그 사이 함수가 죽었을 때 알림이 영영 안 나간다.
아웃박스는 이 둘을 동시에 푸는 유일한 방법이다.

---

## IC-43. 이메일 프로바이더 웹훅은 시각과 상태 등급 두 가지로 방어한다

**규칙**: 웹훅 적용은 `lastProviderEventAt` 보다 새로운 이벤트에 대해서만 하고,
`BOUNCED` / `COMPLAINED` 는 어떤 이벤트로도 강등하지 않는다.

**왜**: 프로바이더 웹훅은 재전송·역순 도착이 정상 동작이다.
재생된 `delivered` 가 `bounced` 를 덮어쓰면 그 주소는 `EmailSuppression` 에서 풀려나고,
재시도 스윕이 죽은 주소로 계속 발송해서 도메인 발송 평판이 깎인다.
시각 가드만으로는 부족하다 — 같은 밀리초에 도착한 두 이벤트에서 순서가 뒤집힐 수 있어서 등급 가드가 함께 필요하다.

**코드**:

```sql
UPDATE "EmailDelivery"
SET status = $2, "lastProviderEventAt" = $3,
    "deliveredAt" = CASE WHEN $2 = 'DELIVERED' THEN $3 ELSE "deliveredAt" END
WHERE id = $1
  AND ("lastProviderEventAt" IS NULL OR $3 > "lastProviderEventAt")
  AND status NOT IN ('BOUNCED','COMPLAINED');   -- 종착 실패 상태는 되돌리지 않는다
```

---

## IC-44. 알림 문구·payload 는 D-07 화이트리스트를 통과해야 한다

**규칙**: `Notification.payload` 는 타입별 zod 스키마로 검증하고, 통과 못 하면 발송하지 않는다.
타인의 금액, 커트라인, 본인 순위는 어떤 타입에도 들어갈 수 없다.
그리고 **필수 범주 여부는 `packages/shared` 의 상수 맵에서 파생**한다 — DB 컬럼에서 읽지 않는다.

**왜**: 전자는 D-10 이 명시한 제약이다("알림 문구가 D-07 의 비공개 정보를 흘리면 안 된다").
후자는 `NotificationPreference.isMandatory` 를 컬럼에서 지운 이유와 같다 —
"필수 범주인가"는 범주의 성질이지 사용자의 성질이 아니다.
사용자 행에 두면 통짜 PUT 한 번으로 `DEPOSIT` 의 필수 플래그를 지우고 옵트아웃할 수 있고,
그러면 `DEPOSIT_REQUIRED` 를 못 받아 **자리와 돈을 동시에 잃는다**. 소비자 보호 실패다.

**코드**:

```ts
// packages/shared/src/notification/mandatory.ts
export const MANDATORY_CATEGORIES = ['DEPOSIT', 'RESULT', 'ACCOUNT'] as const;
export const isMandatory = (c: NotificationCategory) =>
  (MANDATORY_CATEGORIES as readonly string[]).includes(c);

// 발송 게이트
if (!isMandatory(category) && !pref.emailEnabled) skip('USER_OPTED_OUT');
```

---

# IC-5. 검색·탐색 모듈

## IC-51. 공개 목록 술어는 한 곳에만 존재한다

**규칙**: 공개 노출 조건은 상수 하나로 정의하고 모든 검색·목록·상세 쿼리가 그것만 쓴다.
`SUSPENDED`, `DRAFT`, `deletedAt IS NOT NULL` 은 어떤 공개 경로에도 나오지 않는다.

**왜**: `EventStatus.SUSPENDED` 를 추가한 이유가 "상태 하나로 모든 가드를 한 번에 닫는" 것이었다.
그런데 노출 술어가 핸들러마다 흩어져 있으면 새 엔드포인트 하나가 정지된 이벤트를 계속 보여준다.
운영자 정지가 장식이 되는 경로는 신청 가드만이 아니라 **검색 결과에도** 있다.

**코드**:

```ts
// packages/shared/src/event/visibility.ts
export const PUBLIC_EVENT_WHERE = {
  deletedAt: null,
  suspendedAt: null,
  status: { in: ['SCHEDULED', 'OPEN', 'CLOSED', 'FINALIZED'] },
} as const;
```

---

## IC-52. `Event.sigunguCode` 를 채우는 경로는 하나뿐이다

**규칙**: `Event.sigunguCode` 는 `venue.region.sigunguCode` 를 복사해서만 쓴다.
이벤트 생성·수정 시 EventModule 이 채우고, 클라이언트 입력을 그대로 받지 않는다.

**왜**: `Region.code` 와 `Venue.regionCode` 는 **법정동코드 10자리**이고, `Event.sigunguCode` 는
**행정표준코드 시군구 5자리**다. 이름만 비슷하고 값 공간이 겹치지 않는다.
전에 `Event.regionCode` 라는 같은 이름이었을 때는 복사하면 잘리고 조인하면 0건이 나왔다 —
그것도 조용히, 검색 결과가 비는 형태로. 이름은 바꿨지만 **채우는 책임은 여전히 코드에 있다**.

**코드**:

```ts
const venue = await tx.venue.findUniqueOrThrow({
  where: { id: dto.venueId },
  select: { id: true, region: { select: { sigunguCode: true } } },
});
await tx.event.create({
  data: { /* ... */ sigunguCode: venue.region?.sigunguCode ?? null },
});
```

---

## IC-53. 경쟁률 카운터는 신청 hot path 에서 갱신하지 않는다

**규칙**: `liveApplicantCount`, `totalApplicationCount`, `competitionRatioX10` 등 집계 캐시는
**크론과 지연 갱신에서만** 쓴다. 신청·상향 트랜잭션에서 건드리지 않는다.

**왜**: D-03 이 정원 강제를 포기해서 얻은 것이 "신청 경로에 공유 카운터가 없다"는 성질이다.
경쟁률 표시용 카운터를 신청 트랜잭션에서 올리는 순간, 모든 신청자가 **같은 Event 행을 UPDATE 하려고 줄을 선다** —
정원 초과 허용으로 없앤 병목을 표시용 숫자 하나 때문에 정확히 그대로 복구하는 것이다.
D-07 이 공개하는 건 근사치여도 되는 경쟁률뿐이다. 실시간 정확도가 필요 없다.

> 예외는 `Event.claimedCount` 하나뿐이다. 그건 표시용이 아니라 INSTANT 정원의 진실이고,
> D-02 가 정한 단일 원자적 UPDATE 로만 움직인다(IC-15).

---

# IC-6. 운영자 모듈

## IC-61. 감사 로그는 샤딩된 체인이고, 자문 락이 트랜잭션의 첫 문장이다 ★

**규칙**: `chainKey` 를 샤딩한다(핵심 도메인은 `'event:'||eventId`, 그 외는 `targetType`).
`pg_advisory_xact_lock(hashtext(chainKey))` 를 **트랜잭션의 첫 문장**으로 잡는다(IC-02).
그리고 대량 작업은 **행마다 감사 행을 쓰지 않고 집계 행 1개**를 쓴다.

**왜**: `chainKey` 가 `'global'` 단일 체인이면 finalize 트랜잭션이 락을 들고 있는 동안
**플랫폼 전체의 감사 기록 쓰기가 그 뒤에 줄을 선다**. 파트너 승인도, 로그인 감사도 다 멈춘다.
샤딩하면 finalize 는 자기 이벤트하고만 경합한다.
`SelectionEntry` 200건에 감사 행 200개를 쓰면 그 트랜잭션이 락을 200배 오래 든다 — 그래서 집계 1행이다.
락을 첫 문장으로 잡는 이유는 IC-02 의 순서 규칙이고, `xact` 인 이유는 pgbouncer 다.

**코드**:

```sql
-- 1) 첫 문장
SELECT pg_advisory_xact_lock(hashtext($chainKey));

-- 2) 체인 연결. 체인의 첫 행(prev 없음)도 삽입돼야 하므로 LEFT JOIN LATERAL 이다.
INSERT INTO "AuditLog"
  ("id","actorUserId","actorRole","actorLabel","action","targetType","targetId",
   "summary","chainKey","prevHash","rowHash")
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $chainKey,
       prev."rowHash",
       encode(sha256(convert_to(COALESCE(prev."rowHash",'') || $9, 'UTF8')), 'hex')
FROM (SELECT 1) d
LEFT JOIN LATERAL (
  SELECT a."rowHash" FROM "AuditLog" a
  WHERE a."chainKey" = $chainKey ORDER BY a.seq DESC LIMIT 1
) prev ON true;
```

---

## IC-62. 정지/해제는 `statusBeforeSuspend` 로 왕복한다

**규칙**: 정지는 현재 `status` 를 `statusBeforeSuspend` 에 보관한 뒤 `SUSPENDED` 로 바꾸고 `suspendedAt` 을 찍는다.
해제는 `statusBeforeSuspend` 를 되돌리고 두 컬럼을 NULL 로 만든다.
이미 `SUSPENDED` 인 이벤트를 다시 정지하지 않는다(그러면 원래 상태를 잃는다).

**왜**: 원래 상태를 보관하지 않으면 해제할 때 무엇으로 되돌릴지 추측해야 한다.
`OPEN` 으로 일괄 복구하면 이미 마감된 이벤트가 되살아나 신청을 다시 받고,
`CLOSED` 로 일괄 복구하면 아직 기간이 남은 이벤트가 조기 마감된다. 둘 다 되돌릴 수 없다.
`status='SUSPENDED'` 와 `suspendedAt IS NOT NULL` 의 동치는 DB CHECK 가 잡지만,
**어느 상태로 돌아가야 하는지는 코드만 안다**.

**코드**:

```sql
-- 정지
UPDATE "Event"
SET "statusBeforeSuspend" = status, status = 'SUSPENDED',
    "suspendedAt" = now(), "suspendedReason" = $2, "version" = "version" + 1
WHERE id = $1 AND status <> 'SUSPENDED';

-- 해제
UPDATE "Event"
SET status = COALESCE("statusBeforeSuspend", 'CLOSED'),
    "statusBeforeSuspend" = NULL, "suspendedAt" = NULL, "suspendedReason" = NULL,
    "version" = "version" + 1
WHERE id = $1 AND status = 'SUSPENDED';
```

---

## IC-63. `If-Match` 는 `Event.version` 이다. `policyVersion` 이 아니다

**규칙**: `PATCH /api/v1/events/:eventId` 의 낙관적 락 토큰은 `Event.version` 이고,
**모든** 가드 UPDATE(소프트 클로즈 연장 포함)가 이 값을 올린다.
`policyVersion` 은 신청자에게 약속한 정책(금액 규칙·예약금·정원)이 실제로 바뀔 때만 올린다.

**왜**: 두 개념을 한 컬럼에 섞으면 둘 다 망가진다.
문구만 고쳐도 `policyVersion` 이 올라가면 `Application.policyVersion` 스냅샷이
"내가 신청할 때의 정책"이라는 의미를 잃는다.
반대로 소프트 클로즈 연장이 락 토큰을 올리지 않으면, 연장 직후 도착한 PATCH 가
낡은 토큰으로도 통과해서 방금 연장된 `applyEndAt` 을 덮어쓴다.

**코드**:

```ts
const { count } = await tx.event.updateMany({
  where: { id, version: ifMatchVersion },
  data: {
    ...patch,
    version: { increment: 1 },
    // 정책 필드가 실제로 바뀔 때만:
    ...(policyChanged ? { policyVersion: { increment: 1 } } : {}),
  },
});
assertAffected(count, 1, 'EVENT_VERSION_MISMATCH'); // → 412 Precondition Failed
```

---

## IC-64. 진행 중 이벤트의 금액 규칙은 잠긴다

**규칙**: `status IN ('OPEN','CLOSED')` 이고 종결되지 않은 `Application` 이 하나라도 있으면
`fixedAmount / minAmount / maxAmount / amountStep` 변경 PATCH 를 거부한다.

**왜**: 이미 신청한 사람들은 그 시점의 금액 규칙 아래에서 금액을 정했다.
`amountStep` 이 바뀌면 기존 신청 금액이 새 규칙에서 무효가 되고,
`minAmount` 가 올라가면 소급해서 자격 미달인 신청이 생긴다.
그런데 그 신청들은 이미 디파짓을 냈다 — 돈이 걸린 소급 적용이다.
`amountStep >= 1` 자체는 DB CHECK 가 지킨다(0이면 `(amount - minAmount) % amountStep` 가
**모든 신청에서** 0으로 나누기가 된다).

**코드**:

```sql
SELECT 1 FROM "Application"
WHERE "eventId" = $1
  AND status NOT IN ('CANCELED','EXPIRED','NOT_SELECTED','REJECTED','EVENT_CANCELED')
LIMIT 1;
-- 1행이라도 나오면 금액 규칙 PATCH 는 409 EVENT_HAS_ACTIVE_APPLICATIONS.
```

---

## IC-65. 피처 플래그는 `Setting` 에서 짧은 캐시로 읽고, 변경은 감사한다

**규칙**: `DEPOSIT_HOLD_ENABLED`, `SETTLEMENT_ENABLED`, `EVENT_ADVANCED_VISIBILITY_ENABLED` 는
`Setting` 테이블에서 ~30초 캐시 접근자로 읽는다. 변경 시
`SETTING_CHANGED` / `FEATURE_FLAG_TOGGLED` 감사 행을 `targetType='SETTING'`, `targetId=key` 로 남긴다.
그리고 `Deposit` 생성 시 그때의 값을 `featureFlagSnapshot` 에 박아둔다.

**왜**: env 로만 두면 플래그 하나 끄는 데 재배포가 필요하고, 누가 언제 껐는지 기록이 없다.
무엇보다 `Deposit.featureFlagSnapshot` 이 "그 홀드를 만들 때 값이 뭐였는지"를 나중에 복원할 수 없게 된다 —
D-05 가 PG 연동을 유보한 상태에서 그 스냅샷은 나중에 실제 결제로 넘어갈 때 유일한 기준선이다.
캐시가 필요한 이유는 서버리스라 콜드스타트마다 읽으면 플래그 조회가 요청당 1쿼리가 되기 때문이다.

**코드**:

```ts
// 30초 TTL. 인스턴스 수명이 짧으므로 이 정도면 충분하고, 즉시성이 필요한 플래그는 없다.
const flag = await settings.getBool('DEPOSIT_HOLD_ENABLED', { ttlMs: 30_000, fallback: false });
await tx.deposit.create({ data: { /* ... */ featureFlagSnapshot: flag } });
```

---

## IC-66. 파트너 차단과 동일인 링크는 근거 행 없이 적용하지 않는다

**규칙**: `SelectionExclusionReason.BLOCKED_USER` 를 쓰려면 `PartnerBlockedUser` 에
`releasedAt IS NULL` 인 행이 있어야 한다. `DUPLICATE_ACCOUNT` 를 쓰려면 `UserIdentityLink` 행이 있어야 한다.
자동 신호(`IP_HASH_CLUSTER` 등)는 `confidence` 를 낮게 넣고 **자동 제외하지 않는다** —
`ADMIN_MANUAL`(confidence=100) 만 제외 근거가 된다.

**왜**: 제외는 신청자에게 자리와 돈을 잃게 하는 조치다. 근거가 행으로 남지 않으면
일관되게 적용할 수도, 파트너의 다른 이벤트에 재사용할 수도, 민원이 들어왔을 때 운영자가 검토할 수도 없다.
자동 판정을 자동 집행으로 이으면 안 되는 이유는 `ipHash` 클러스터가 공용 와이파이·회사 NAT 에서
정상적으로 겹치기 때문이다. **판정은 사람이 하되 근거는 행으로 남긴다.**

**코드**:

```sql
-- 제외 적용 시 근거 존재를 술어로 확인한다.
UPDATE "SelectionEntry" se
SET "isEligible" = false, "exclusionReason" = 'BLOCKED_USER', "version" = se."version" + 1
WHERE se.id = $1
  AND EXISTS (
    SELECT 1 FROM "PartnerBlockedUser" pb
    JOIN "Event" e ON e."partnerId" = pb."partnerProfileId"
    WHERE e.id = se."eventId" AND pb."userId" = se."userId" AND pb."releasedAt" IS NULL
  );
```

---

# 부록 A — CI 가 지켜야 할 것

이 문서의 규칙 중 자동으로 검증 가능한 것들. 리뷰에만 맡기지 않는다.

| 검사 | 무엇을 막는가 |
|---|---|
| `prisma migrate diff --from-schema-datasource --to-schema-datamodel --exit-code` (섀도 DB) | 나중의 `migrate dev` 가 raw SQL 로 만든 CHECK·부분 인덱스·트리거를 조용히 DROP 하는 것 |
| 공개 DTO 키 집합 계약 테스트 (IC-05) | `include` 한 줄로 금액·순위·커트라인이 새는 것 |
| `grep` — 스키마에 `@db.Timestamptz` 없는 `DateTime` 필드 | naive TIMESTAMP 재유입 |
| `grep` — 애플리케이션 코드의 `finalRank`, `cutoffAmount`, `isMandatory` | 삭제된 필드로의 회귀 |
| `grep` — `pg_advisory_lock(` (xact 아닌 세션 락) | pgbouncer transaction 모드에서 락이 새는 것 |
| `grep` — 순위 쿼리에서 `status: 'VALID'` 단독 사용 | IC-32 (INSTANT 명단이 통째로 비는 버그) |
| lint 규칙 — `updateMany` 결과의 `count` 미사용 | IC-01 |

---

# 부록 B — 초기 마이그레이션 순서

`schema.prisma` 만으로는 성립하지 않는 의존성이 있다. 순서가 틀리면 첫 마이그레이션부터 실패한다.

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;` — **초기 마이그레이션 이전**.
   `venue_search_text_trgm` 이 이제 `schema.prisma` 안에 있어서, 없으면 `CREATE INDEX ... gin_trgm_ops` 가 죽는다.
2. `CREATE EXTENSION IF NOT EXISTS btree_gist;` — `PlatformFee` 의 `EXCLUDE USING gist` 용.
3. Prisma 초기 마이그레이션.
4. raw SQL 후속: CHECK 제약, 부분 유니크, 3컬럼 복합 FK, 스냅샷 불변 트리거, 감사 append-only 트리거.
5. 시드: `Region.sigunguCode` 를 모든 행에 채운다 — IC-52 의 파생 원천이다.

> `CREATE INDEX CONCURRENTLY` 를 마이그레이션 파일에 쓰지 않는다.
> Prisma Migrate 는 각 마이그레이션을 트랜잭션 안에서 돌리고 `CONCURRENTLY` 는 거기서 즉시 실패한다.
> 초기 마이그레이션 시점의 테이블은 비어 있으므로 일반 `CREATE INDEX` 로 충분하다.

---

# 부록 C — DECISIONS.md 역참조

| 결정 | 이 문서에서 그것을 지키는 규칙 |
|---|---|
| D-02 INSTANT 단일 원자적 UPDATE | IC-15, IC-16 |
| D-03 정원 초과 허용 | IC-11(FOR SHARE 인 이유), IC-53 |
| D-04 순위 규칙 / 확정 시점 | IC-04, IC-31, IC-26 |
| D-05 디파짓은 자격 요건 | IC-21, IC-22, IC-24, IC-25 |
| D-06 상향만 / 롤백 | IC-12, IC-13, IC-14, IC-23 |
| D-07 경쟁률만 공개 | IC-05, IC-35, IC-44 |
| D-08 소프트 클로즈 | IC-17 |
| D-10 알림 채널 | IC-41 ~ IC-44 |
| D-11 서버리스 제약 | IC-02(pgbouncer), IC-03, IC-24, IC-42 |
