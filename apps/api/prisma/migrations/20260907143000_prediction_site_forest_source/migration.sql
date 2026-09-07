-- Ogni cella dice da quale carta forestale viene la sua etichetta.
--
-- Sul crinale le due carte si sovrappongono e la dominanza d'area sceglie fra
-- loro in silenzio: senza questa colonna una cella toscana etichettata dalla
-- carta emiliana 2025 e una etichettata dall'inventario toscano del 1990
-- sarebbero indistinguibili.
ALTER TABLE "prediction_site" ADD COLUMN "forestSource" "ForestMapSource";

-- Le celle che c'erano sono tutte state classificate dalla sola carta
-- disponibile allora.
UPDATE "prediction_site" SET "forestSource" = 'ER_2025';

CREATE INDEX IF NOT EXISTS "forest_polygon_geom_idx" ON "forest_polygon" USING GIST ("geom");
CREATE INDEX IF NOT EXISTS "prediction_site_geom_idx" ON "prediction_site" USING GIST ("geom");
