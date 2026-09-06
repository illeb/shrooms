-- Stretta sull'invariante: si ingeriscono solo giorni COMPLETI.
--
-- Il giorno in corso non e' un'osservazione: un modello meteo lo chiude con le
-- ore non ancora avvenute, cioe' con una previsione. La versione precedente del
-- vincolo tollerava CURRENT_DATE + 1 e ha lasciato passare righe datate oggi.

DELETE FROM "daily_observation" WHERE "date" >= CURRENT_DATE;

ALTER TABLE "daily_observation" DROP CONSTRAINT "daily_observation_no_future_data";

-- Il confronto resta <= CURRENT_DATE e non < : il database ragiona in UTC
-- mentre le date sono giorni locali italiani, e un giorno di tolleranza evita
-- fallimenti spuri a cavallo della mezzanotte. La politica dei "soli giorni
-- completi" la applicano gli adapter; questo e' solo la rete di sicurezza
-- contro il futuro.
ALTER TABLE "daily_observation"
  ADD CONSTRAINT "daily_observation_no_future_data"
  CHECK ("date" <= CURRENT_DATE);
