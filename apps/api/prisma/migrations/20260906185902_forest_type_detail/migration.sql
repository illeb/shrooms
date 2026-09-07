-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ForestType" ADD VALUE 'CERRETA';
ALTER TYPE "ForestType" ADD VALUE 'ORNO_OSTRIETO';

-- DropIndex
DROP INDEX "forest_polygon_geom_idx";


CREATE INDEX IF NOT EXISTS "forest_polygon_geom_idx" ON "forest_polygon" USING GIST ("geom");
CREATE INDEX IF NOT EXISTS "prediction_site_geom_idx" ON "prediction_site" USING GIST ("geom");
