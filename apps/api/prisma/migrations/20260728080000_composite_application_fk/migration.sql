-- Application 을 가리키는 FK 를 **복합 FK 하나로** 정리한다.
--
-- 그동안 두 개가 공존했다:
--   Deposit_applicationId_fkey        (init 이 만든 단일 컬럼 FK)
--   deposit_app_identity_fk           (001_constraints 가 만든 복합 FK)
--
-- 복합 FK 가 있으면 단일 FK 는 의미가 없다 — (id, eventId, userId) 가 부모 행을 특정하므로
-- id 일치는 자동으로 보장된다. 게다가 같은 제약을 SQL 과 Prisma 가 각각 관리하는 상태라
-- `migrate dev` 가 매번 "설명되지 않는 FK" 라며 드리프트를 보고했다.
--
-- 이제 schema.prisma 의 @relation(fields: [applicationId, eventId, userId], …, map: "…")
-- 이 복합 FK 를 소유한다. 여기서는 낡은 단일 FK 만 걷어낸다.

ALTER TABLE "Deposit"        DROP CONSTRAINT IF EXISTS "Deposit_applicationId_fkey";
ALTER TABLE "BidHistory"     DROP CONSTRAINT IF EXISTS "BidHistory_applicationId_fkey";
ALTER TABLE "SelectionEntry" DROP CONSTRAINT IF EXISTS "SelectionEntry_applicationId_fkey";

-- 복합 FK 를 **정의까지 똑같이** 다시 만든다.
--
-- 001 이 만든 기존 제약은 ON UPDATE 를 지정하지 않아 NO ACTION 이었는데, Prisma 의
-- @relation 은 ON UPDATE CASCADE 를 기대한다. 정의가 한 글자라도 다르면 `migrate dev`
-- 가 "제약을 지웠다가 다시 만들겠다"며 드리프트로 계속 보고한다.
-- DROP 후 ADD 라 이미 있는 DB 에서도, 처음 만드는 DB 에서도 같은 결과가 된다.

ALTER TABLE "Deposit" DROP CONSTRAINT IF EXISTS "deposit_app_identity_fk";
ALTER TABLE "Deposit" ADD CONSTRAINT "deposit_app_identity_fk"
  FOREIGN KEY ("applicationId", "eventId", "userId")
  REFERENCES "Application" ("id", "eventId", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BidHistory" DROP CONSTRAINT IF EXISTS "bid_history_app_identity_fk";
ALTER TABLE "BidHistory" ADD CONSTRAINT "bid_history_app_identity_fk"
  FOREIGN KEY ("applicationId", "eventId", "userId")
  REFERENCES "Application" ("id", "eventId", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SelectionEntry" DROP CONSTRAINT IF EXISTS "selection_entry_app_identity_fk";
ALTER TABLE "SelectionEntry" ADD CONSTRAINT "selection_entry_app_identity_fk"
  FOREIGN KEY ("applicationId", "eventId", "userId")
  REFERENCES "Application" ("id", "eventId", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
