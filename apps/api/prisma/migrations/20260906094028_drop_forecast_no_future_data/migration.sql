-- Il sistema non usa piu' previsioni meteo: valuta se le condizioni per una
-- buttata ci sono ADESSO, guardando la pioggia caduta e le temperature che
-- l'hanno seguita. Nessun dato futuro deve restare a database.

-- 1. Via le osservazioni datate nel futuro, inserite quando l'ingestione
--    scaricava anche i giorni di previsione.
DELETE FROM "daily_observation" WHERE "date" > CURRENT_DATE;

-- 2. Via la colonna che le marcava: non ha piu' ragione di esistere.
ALTER TABLE "daily_observation" DROP COLUMN "forecast";

-- 3. Presidio a livello di database, non solo di codice: un domani un adapter
--    distratto non puo' reintrodurre il futuro di nascosto.
ALTER TABLE "daily_observation"
  ADD CONSTRAINT "daily_observation_no_future_data"
  CHECK ("date" <= CURRENT_DATE + INTERVAL '1 day');
