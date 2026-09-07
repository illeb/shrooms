-- DropIndex
DROP INDEX "forest_polygon_geom_idx";

-- AlterTable
ALTER TABLE "forest_polygon" ALTER COLUMN "typeName" SET DATA TYPE TEXT,
ALTER COLUMN "categoryName" SET DATA TYPE TEXT,
ALTER COLUMN "speciesName" SET DATA TYPE TEXT,
ALTER COLUMN "species2Name" SET DATA TYPE TEXT,
ALTER COLUMN "management" SET DATA TYPE TEXT,
ALTER COLUMN "municipality" SET DATA TYPE TEXT;

