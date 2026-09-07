-- Prisma non conosce gli indici sulle colonne `Unsupported`, quindi li elimina
-- a ogni ALTER TABLE sulla stessa tabella. Va ricreato a parte: senza, la
-- classificazione delle celle scansiona tutti i poligoni forestali.
CREATE INDEX IF NOT EXISTS "forest_polygon_geom_idx" ON "forest_polygon" USING GIST ("geom");
