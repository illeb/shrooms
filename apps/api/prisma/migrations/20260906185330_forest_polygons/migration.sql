-- DropIndex
DROP INDEX "prediction_site_geom_idx";

-- CreateTable
CREATE TABLE "forest_polygon" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "objectId" INTEGER NOT NULL,
    "province" VARCHAR(4) NOT NULL,
    "typeCode" VARCHAR(12) NOT NULL,
    "typeName" VARCHAR(120) NOT NULL,
    "categoryName" VARCHAR(160),
    "speciesCode" VARCHAR(8),
    "speciesName" VARCHAR(120),
    "species2Name" VARCHAR(120),
    "management" VARCHAR(80),
    "municipality" VARCHAR(80),
    "areaHa" DOUBLE PRECISION NOT NULL,
    "geom" geometry(MultiPolygon, 4326) NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forest_polygon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forest_polygon_typeCode_idx" ON "forest_polygon"("typeCode");

-- CreateIndex
CREATE UNIQUE INDEX "forest_polygon_province_objectId_key" ON "forest_polygon"("province", "objectId");


-- Indice spaziale: la classificazione delle celle interroga per intersezione.
CREATE INDEX "forest_polygon_geom_idx" ON "forest_polygon" USING GIST ("geom");
