-- Due carte forestali invece di una.
--
-- L'Emilia-Romagna arriva dalla Carta forestale regionale 2025, la Toscana
-- dall'Inventario Forestale Toscano (rilievo 1985-1993, revisione 2009). Non
-- sono confrontabili alla cieca, quindi ogni poligono dice da dove viene.

CREATE TYPE "ForestMapSource" AS ENUM ('ER_2025', 'IFT_TOSCANA');

-- Le leccete esistono in entrambe le regioni: 96 pixel in Emilia-Romagna
-- (costiera su dune, supramediterranea rupestre) e 8.975 in Toscana fra
-- leccete e sugherete.
ALTER TYPE "ForestType" ADD VALUE 'LECCETA';

-- Default solo per popolare le righe che c'erano: tutte vengono dalla carta
-- emiliana, che era l'unica sorgente. Poi il default va via, cosi' un import
-- futuro e' obbligato a dichiarare da dove sta leggendo.
ALTER TABLE "forest_polygon"
  ADD COLUMN "source" "ForestMapSource" NOT NULL DEFAULT 'ER_2025';
ALTER TABLE "forest_polygon" ALTER COLUMN "source" DROP DEFAULT;

-- La chiave era (provincia, objectId): con due carte gli identificativi si
-- sovrappongono, perche' ognuna numera i suoi.
DROP INDEX "forest_polygon_province_objectId_key";
CREATE UNIQUE INDEX "forest_polygon_source_province_objectId_key"
  ON "forest_polygon" ("source", "province", "objectId");
CREATE INDEX "forest_polygon_source_idx" ON "forest_polygon" ("source");

-- Rete di sicurezza: gli indici GIST stanno su colonne `Unsupported`, che
-- Prisma non modella, e ogni ALTER TABLE generato da lui li fa cadere.
CREATE INDEX IF NOT EXISTS "forest_polygon_geom_idx" ON "forest_polygon" USING GIST ("geom");
CREATE INDEX IF NOT EXISTS "prediction_site_geom_idx" ON "prediction_site" USING GIST ("geom");
