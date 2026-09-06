-- CreateEnum
CREATE TYPE "WeatherSourceCode" AS ENUM ('ARPAE_ER', 'OPEN_METEO', 'MARCHE_AMAP', 'SIR_TOSCANA');

-- AlterTable
ALTER TABLE "ingestion_run" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- CreateTable
CREATE TABLE "station" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" "WeatherSourceCode" NOT NULL,
    "externalId" VARCHAR(128) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "network" VARCHAR(64),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitudeM" DOUBLE PRECISION,
    "region" VARCHAR(64),
    "province" VARCHAR(8),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstObservedOn" DATE,
    "lastObservedOn" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_observation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stationId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source" "WeatherSourceCode" NOT NULL,
    "tMeanC" DOUBLE PRECISION,
    "tMinC" DOUBLE PRECISION,
    "tMaxC" DOUBLE PRECISION,
    "precipMm" DOUBLE PRECISION,
    "rhMeanPct" DOUBLE PRECISION,
    "soilT0To7C" DOUBLE PRECISION,
    "soilT7To28C" DOUBLE PRECISION,
    "soilMoisture0To7" DOUBLE PRECISION,
    "sampleCount" INTEGER,
    "forecast" BOOLEAN NOT NULL DEFAULT false,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_observation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "station_latitude_longitude_idx" ON "station"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "station_altitudeM_idx" ON "station"("altitudeM");

-- CreateIndex
CREATE INDEX "station_region_active_idx" ON "station"("region", "active");

-- CreateIndex
CREATE UNIQUE INDEX "station_source_externalId_key" ON "station"("source", "externalId");

-- CreateIndex
CREATE INDEX "daily_observation_date_idx" ON "daily_observation"("date");

-- CreateIndex
CREATE INDEX "daily_observation_stationId_date_idx" ON "daily_observation"("stationId", "date");

-- CreateIndex
CREATE INDEX "daily_observation_source_date_idx" ON "daily_observation"("source", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_observation_stationId_date_source_key" ON "daily_observation"("stationId", "date", "source");

-- AddForeignKey
ALTER TABLE "daily_observation" ADD CONSTRAINT "daily_observation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "station"("id") ON DELETE CASCADE ON UPDATE CASCADE;
