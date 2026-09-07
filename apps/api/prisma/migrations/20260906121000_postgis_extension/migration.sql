-- PostGIS.
--
-- Finora l'estensione la creava solo lo script di init dell'immagine Docker,
-- quindi la storia delle migrazioni non la conteneva: il database ombra che
-- Prisma costruisce per calcolare i diff partiva senza, e ogni `migrate dev`
-- moriva su `type "geometry" does not exist`.
--
-- Sta qui, prima della migrazione che introduce la prima colonna geometrica.
CREATE EXTENSION IF NOT EXISTS postgis;
