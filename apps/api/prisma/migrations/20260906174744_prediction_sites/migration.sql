-- CreateEnum
CREATE TYPE "ForestType" AS ENUM ('FAGGETA', 'CASTAGNETO', 'QUERCETO', 'CONIFERE', 'MISTO', 'ALTRO');

-- DropIndex
DROP INDEX "province_boundary_geom_idx";

-- CreateTable
CREATE TABLE "prediction_site" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitudeM" DOUBLE PRECISION NOT NULL,
    "forestType" "ForestType" NOT NULL,
    "forestCode" VARCHAR(8) NOT NULL,
    "forestLabel" VARCHAR(120) NOT NULL,
    "province" VARCHAR(8),
    "provinceName" VARCHAR(64),
    "region" VARCHAR(64),
    "stationId" UUID NOT NULL,
    "nearestStationKm" DOUBLE PRECISION,
    "geom" geometry(Polygon, 4326) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_site_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prediction_site_code_key" ON "prediction_site"("code");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_site_stationId_key" ON "prediction_site"("stationId");

-- CreateIndex
CREATE INDEX "prediction_site_forestType_altitudeM_idx" ON "prediction_site"("forestType", "altitudeM");

-- CreateIndex
CREATE INDEX "prediction_site_region_province_idx" ON "prediction_site"("region", "province");

-- AddForeignKey
ALTER TABLE "prediction_site" ADD CONSTRAINT "prediction_site_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "station"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Indice spaziale sugli esagoni: la mappa li chiede per riquadro.
CREATE INDEX "prediction_site_geom_idx" ON "prediction_site" USING GIST ("geom");
