-- ============================================================================
-- 도메인 불변식: CHECK 제약 · 부분 유니크 · 트리거 · 복합 FK
--
-- 원래 prisma/sql/001_constraints.sql 로 따로 두고 손으로 적용했는데, 그러면
-- Prisma 가 이 객체들을 "설명되지 않는 드리프트"로 보고 스키마를 바꿀 때마다
-- `migrate dev` 가 DB 리셋을 요구한다. 배포할 때 한 단계를 잊으면 불변식이
-- 통째로 빠진 채 돌아가는 위험도 있었다.
--
-- 그래서 마이그레이션 이력에 편입했다. 이제 `migrate deploy` 한 번으로 끝난다.
--
-- ★ 여기 있는 것들은 Prisma DSL 로 표현할 수 없는 것뿐이다:
--     - CHECK 제약 (Prisma 에 문법이 없음)
--     - 조건부(부분) 유니크·인덱스 — WHERE 절
--     - BEFORE UPDATE 트리거 (스냅샷 write-once 보호)
--     - 복합 FK (비정규화 사본을 부모의 같은 행에 못박기)
--     - EXCLUDE 제약 (수수료 정책 기간 겹침 방지)
--   전부 멱등하게 작성되어 있어 재실행해도 안전하다.
-- ============================================================================

-- =============================================================================
-- Dibs — 001_constraints.sql
-- Prisma DSL 로는 표현할 수 없지만 제품 규칙상 반드시 있어야 하는 것들:
--   CHECK 제약 / 부분(partial) 인덱스 / 부분 유니크 / 복합 FK / 트리거 / EXCLUDE.
--
-- 왜 파일로 분리했나
--   schema.prisma 는 "모양"만 지킨다. 아래 제약들은 "의미"를 지킨다.
--   D-04(순위), D-05(디파짓), D-06(상향 전용), D-07(비공개)은 전부 앱 코드의 관례로만
--   지켜지고 있었고, raw 쿼리 하나·핫픽스 하나·리플레이된 웹훅 하나면 무너지는 상태였다.
--   여기 있는 것들은 관례가 아니라 구조다.
--
-- -----------------------------------------------------------------------------
-- 적용 방법
-- -----------------------------------------------------------------------------
--   1) 먼저 스키마를 올린다:
--        npx prisma migrate deploy --schema prisma/schema.prisma
--   2) 그 다음 이 파일을 **직결(DIRECT_URL)** 로 실행한다:
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/sql/001_constraints.sql
--      또는
--        npx prisma db execute --schema prisma/schema.prisma \
--          --file prisma/sql/001_constraints.sql
--      (pgbouncer 풀러 뒤에서는 DDL 이 안 된다. url 이 아니라 directUrl 이다.)
--
--   ★ 이 파일은 **migrate 를 돌릴 때마다 다시 실행해야 한다.**
--     Prisma Migrate 는 shadow DB 를 마이그레이션 재생으로 만들고 schema.prisma 와 diff 하므로,
--     여기서 만든 객체 중 schema.prisma 에 짝이 없는 것은 다음 `migrate dev` 가 DROP 을 생성한다.
--     그래서 (a) 이 파일은 전부 멱등(IF NOT EXISTS / DO 블록 / CREATE OR REPLACE)이고,
--     (b) CI 에 드리프트 가드를 반드시 건다:
--        prisma migrate diff --from-schema-datasource --to-schema-datamodel --exit-code
--
--   ★ CREATE INDEX CONCURRENTLY 는 쓰지 않는다.
--     Prisma Migrate 는 각 마이그레이션 파일을 트랜잭션 안에서 돌리는데 CONCURRENTLY 는
--     트랜잭션 블록에서 실패한다. 초기 마이그레이션 시점의 테이블은 비어 있으므로 일반 CREATE 로 즉시 끝난다.
--     운영 중 온라인으로 인덱스를 추가할 일이 생기면 그때만 별도 psql 세션에서 CONCURRENTLY 를 쓴다.
--
--   ★ 데이터가 이미 있는 DB 에 처음 적용한다면, 위반 행이 있는 CHECK 는 ADD 가 실패한다.
--     그 경우 해당 제약만 `... NOT VALID` 로 붙였다가 데이터를 고친 뒤 VALIDATE CONSTRAINT 한다.
--
-- -----------------------------------------------------------------------------
-- schema.prisma 와의 동기화 규칙
-- -----------------------------------------------------------------------------
--   * §9/§10 의 부분 인덱스·부분 유니크는 schema.prisma 의 대응 항목을 **지운 뒤** 써야 완결된다.
--     각 블록에 "schema.prisma 에서 지워야 할 줄"을 명시해 뒀다.
--     지우지 않아도 이 파일이 매번 총(total) 버전을 DROP 하므로 최종 상태는 같지만,
--     그때까지는 migrate 가 만들고 이 파일이 지우는 왕복이 반복된다.
--   * 제약 정의를 **바꿀** 때: 아래 헬퍼는 "없으면 만든다"만 한다.
--     정의를 바꾸려면 먼저 ALTER TABLE "X" DROP CONSTRAINT IF EXISTS "이름"; 을 직접 실행한다.
-- =============================================================================


-- =============================================================================
-- §0. 멱등 헬퍼
--   ALTER TABLE ... ADD CONSTRAINT 에는 IF NOT EXISTS 가 없다.
--   매번 DO 블록을 쓰면 파일이 읽히지 않으므로 헬퍼 하나로 통일한다.
-- =============================================================================

CREATE OR REPLACE FUNCTION dibs_add_constraint(p_table text, p_name text, p_def text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class     t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname  = p_name
       AND t.relname  = p_table
       AND n.nspname  = current_schema()
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_table, p_name, p_def);
  END IF;
END;
$fn$;

COMMENT ON FUNCTION dibs_add_constraint(text, text, text) IS
  '001_constraints.sql 전용 멱등 헬퍼. 같은 이름의 제약이 이미 있으면 아무 것도 하지 않는다(정의 비교는 하지 않는다).';

-- enum → text 를 **인덱스 표현식 안에서** 쓰기 위한 래퍼.
--
-- 왜 필요한가: PostgreSQL 에서 enum→text 캐스트는 IMMUTABLE 이 아니라 STABLE 이다.
-- `ALTER TYPE ... RENAME VALUE` 로 라벨이 바뀔 수 있기 때문이다. 그래서
-- `COALESCE("eventMode"::text, '')` 를 EXCLUDE 제약에 직접 쓰면
-- `42P17: functions in index expression must be marked IMMUTABLE` 로 거부당한다.
--
-- 무엇을 감수하는가: 이 함수를 IMMUTABLE 로 선언하는 것은 "EventMode 라벨을 바꾸지 않는다"는
-- 약속이다. 만약 언젠가 라벨을 바꾼다면 이 함수를 쓰는 인덱스를 REINDEX 해야 한다.
-- EventMode 는 INSTANT/BID 두 개뿐인 핵심 도메인 값이라 개명은 사실상 없고, 있더라도
-- 그 자체가 마이그레이션 작업이므로 REINDEX 를 함께 하면 된다.
CREATE OR REPLACE FUNCTION dibs_event_mode_text(p_mode "EventMode")
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$ SELECT p_mode::text $fn$;

COMMENT ON FUNCTION dibs_event_mode_text("EventMode") IS
  'enum→text 캐스트를 IMMUTABLE 로 감싼 것. EXCLUDE/부분인덱스 표현식 전용. 라벨 개명 시 REINDEX 필요.';

-- Prisma 가 만든 총(total) 유니크를 걷어내는 헬퍼.
-- @unique 는 CREATE UNIQUE INDEX 로 나오지만, 손으로 만들었거나 버전이 바뀌어 UNIQUE 제약으로
-- 존재할 수도 있다. 그 경우 DROP INDEX 는 "제약이 이 인덱스를 필요로 한다"며 거부한다 — 둘 다 처리한다.
CREATE OR REPLACE FUNCTION dibs_drop_unique(p_table text, p_name text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class     t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = p_name
       AND t.relname = p_table
       AND n.nspname = current_schema()
  ) THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, p_name);
  ELSE
    EXECUTE format('DROP INDEX IF EXISTS %I', p_name);
  END IF;
END;
$fn$;


-- =============================================================================
-- §1. 확장(EXTENSION)
--
--   ★★ pg_trgm 은 이 파일보다 **먼저** 있어야 한다.
--      venue_search_text_trgm 이 schema.prisma 안으로 들어왔기 때문에
--      `CREATE INDEX ... USING GIN ("searchText" gin_trgm_ops)` 가 **초기 마이그레이션에서** 실행된다.
--      확장이 없으면 마이그레이션 자체가 거기서 죽는다.
--      → 초기 마이그레이션 SQL 의 첫 줄에 CREATE EXTENSION 을 직접 넣거나,
--        migrate deploy 전에 이 §1 만 따로 실행할 것.
--      아래는 "이미 있으면 통과"용 안전망이다.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- Venue.searchText 부분일치 검색(GIN + gin_trgm_ops)
CREATE EXTENSION IF NOT EXISTS btree_gist; -- §8 PlatformFee EXCLUDE 의 스칼라 = 연산자
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- 랭킹 스냅샷 해시 digest(...,'sha256') — SQL 안에서 계산해야 한다


-- =============================================================================
-- §2. Event — 상태 / 모드 / 기간 / 금액 정합성
-- =============================================================================

-- 운영자 정지가 "장식"이 되지 않게 한다.
-- status 를 안 바꾸면 INSTANT 정원 UPDATE, BID 신청 가드, 소프트 클로즈 연장,
-- 노출 목록, 라이프사이클 크론이 전부 "살아있는 이벤트"로 계속 취급한다.
-- 두 컬럼이 따로 놀면 상태 하나로 모든 가드를 닫겠다는 설계가 무너지므로 동치로 묶는다.
SELECT dibs_add_constraint('Event', 'event_suspended_state_chk',
  $def$CHECK ( ("status" = 'SUSPENDED') = ("suspendedAt" IS NOT NULL) )$def$);

-- 정지 해제 시 되돌릴 상태가 없으면 해제 자체가 불가능해진다. 그리고 SUSPENDED 로는 되돌릴 수 없다.
SELECT dibs_add_constraint('Event', 'event_status_before_suspend_chk',
  $def$CHECK (
        ("status" <> 'SUSPENDED' OR "statusBeforeSuspend" IS NOT NULL)
    AND ("statusBeforeSuspend" IS NULL OR "statusBeforeSuspend" <> 'SUSPENDED')
  )$def$);

-- 소프트 클로즈 설정 완결성 (D-08).
-- 연장문은 applyEndAt = LEAST(applyEndAt + extend, softCloseHardEndAt) 인데
-- LEAST 는 NULL 을 전파한다. hardEnd 가 NULL 이면
--   (1) applyEndAt NOT NULL 위반으로 "죄 없는 입찰자"의 트랜잭션이 죽고,
--   (2) rankingLockAt 재계산도 NULL 이 되어 event_ranking_lock_idx 에서 조용히 빠지고
--       그 이벤트는 영원히 확정되지 않는다.
SELECT dibs_add_constraint('Event', 'event_softclose_config_chk',
  $def$CHECK (
    "softCloseEnabled" = false OR (
          "softCloseWindowMinutes" IS NOT NULL AND "softCloseWindowMinutes" > 0
      AND "softCloseExtendMinutes" IS NOT NULL AND "softCloseExtendMinutes" > 0
      AND "softCloseHardEndAt"     IS NOT NULL AND "softCloseHardEndAt" >= "applyEndAt"
    )
  )$def$);

-- 소프트 클로즈는 BID 전용(D-08 은 금액 경쟁이 있는 모드의 스나이핑 대책이다).
SELECT dibs_add_constraint('Event', 'event_softclose_mode_chk',
  $def$CHECK ("softCloseEnabled" = false OR "mode" = 'BID')$def$);

SELECT dibs_add_constraint('Event', 'event_softclose_counters_chk',
  $def$CHECK (
        "softCloseMaxExtensions"        >= 0
    AND "softCloseMaxExtensionsPerUser" >= 0
    AND "softCloseExtensionCount"       >= 0
  )$def$);

-- 순위 확정 시각은 마감 이후여야 한다 (D-04: 마감 1분 전 신청자도 디파짓 윈도우를 온전히 쓴다).
SELECT dibs_add_constraint('Event', 'event_ranking_lock_after_end_chk',
  $def$CHECK ("rankingLockAt" IS NULL OR "rankingLockAt" > "applyEndAt")$def$);

-- Selection.rankingBasisAt 는 NOT NULL 이고 이 값을 그대로 복사한다.
-- 여기가 NULL 인 채로 라운드 오픈 크론에 들어가면 배치 전체가 null constraint 로 죽는다.
-- INSTANT 도 포함한다 — SelectionEntrySource.INSTANT_CLAIM 이 있다는 건 INSTANT 도 라운드를 연다는 뜻이다.
SELECT dibs_add_constraint('Event', 'event_ranking_lock_required_chk',
  $def$CHECK ("status" NOT IN ('OPEN','CLOSED','FINALIZED') OR "rankingLockAt" IS NOT NULL)$def$);

-- 기간 정합성. originalApplyEndAt 은 "연장 전 원래 마감"이므로 언제나 현재 마감보다 앞이다.
SELECT dibs_add_constraint('Event', 'event_period_chk',
  $def$CHECK (
        "applyEndAt" > "applyStartAt"
    AND ("originalApplyEndAt" IS NULL OR "originalApplyEndAt" <= "applyEndAt")
    AND ("serviceStartAt" IS NULL OR "serviceEndAt" IS NULL OR "serviceEndAt" >= "serviceStartAt")
  )$def$);

-- serviceDateKst 는 Char(10) 이라 길이만 맞으면 아무 문자열이나 들어간다.
-- event_service_date_idx 로 날짜 필터를 하는데 형식이 섞이면 그 인덱스가 의미를 잃는다.
SELECT dibs_add_constraint('Event', 'event_service_date_format_chk',
  $def$CHECK ("serviceDateKst" IS NULL OR "serviceDateKst" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')$def$);

-- amountStep = 0 이면 신청 검증식 (amount - minAmount) % amountStep 이 매 신청마다 0 나누기다.
SELECT dibs_add_constraint('Event', 'event_amount_step_chk',
  $def$CHECK ("amountStep" >= 1)$def$);

-- 모드별 금액 규칙 (D-02).
--   INSTANT = 고정 금액만. BID = min~max (min==max 로 고정가도 가능).
-- 배타성까지 거는 이유: 두 벌이 다 채워져 있으면 "신청 시 어느 컬럼을 읽는가"가 코드마다 갈린다.
SELECT dibs_add_constraint('Event', 'event_mode_amount_chk',
  $def$CHECK (
    CASE "mode"
      WHEN 'INSTANT' THEN "fixedAmount" IS NOT NULL AND "fixedAmount" >= 0
                          AND "minAmount" IS NULL AND "maxAmount" IS NULL
      WHEN 'BID'     THEN "minAmount" IS NOT NULL AND "maxAmount" IS NOT NULL
                          AND "minAmount" >= 0 AND "maxAmount" >= "minAmount"
                          AND "fixedAmount" IS NULL
    END
  )$def$);

SELECT dibs_add_constraint('Event', 'event_capacity_chk',
  $def$CHECK ("capacity" >= 1 AND "claimedCount" >= 0 AND "ratioMinApplicantsToShow" >= 0)$def$);

-- 예약금 정책 완결성 (D-05: 필수 여부 / 정액 or 정률 / 윈도우 분).
-- 필수인데 타입이 NULL 이면 Deposit 산정 스냅샷을 만들 수 없고, 정률인데 bp 가 NULL 이면 금액이 NULL 이 된다.
SELECT dibs_add_constraint('Event', 'event_deposit_policy_chk',
  $def$CHECK (
    "depositRequired" = false OR (
          "depositType" IS NOT NULL
      AND "depositWindowMinutes" >= 1
      AND "depositRoundingUnit"  >= 1
      -- 0 을 허용하지 않는 이유: 요구액이 0 이면 Deposit 행을 만들 게 아니라
      -- depositStatus='NOT_REQUIRED' 로 가야 한다. 0원짜리 홀드는 §4 의 amountDue > 0 과 정면충돌한다.
      AND ("depositType" <> 'FIXED'   OR ("depositFixedAmount" IS NOT NULL AND "depositFixedAmount" > 0))
      AND ("depositType" <> 'PERCENT' OR ("depositPercentBp"   IS NOT NULL AND "depositPercentBp" BETWEEN 1 AND 10000))
      AND ("depositMinAmount" IS NULL OR "depositMaxAmount" IS NULL OR "depositMaxAmount" >= "depositMinAmount")
    )
  )$def$);


-- =============================================================================
-- §3. Application — 상태 x 예약금 불변식
--
--   구체적인 사고 경로: 홀드가 만료돼 스위퍼가 자리를 반환 → 새 신청자가 그 자리를 잡음
--   → 뒤늦은 deposit-confirm(혹은 재생된 PG 웹훅)이 만료된 신청을 CONFIRMED 로 되돌림.
--   정원+1 명이 확정되고 claimedCount 는 그걸 모른다. 파트너 대사 화면이 거짓말을 한다.
--
--   ★ Application.depositStatus 의 합법 값은 5개뿐이다.
--     환불/소멸(REFUNDED / VOIDED / FORFEITED ...)은 **Deposit 행의 생명주기**이지 신청의 상태가 아니다.
--     신청 쪽은 "얼마를 냈고 얼마를 돌려받았나"를 depositPaidAmount / depositRefundedAmount 로 들고 있으면 된다.
--     (원 리뷰의 EXPIRED 불변식은 REFUNDED/VOIDED 를 허용했는데, 같은 리뷰가 정의한 5값 도메인과
--      서로 모순이라 여기서는 좁은 쪽 — 도메인 5값 — 으로 통일했다.)
-- =============================================================================

SELECT dibs_add_constraint('Application', 'app_deposit_state_domain_chk',
  $def$CHECK ("depositStatus" IN ('NOT_REQUIRED','PENDING','PAID','SHORTFALL_PENDING','EXPIRED'))$def$);

-- 만료된 신청은 예약금도 만료 상태여야 한다. 이게 없으면 (status=EXPIRED, depositStatus=PAID) 가 표현 가능하고,
-- 그 조합이 바로 위의 "되살아난 신청"이다.
SELECT dibs_add_constraint('Application', 'app_expired_deposit_chk',
  $def$CHECK ("status" <> 'EXPIRED' OR "depositStatus" = 'EXPIRED')$def$);

-- 유효/확정 상태는 "디파짓 게이트를 통과했다"는 뜻이다 (D-05).
-- SHORTFALL_PENDING 이 허용되는 이유: 상향 차액 미납은 롤백 대상이지 무효 대상이 아니다(D-06).
SELECT dibs_add_constraint('Application', 'app_valid_requires_deposit_chk',
  $def$CHECK (
    "status" NOT IN ('VALID','CONFIRMED')
    OR "depositStatus" IN ('NOT_REQUIRED','PAID','SHORTFALL_PENDING')
  )$def$);

SELECT dibs_add_constraint('Application', 'app_pending_deposit_chk',
  $def$CHECK ("status" <> 'PENDING_DEPOSIT' OR "depositStatus" = 'PENDING')$def$);

-- 열린 홀드에는 만기가 반드시 있어야 한다 — 스위퍼(application_deposit_due_idx)가 이 컬럼만 보고 돈다.
SELECT dibs_add_constraint('Application', 'app_deposit_due_required_chk',
  $def$CHECK ("depositStatus" NOT IN ('PENDING','SHORTFALL_PENDING') OR "depositDueAt" IS NOT NULL)$def$);

SELECT dibs_add_constraint('Application', 'app_deposit_amounts_chk',
  $def$CHECK (
        "depositRequiredAmount" >= 0
    AND "depositPaidAmount"     >= 0
    AND "depositRefundedAmount" >= 0
    AND "depositRefundedAmount" <= "depositPaidAmount"
    AND ("depositStatus" <> 'NOT_REQUIRED' OR "depositRequiredAmount" = 0)
  )$def$);

-- ★ INSTANT settledAmount=0 버그를 잡는다.
--   플로우 (a)는 INSERT 시 settledAmount=0 을 넣고, 예약금 불필요 분기에서 CONFIRMED 로만 바꾼 뒤
--   settledAmount 를 고치지 않았다. 그러면 "예약금이 완납된 최고 금액"이 0 인 확정 신청이 남는다.
--   ※ CHECK 는 Postgres 에서 DEFERRABLE 이 불가능하다. 즉 이 제약은 INSERT 문 시점에 즉시 검사된다.
--     따라서 예약금 불필요 신청은 **INSERT 에서부터** settledAmount = amount 로 넣어야 한다.
--     (뒤에서 UPDATE 로 고치는 2단계 흐름은 여기서 막힌다 — 그게 의도다.)
SELECT dibs_add_constraint('Application', 'app_settled_amount_chk',
  $def$CHECK (
        "amount" >= 0
    AND "settledAmount" >= 0
    AND "settledAmount" <= "amount"
    AND "highestAmountEver" >= "amount"
    AND "highestAmountEver" >= "settledAmount"
    AND ("depositStatus" <> 'NOT_REQUIRED' OR "settledAmount" = "amount")
  )$def$);

-- 타이브레이크 시계의 순서 (D-04).
-- settledLastBidAt 은 "현재 settledAmount 에 도달했던 시각"이므로 lastBidAt 보다 미래일 수 없다.
-- 롤백하면 둘이 같아진다.
SELECT dibs_add_constraint('Application', 'app_bid_clock_order_chk',
  $def$CHECK ("firstAppliedAt" <= "lastBidAt" AND "settledLastBidAt" <= "lastBidAt")$def$);

-- 자리(slot)는 INSTANT 에만 있다. BID 신청이 slotClaimed=true 를 들고 있으면
-- 스위퍼의 "자리 반환" 분기가 존재하지 않는 자리를 반환하며 claimedCount 를 망가뜨린다.
SELECT dibs_add_constraint('Application', 'app_slot_mode_chk',
  $def$CHECK ("eventMode" = 'INSTANT' OR "slotClaimed" = false)$def$);

SELECT dibs_add_constraint('Application', 'app_counters_chk',
  $def$CHECK ("rebidCount" >= 0 AND "reapplyCount" >= 0 AND "version" >= 0 AND "policyVersion" >= 1)$def$);


-- =============================================================================
-- §4. Deposit — 열린 홀드는 하나뿐, 금액 정합성
--
--   Deposit.status 는 "열린 홀드"를 언제나 PENDING 으로만 표현한다.
--   SHORTFALL_PENDING 을 여기에 쓰면 one_open_deposit 부분 유니크에도, deposit_sweep_idx 술어에도
--   동시에 안 걸린다 → 홀드가 영원히 만료되지 않고 "올려놓고 안 내기"가 영구 이득이 된다(D-06 무력화).
--   상향 부족분인지 여부는 reason(RAISE_SHORTFALL)이 구분한다.
--   NOT_REQUIRED 는 애초에 Deposit 행이 없다는 뜻이므로 이 컬럼에 올 수 없다.
-- =============================================================================

SELECT dibs_add_constraint('Deposit', 'deposit_status_domain_chk',
  $def$CHECK ("status" NOT IN ('NOT_REQUIRED','SHORTFALL_PENDING'))$def$);

SELECT dibs_add_constraint('Deposit', 'deposit_window_chk',
  $def$CHECK ("windowMinutes" >= 1 AND "dueAt" > "openedAt")$def$);

SELECT dibs_add_constraint('Deposit', 'deposit_amounts_chk',
  $def$CHECK (
        "basisAmount"    >= 0
    AND "requiredAmount" >= 0
    AND "amountDue"      >  0
    AND "amountPaid"     >= 0
    AND "amountPaid"     <= "amountDue"
    AND "refundAmount"   >= 0
    AND "forfeitedAmount" >= 0
    AND "refundAmount" + "forfeitedAmount" <= "amountPaid"
  )$def$);

-- 산정 스냅샷 완결성: 나중에 "그때 얼마를 왜 요구했나"를 재구성할 수 없으면 분쟁에서 쓸 수 없다.
SELECT dibs_add_constraint('Deposit', 'deposit_type_snapshot_chk',
  $def$CHECK (
        ("depositType" <> 'FIXED'   OR "depositFixedAmount" IS NOT NULL)
    AND ("depositType" <> 'PERCENT' OR "depositPercentBp"   IS NOT NULL)
  )$def$);

-- PAID 는 완납이다. 부분 납부는 PENDING 으로 남아 스위퍼 대상이어야 한다.
SELECT dibs_add_constraint('Deposit', 'deposit_paid_chk',
  $def$CHECK ("status" <> 'PAID' OR ("paidAt" IS NOT NULL AND "amountPaid" = "amountDue"))$def$);


-- =============================================================================
-- §5. BidHistory — 상향 전용(D-06)을 방향으로 못 박는다
--
--   서비스 레이어의 검사 하나가 회귀하면 "같은 금액 재입찰"(= 순수한 타이브레이크 시계 세탁)이
--   정상적인 RAISE 로 기록된다. 기록이 거짓이면 롤백도 감사도 복원할 근거가 없다.
--   BidHistory 는 append-only 라 나중에 고칠 수도 없다 — 들어오는 순간 막아야 한다.
-- =============================================================================

SELECT dibs_add_constraint('BidHistory', 'bid_history_delta_direction_chk',
  $def$CHECK (
        ("source" <> 'RAISE'    OR "deltaAmount" >  0)
    AND ("source" <> 'ROLLBACK' OR "deltaAmount" <  0)
    AND ("source" <> 'REAPPLY'  OR "deltaAmount" >= 0)
    AND ("source" <> 'CANCEL'   OR "deltaAmount" =  0)
  )$def$);

-- 산술 정합성. 이게 없으면 previousAmount/newAmount/deltaAmount 세 컬럼이 서로 모순인 행이 남고,
-- 롤백 목표 금액을 이력에서 재구성할 수 없다.
SELECT dibs_add_constraint('BidHistory', 'bid_history_arithmetic_chk',
  $def$CHECK ("newAmount" = COALESCE("previousAmount", 0) + "deltaAmount" AND "newAmount" >= 0)$def$);

-- 최초 신청에는 이전 금액이 없고, 그 외 모든 소스에는 반드시 있다.
SELECT dibs_add_constraint('BidHistory', 'bid_history_previous_amount_chk',
  $def$CHECK (
    CASE WHEN "source" = 'INITIAL_APPLY'
         THEN "previousAmount" IS NULL
         ELSE "previousAmount" IS NOT NULL
    END
  )$def$);

-- 롤백은 금액과 시각을 "쌍으로" 되돌린다(D-06). 시각이 없으면 D-04 순위가 복원되지 않는다.
SELECT dibs_add_constraint('BidHistory', 'bid_history_rollback_clock_chk',
  $def$CHECK ("source" <> 'ROLLBACK' OR "restoredLastBidAt" IS NOT NULL)$def$);

-- 소프트 클로즈를 유발했다고 기록했으면 연장 전/후 시각이 있어야 하고, 실제로 뒤로 밀려야 한다(D-08).
-- 1인당 연장 상한(Event.softCloseMaxExtensionsPerUser)을 이 컬럼 개수로 세기 때문에 거짓 기록이 곧 상한 우회다.
SELECT dibs_add_constraint('BidHistory', 'bid_history_softclose_chk',
  $def$CHECK (
    "triggeredSoftClose" = false OR (
          "deadlineBefore" IS NOT NULL
      AND "deadlineAfter"  IS NOT NULL
      AND "deadlineAfter"  >  "deadlineBefore"
    )
  )$def$);

SELECT dibs_add_constraint('BidHistory', 'bid_history_seq_chk',
  $def$CHECK ("seq" >= 1 AND "depositRequiredAfter" >= 0)$def$);


-- =============================================================================
-- §6. Selection / SelectionEntry
-- =============================================================================

-- rankingBasisAt = effectiveDeadlineAt + depositWindowMinutes (+ grace) 이므로 앞설 수 없다(D-04).
SELECT dibs_add_constraint('Selection', 'selection_basis_after_deadline_chk',
  $def$CHECK ("rankingBasisAt" >= "effectiveDeadlineAt" AND "depositWindowMinutes" >= 0)$def$);

SELECT dibs_add_constraint('Selection', 'selection_counts_chk',
  $def$CHECK ("roundNo" >= 1 AND "capacitySnapshot" >= 0 AND "remainingSeats" >= 0)$def$);

SELECT dibs_add_constraint('SelectionEntry', 'selection_entry_rank_chk',
  $def$CHECK (
        ("rankNo" IS NULL OR "rankNo" >= 1)
    AND ("tieOrdinal" IS NULL OR "tieOrdinal" >= 1)
    AND ("amountSnapshot" >= 0)
    AND ("depositPaidSnapshot" >= 0)
  )$def$);

-- 제외된 항목에는 사유가, 적격 항목에는 사유가 없어야 한다.
-- 사유 없는 제외는 민원이 들어왔을 때 운영자가 설명할 수 없는 상태다.
SELECT dibs_add_constraint('SelectionEntry', 'selection_entry_exclusion_chk',
  $def$CHECK (("isEligible" = true) = ("exclusionReason" IS NULL))$def$);

-- 정원 안에 든 항목은 당연히 적격이어야 한다.
SELECT dibs_add_constraint('SelectionEntry', 'selection_entry_capacity_chk',
  $def$CHECK ("withinCapacity" = false OR "isEligible" = true)$def$);


-- =============================================================================
-- §7. User — 익명화 / 중복 계정
-- =============================================================================

-- googleSub/email 을 nullable 로 바꾼 건 익명화가 그 둘을 지울 수 있게 하기 위해서다.
-- 그 대가로 "살아있는 계정인데 신원이 비어 있는" 행이 표현 가능해졌으므로 여기서 막는다.
-- (AuthModule 은 googleSub IS NULL 을 "계정 없음"으로 취급해야 한다 — 그래야 재가입이 탈퇴 행을 되살리지 않는다.)
SELECT dibs_add_constraint('User', 'user_identity_present_chk',
  $def$CHECK ("anonymizedAt" IS NOT NULL OR ("googleSub" IS NOT NULL AND "email" IS NOT NULL))$def$);

SELECT dibs_add_constraint('User', 'user_counters_chk',
  $def$CHECK ("loginCount" >= 0 AND "tokenVersion" >= 0)$def$);

-- ★ 1인 1신청(D-03 의 전제)은 지금 (eventId, userId) 유니크 하나로만 지켜진다.
--   구글 계정은 무제한 생성이 가능하므로, 계정 3개면 INSTANT 자리 3개 + BID 순위 3개를 먹고
--   남에게 보이는 경쟁률(D-07 이 공개하는 유일한 숫자)까지 부풀릴 수 있다.
--   "인증된 전화번호 1개 = 사람 1명"이 현실적으로 가능한 유일한 병목이다.
--   부분 유니크인 이유: 미인증/탈퇴/익명화 행까지 번호를 영구 점유하면 안 된다.
--   ※ 신청 시 phoneVerifiedAt IS NOT NULL 강제는 교차 테이블이라 apply 트랜잭션(앱 로직)에 있다.
CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_uq"
  ON "User" ("phone")
  WHERE "phoneVerifiedAt" IS NOT NULL
    AND "deletedAt"       IS NULL
    AND "anonymizedAt"    IS NULL;


-- =============================================================================
-- §8. Settlement / PlatformFee
-- =============================================================================

-- periodKstMonth 는 정확히 'YYYY-MM' 이다. VarChar(7) 은 길이만 볼 뿐이라
-- '2026-7 ' 같은 값이 들어가면 uq_settlement_event_period 가 같은 달을 두 행으로 본다.
SELECT dibs_add_constraint('Settlement', 'settlement_period_format_chk',
  $def$CHECK ("periodKstMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')$def$);

SELECT dibs_add_constraint('Settlement', 'settlement_amounts_chk',
  $def$CHECK (
        "confirmedCount" >= 0 AND "grossAmountKrw" >= 0
    AND "depositCollectedKrw" >= 0 AND "depositRefundedKrw" >= 0
    AND "platformFeeKrw" >= 0 AND "vatKrw" >= 0
    AND "depositRefundedKrw" <= "depositCollectedKrw"
  )$def$);

SELECT dibs_add_constraint('PlatformFee', 'platform_fee_shape_chk',
  $def$CHECK (
        ("feeType" <> 'PERCENT' OR "percentBps" IS NOT NULL)
    AND ("feeType" <> 'FIXED'   OR "fixedAmountKrw" IS NOT NULL)
    AND ("feeType" <> 'HYBRID'  OR ("percentBps" IS NOT NULL AND "fixedAmountKrw" IS NOT NULL))
    AND ("percentBps" IS NULL OR "percentBps" BETWEEN 0 AND 10000)
    AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
    AND ("minFeeKrw" IS NULL OR "maxFeeKrw" IS NULL OR "maxFeeKrw" >= "minFeeKrw")
  )$def$);

-- 같은 (scope, 대상, 모드)에 유효기간이 겹치는 수수료 정책이 둘이면 "그때 적용된 요율"이
-- 조회 순서에 따라 달라진다 — 정산은 그걸 나중에 재현할 수 없다.
-- btree_gist 가 있어야 스칼라 = 연산자를 gist 인덱스에 넣을 수 있다(§1).
-- 모든 DateTime 이 timestamptz 로 통일된 뒤에야 tstzrange 가 합법이 된다.
SELECT dibs_add_constraint('PlatformFee', 'platform_fee_no_overlap',
  $def$EXCLUDE USING gist (
        "scope" WITH =,
        COALESCE("scopeRefId", '') WITH =,
        COALESCE(dibs_event_mode_text("eventMode"), '') WITH =,
        tstzrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamptz), '[)') WITH &&
      ) WHERE ("deletedAt" IS NULL AND "isActive")$def$);


-- =============================================================================
-- §9. 부분 인덱스 / 부분 유니크 — Prisma DSL 로 표현 불가
-- =============================================================================

-- (9-1) 신청 1건당 열린 홀드는 최대 1개.
--   이게 없으면 상향 부족분 홀드와 최초 홀드가 동시에 열려 있을 수 있고,
--   어느 쪽이 만료돼야 하는지 스위퍼가 판단할 수 없다.
CREATE UNIQUE INDEX IF NOT EXISTS "one_open_deposit"
  ON "Deposit" ("applicationId")
  WHERE "status" = 'PENDING';

-- (9-2) 디파짓 리마인더 크론(매분)의 클레임 인덱스.
--   크론 쿼리: WHERE status='PENDING' AND "reminderSentAt" IS NULL AND "dueAt" <= now() + interval '3 minutes'
--   → 이 부분 인덱스는 "아직 안 보낸 열린 홀드"만 담으므로 평시 크기가 거의 0 이다.
--   ※ schema.prisma 의 @@index([status, reminderSentAt, dueAt], map: "deposit_reminder_idx") 는
--     이걸 못 쓰는 동안의 근사치였다. 이 인덱스가 자리 잡으면 그 줄을 schema.prisma 에서 지워라
--     (지우기 전에는 두 인덱스가 같은 쓰기를 이중으로 유지한다).
CREATE INDEX IF NOT EXISTS "deposit_reminder_due"
  ON "Deposit" ("dueAt")
  WHERE "status" = 'PENDING' AND "reminderSentAt" IS NULL;

-- (9-3) ★ 랭킹 부분 인덱스.
--   BID 는 VALID 에서, INSTANT 는 CONFIRMED 에서 끝난다. 그래서 라운드 오픈 쿼리의 올바른 술어는
--   status = 'VALID' 가 아니라 status IN ('VALID','CONFIRMED') 다.
--   (status='VALID' 로 거르면 INSTANT 이벤트의 파트너 최종명단 화면이 통째로 빈다.)
--   정렬 키는 D-04 그대로: 금액 DESC → 그 금액 도달 시각 ASC → applySeq ASC(3순위, 결정적).
--   부분 인덱스 하나로 두 모드를 다 덮는다. 모드별로 둘로 쪼개면 가장 뜨거운 쓰기 경로에
--   인덱스가 하나 더 얹히는데, 얻는 건 없다.
CREATE INDEX IF NOT EXISTS "app_rank_active"
  ON "Application" ("eventId", "amount" DESC, "lastBidAt" ASC, "applySeq" ASC)
  WHERE "status" IN ('VALID', 'CONFIRMED');

--   ※ schema.prisma 의 application_rank_idx 는 같은 컬럼의 **총(total)** 버전이다.
--     둘 다 살아 있으면 매 신청/상향/롤백/디파짓확정이 인덱스 두 개를 유지하는데
--     플래너는 거의 항상 작은 쪽(app_rank_active)을 고르므로 총 버전은 순수 쓰기 비용이다.
--     정리 순서: schema.prisma 에서 아래 줄을 지우고 → migrate → 이 파일 재실행.
--        @@index([eventId, amount(sort: Desc), lastBidAt(sort: Asc), applySeq], map: "application_rank_idx")
--     그때까지는 아래 DROP 을 켜지 말 것(다음 migrate 가 다시 만든다).
-- DROP INDEX IF EXISTS "application_rank_idx";

-- (9-4) 사업자등록번호 부분 유니크.
--   반려된 신청과 삭제된 사업자가 번호를 영구 점유하면, 정당한 사업자가 자기 번호로 다시 등록할 수 없다.
CREATE UNIQUE INDEX IF NOT EXISTS "business_brn_uq"
  ON "Business" ("businessRegistrationNumber")
  WHERE "deletedAt" IS NULL AND "verificationStatus" <> 'REJECTED';


-- =============================================================================
-- §10. 소프트 삭제 유니크 전환  ★ schema.prisma 동반 수정 필요
--
--   12개 모델이 deletedAt 으로 소프트 삭제하는데, 유니크는 전부 총(total) 유니크다.
--   결과: 파트너가 '강남점'을 지우면 같은 사업자 아래 다시는 그 이름을 못 쓴다.
--         이미지 3번을 지우면 sortOrder=3 이 영구히 점유돼 순서 재배치 엔드포인트가 충돌한다.
--
--   아래는 (1) Prisma 가 만든 총 유니크 인덱스를 지우고 (2) 같은 뜻의 부분 유니크를 새 이름으로 만든다.
--   ★ schema.prisma 에서 지워야 할 줄 (지우지 않으면 migrate 가 총 버전을 계속 되살린다):
--        Venue.slug              @unique
--        Venue      @@unique([businessId, name],   map: "venue_business_name_uq")
--        VenueImage.blobPathname @unique
--        VenueImage @@unique([venueId, sortOrder], map: "venue_image_order_uq")
--        Category.code           @unique
--        Event.slug              @unique
--        EventImage.pathname     @unique
--        EventImage @@unique([eventId, sortOrder], map: "event_image_order_uq")
--      (Region.code 의 @unique 는 **건드리지 않는다** — Venue.regionCode / Region.parentCode 의 FK 대상이라
--       총 유니크로 남아 있어야 한다. Region 에는 deletedAt 도 없다.)
--
--   ★ DEFERRABLE 에 관하여
--     이미지 순서 재배치를 한 트랜잭션에서 하려면 유니크가 DEFERRABLE INITIALLY DEFERRED 여야 하는데,
--     Postgres 에서 **부분 유니크는 제약(constraint)이 될 수 없고, 인덱스는 DEFERRABLE 이 될 수 없다.**
--     둘 다 가질 수 없으므로 소프트 삭제 대응(부분)을 택했다.
--     대신 재배치는 2단계 쓰기로 한다: 먼저 대상 행들을 sortOrder = -(sortOrder+1) 로 밀어 음수 영역에
--     대피시키고, 그 다음 최종 값으로 쓴다. 같은 트랜잭션 안에서 충돌 없이 끝난다.
--     (총 유니크 + DEFERRABLE 을 택하고 싶다면 위 CREATE 대신
--      ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...) DEFERRABLE INITIALLY DEFERRED 로 바꾸면 되지만,
--      그 순간 소프트 삭제된 행이 다시 자리를 영구 점유한다.)
-- =============================================================================

SELECT dibs_drop_unique('Venue', 'Venue_slug_key');
CREATE UNIQUE INDEX IF NOT EXISTS "venue_slug_uq"
  ON "Venue" ("slug") WHERE "deletedAt" IS NULL;

SELECT dibs_drop_unique('Venue', 'venue_business_name_uq');
CREATE UNIQUE INDEX IF NOT EXISTS "venue_business_name_live_uq"
  ON "Venue" ("businessId", "name") WHERE "deletedAt" IS NULL;
-- venue_business_idx(businessId) 를 schema.prisma 에 남겨둔 이유가 정확히 여기다:
-- 위 유니크가 부분이 되는 순간 businessId FK 를 덮어주던 총 인덱스가 사라진다.

SELECT dibs_drop_unique('VenueImage', 'VenueImage_blobPathname_key');
CREATE UNIQUE INDEX IF NOT EXISTS "venue_image_pathname_uq"
  ON "VenueImage" ("blobPathname") WHERE "deletedAt" IS NULL;

SELECT dibs_drop_unique('VenueImage', 'venue_image_order_uq');
CREATE UNIQUE INDEX IF NOT EXISTS "venue_image_order_live_uq"
  ON "VenueImage" ("venueId", "sortOrder") WHERE "deletedAt" IS NULL;

SELECT dibs_drop_unique('Category', 'Category_code_key');
CREATE UNIQUE INDEX IF NOT EXISTS "category_code_uq"
  ON "Category" ("code") WHERE "deletedAt" IS NULL;

SELECT dibs_drop_unique('Event', 'Event_slug_key');
CREATE UNIQUE INDEX IF NOT EXISTS "event_slug_uq"
  ON "Event" ("slug") WHERE "deletedAt" IS NULL;

SELECT dibs_drop_unique('EventImage', 'EventImage_pathname_key');
CREATE UNIQUE INDEX IF NOT EXISTS "event_image_pathname_uq"
  ON "EventImage" ("pathname") WHERE "deletedAt" IS NULL;

SELECT dibs_drop_unique('EventImage', 'event_image_order_uq');
CREATE UNIQUE INDEX IF NOT EXISTS "event_image_order_live_uq"
  ON "EventImage" ("eventId", "sortOrder") WHERE "deletedAt" IS NULL;


-- =============================================================================
-- §11. 복합 FK — 비정규화 사본을 부모의 "같은 행"에 못 박는다
--
--   Deposit / BidHistory / SelectionEntry 의 (eventId, userId) 는 Application 의 값 사본이다.
--   단일 컬럼 FK 는 이미 schema.prisma 에 있지만, 그건 "존재하는 이벤트/유저"만 보장할 뿐
--   "그 신청과 같은 이벤트/유저"는 보장하지 않는다.
--   환불 큐(deposit_event_status_idx)와 선정 조회(selection_entry_user_event_idx)가 조인 없이
--   이 사본만 읽기 때문에, 한 번 어긋나면 엉뚱한 이벤트에 환불이 나가고 DB 는 끝까지 모른다.
--   대상 유니크는 schema.prisma 의 application_identity_uq (id, eventId, userId).
-- =============================================================================



-- 복합 FK 3개는 schema.prisma 의 @relation(fields: [applicationId, eventId, userId], …)
-- 가 만든다. 이름도 아래 예전 이름(deposit_app_identity_fk 등)을 map 으로 그대로 쓴다.
-- 같은 제약을 SQL 과 Prisma 가 각각 만들면 `migrate dev` 가 매번 드리프트를 보고한다.

-- 자식 쪽 커버 인덱스는 이미 있다: deposit_app_seq_uq / bid_history_app_seq_uq / selection_entry_app_idx
-- (셋 다 applicationId 로 시작하므로 부모 삭제 시 seq scan 이 나지 않는다.)


-- =============================================================================
-- §12. 트리거
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (12-1) SelectionEntry 동결 스냅샷 write-once
--
--   "리포지토리 타입으로 봉인한다"는 raw 쿼리 한 줄, 데이터 마이그레이션 하나, 핫픽스 하나를 못 버틴다.
--   이 스냅샷이 바뀌면 플랫폼은 "선정이 무엇에 근거했는지" 증명할 수단을 잃는다 —
--   분쟁이 났을 때 파트너도 운영자도 아무 말도 할 수 없게 된다.
--   가변 심사 상태(status/source/position/override*/selectedAt/...)는 그대로 수정 가능하다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dibs_selection_entry_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF ( NEW."selectionId", NEW."eventId", NEW."applicationId", NEW."userId",
       NEW."displayNameSnapshot", NEW."amountSnapshot", NEW."lastBidAtSnapshot",
       NEW."appliedAtSnapshot", NEW."rebidCountSnapshot", NEW."depositStatusSnapshot",
       NEW."depositPaidSnapshot", NEW."depositConfirmedAtSnapshot",
       NEW."rankNo", NEW."withinCapacity", NEW."tieGroupKey", NEW."tieOrdinal" )
     IS DISTINCT FROM
     ( OLD."selectionId", OLD."eventId", OLD."applicationId", OLD."userId",
       OLD."displayNameSnapshot", OLD."amountSnapshot", OLD."lastBidAtSnapshot",
       OLD."appliedAtSnapshot", OLD."rebidCountSnapshot", OLD."depositStatusSnapshot",
       OLD."depositPaidSnapshot", OLD."depositConfirmedAtSnapshot",
       OLD."rankNo", OLD."withinCapacity", OLD."tieGroupKey", OLD."tieOrdinal" )
  THEN
    RAISE EXCEPTION 'selection_entry_snapshot_immutable: entry % 의 동결 스냅샷은 수정할 수 없다', OLD."id"
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS "trg_selection_entry_snapshot_immutable" ON "SelectionEntry";
CREATE TRIGGER "trg_selection_entry_snapshot_immutable"
  BEFORE UPDATE ON "SelectionEntry"
  FOR EACH ROW
  EXECUTE FUNCTION dibs_selection_entry_snapshot_immutable();


-- -----------------------------------------------------------------------------
-- (12-2) AuditLog append-only + 해시 체인 자기검증
--
--   감사 로그는 "고칠 수 없다"가 유일한 가치다. UPDATE/DELETE 를 DB 가 거부해야 한다.
--   체인 검증을 트리거로 내리는 이유: prevHash 를 앱이 계산해서 넣는 한, 계산이 틀려도
--   /api/cron/audit-verify-chain 이 몇 시간 뒤에야 발견한다. 그때는 이미 그 위로 체인이 쌓여 있다.
--
--   ※ 이 트리거는 **커밋된 행만** 본다(READ COMMITTED). 동시 삽입 두 건이 같은 prevHash 를
--     읽는 것을 트리거가 막아주지는 못한다. 그래서 앱은 트랜잭션의 **첫 문장**으로
--     pg_advisory_xact_lock(hashtext(chainKey)) 를 잡아야 한다(락 순서를 균일하게 유지 = 데드락 회피).
--     chainKey 는 'global' 단일 체인이 아니라 targetType 또는 'event:{eventId}' 로 샤딩한다 —
--     안 그러면 finalize 트랜잭션이 도는 동안 플랫폼 전체의 감사 쓰기가 그 뒤에 줄을 선다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dibs_auditlog_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'auditlog_is_append_only: "AuditLog" 에 % 는 허용되지 않는다', TG_OP
    USING ERRCODE = 'raise_exception';
  RETURN NULL; -- 도달하지 않는다. plpgsql 이 "RETURN 없이 끝났다"고 불평하지 않게 두는 것뿐.
END;
$fn$;

DROP TRIGGER IF EXISTS "trg_auditlog_append_only" ON "AuditLog";
CREATE TRIGGER "trg_auditlog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION dibs_auditlog_append_only();

CREATE OR REPLACE FUNCTION dibs_auditlog_chain_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_prev "AuditLog"."rowHash"%TYPE;
BEGIN
  -- idx_audit_chain(chainKey, seq) 역방향 스캔 1행.
  SELECT a."rowHash"
    INTO v_prev
    FROM "AuditLog" a
   WHERE a."chainKey" = NEW."chainKey"
   ORDER BY a."seq" DESC
   LIMIT 1;

  IF v_prev IS NULL THEN
    IF NEW."prevHash" IS NOT NULL THEN
      RAISE EXCEPTION 'auditlog_chain_broken: 체인 % 의 첫 행은 prevHash 가 NULL 이어야 한다', NEW."chainKey"
        USING ERRCODE = 'raise_exception';
    END IF;
  ELSIF NEW."prevHash" IS DISTINCT FROM v_prev THEN
    RAISE EXCEPTION 'auditlog_chain_broken: 체인 % — prevHash 기대값 %, 실제 %',
      NEW."chainKey", v_prev, COALESCE(NEW."prevHash", '<null>')
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS "trg_auditlog_chain_guard" ON "AuditLog";
CREATE TRIGGER "trg_auditlog_chain_guard"
  BEFORE INSERT ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION dibs_auditlog_chain_guard();


-- -----------------------------------------------------------------------------
-- (12-3) Venue.regionCode 는 반드시 SIGUNGU 레벨 Region 을 가리킨다
--
--   FK 는 "Region 에 있는 코드"까지만 보장한다. SIDO 나 EUPMYEONDONG 행을 가리켜도 통과한다.
--   그러면 venue_search_region_idx(status, sido, sigungu)가 의미상 정의되지 않고,
--   Event.sigunguCode 를 venue.region.sigunguCode 에서 복사하는 유일한 경로도 NULL 을 물어온다.
--   교차 테이블 조건이라 CHECK 로는 표현할 수 없다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dibs_venue_region_level_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_level text;
BEGIN
  SELECT r."level"::text INTO v_level
    FROM "Region" r
   WHERE r."code" = NEW."regionCode";

  IF v_level IS DISTINCT FROM 'SIGUNGU' THEN
    RAISE EXCEPTION 'venue_region_must_be_sigungu: regionCode=% 의 level 이 % 다',
      NEW."regionCode", COALESCE(v_level, '<존재하지 않음>')
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS "trg_venue_region_level_guard" ON "Venue";
CREATE TRIGGER "trg_venue_region_level_guard"
  BEFORE INSERT OR UPDATE OF "regionCode" ON "Venue"
  FOR EACH ROW
  EXECUTE FUNCTION dibs_venue_region_level_guard();

-- ※ 시드 요구사항(앱/시드 스크립트 몫, 여기서는 강제할 수 없다):
--    Region 의 모든 SIGUNGU/EUPMYEONDONG 행에 sigunguCode(행정표준코드 5자리)를 채울 것.
--    Event.sigunguCode 는 venue.region.sigunguCode 를 복사하는 것 말고 채워지는 경로가 없다.


-- =============================================================================
-- §13. 선택 사항 — 켤 때는 schema.prisma 와 짝을 맞춰서
--
--   전부 주석 처리해 두었다. 지금 켜면 schema.prisma 의 대응 인덱스와 중복되어
--   가장 뜨거운 경로에 이중 쓰기 비용만 얹힌다. 아래 순서로만 켠다:
--     1) schema.prisma 에서 대응 @@index 줄 삭제  2) migrate  3) 이 블록 주석 해제  4) 이 파일 재실행
-- =============================================================================

-- (13-1) Event 인덱스 슬리밍 (현재 14개 → 목표 8개).
--   status 는 6값 enum 이라 선두 컬럼으로서 선택도가 거의 없다. 술어로 내리면 인덱스가 작업집합만 담는다.
--   짝: event_status_apply_end_idx / event_status_recent_idx / event_status_ratio_idx 삭제
-- CREATE INDEX IF NOT EXISTS "event_open_deadline" ON "Event" ("applyEndAt")
--   WHERE "status" = 'OPEN' AND "deletedAt" IS NULL;
-- CREATE INDEX IF NOT EXISTS "event_open_recent" ON "Event" ("openedAt" DESC)
--   WHERE "status" = 'OPEN' AND "deletedAt" IS NULL;
-- CREATE INDEX IF NOT EXISTS "event_open_ratio" ON "Event" ("competitionRatioX10" DESC)
--   WHERE "status" = 'OPEN' AND "deletedAt" IS NULL;

-- (13-2) Venue 공개 목록.  짝: venue_search_region_idx 삭제
-- CREATE INDEX IF NOT EXISTS "venue_active_region" ON "Venue" ("sido", "sigungu")
--   WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

-- (13-3) 예약금 만료 스위퍼의 진짜 부분 인덱스.  짝: application_deposit_due_idx 삭제
-- CREATE INDEX IF NOT EXISTS "app_deposit_due_pending" ON "Application" ("depositDueAt")
--   WHERE "depositStatus" = 'PENDING';


-- =============================================================================
-- 여기서 끝. 이 파일이 **덮지 못하는** 것들은 전부 앱 로직이며 별도로 지켜야 한다:
--   * BID 신청 트랜잭션의 첫 문장 SELECT ... FOR SHARE (마감과의 경합)
--   * INSTANT claim 의 대칭 가드 (slotClaimed=false 조건부 UPDATE 1행 확인 후에만 카운터 증가)
--   * 상향 전용을 쓰기 술어에 박기: WHERE "amount" < $new AND "highestAmountEver" <= $new
--   * 랭킹/스냅샷/해시를 전부 SQL 에서 계산 (Prisma 의 JS Date 는 밀리초라 Timestamptz(6)와 순서가 다르다)
--   * Idempotency-Key 를 도메인 쓰기와 같은 트랜잭션에서 기록/재생
--   * 공개 Prisma 클라이언트의 omit 맵 (settledAmount / rankNo / SelectionCutoff / ipHash 등, D-07)
-- =============================================================================
