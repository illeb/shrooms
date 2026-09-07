-- DropIndex
DROP INDEX "forest_polygon_geom_idx";

-- DropIndex
DROP INDEX "prediction_site_geom_idx";

-- AlterTable
ALTER TABLE "prediction_site" ADD COLUMN     "forestFraction" DOUBLE PRECISION,
ADD COLUMN     "management" TEXT,
ALTER COLUMN "forestLabel" SET DATA TYPE TEXT;

-- Gli indici GIST li ricreiamo a mano: stanno su colonne `Unsupported`, che
-- Prisma non modella, quindi ogni ALTER TABLE su queste tabelle li fa cadere.
CREATE INDEX IF NOT EXISTS "forest_polygon_geom_idx" ON "forest_polygon" USING GIST ("geom");
CREATE INDEX IF NOT EXISTS "prediction_site_geom_idx" ON "prediction_site" USING GIST ("geom");
