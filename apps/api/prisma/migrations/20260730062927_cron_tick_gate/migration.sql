-- CreateTable
CREATE TABLE "CronTick" (
    "name" VARCHAR(64) NOT NULL,
    "nextRunAt" TIMESTAMPTZ(6) NOT NULL,
    "lastRunAt" TIMESTAMPTZ(6),
    "runCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CronTick_pkey" PRIMARY KEY ("name")
);
