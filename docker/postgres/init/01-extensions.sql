-- Eseguito una sola volta, alla creazione del volume.
CREATE EXTENSION IF NOT EXISTS postgis;          -- geometrie stazioni / siti
CREATE EXTENSION IF NOT EXISTS pg_trgm;          -- ricerca fuzzy sui nomi stazione
CREATE EXTENSION IF NOT EXISTS btree_gist;       -- vincoli di esclusione su range temporali

SELECT postgis_version();
