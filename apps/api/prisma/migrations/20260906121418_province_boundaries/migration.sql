-- AlterTable
ALTER TABLE "station" ADD COLUMN     "provinceName" VARCHAR(64);

-- CreateTable
CREATE TABLE "province_boundary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "acronym" VARCHAR(8) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "region" VARCHAR(64) NOT NULL,
    "istatCode" VARCHAR(8) NOT NULL,
    "geom" geometry(MultiPolygon, 4326) NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "province_boundary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "province_boundary_acronym_key" ON "province_boundary"("acronym");


-- Indice spaziale: senza, ogni ST_Contains scansiona tutte le 110 province.
CREATE INDEX "province_boundary_geom_idx" ON "province_boundary" USING GIST ("geom");
