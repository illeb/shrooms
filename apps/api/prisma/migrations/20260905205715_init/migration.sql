-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ingestion_run" (
    "id" UUID NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "rangeFrom" DATE NOT NULL,
    "rangeTo" DATE NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'RUNNING',
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,

    CONSTRAINT "ingestion_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingestion_run_source_startedAt_idx" ON "ingestion_run"("source", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ingestion_run_status_idx" ON "ingestion_run"("status");
