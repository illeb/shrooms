#!/bin/sh
# Scheduler: dorme fino all'ora stabilita, lancia la giornata, ricomincia.
#
# Un ciclo di shell e non `cron`. Le ragioni, in ordine di peso:
#
#  - l'immagine e' `node:24-slim`, che non ha un demone cron: installarlo
#    aggiunge un pacchetto per fare una cosa che qui sono dieci righe;
#  - cron azzera l'ambiente prima di eseguire, ed e' il modo classico di
#    scoprire in produzione che `DATABASE_URL` non c'era. Qui le variabili
#    sono quelle del container, senza travasi;
#  - i log finiscono su stdout, quindi `docker logs` e non un file dentro il
#    container che nessuno guardera' mai.
#
# `restart: unless-stopped` in compose copre il caso in cui il processo muoia:
# alla ripartenza si ricalcola la prossima occorrenza e si riprende.
set -u

: "${INGESTION_AT:=05:30}"

if ! echo "$INGESTION_AT" | grep -Eq '^([01][0-9]|2[0-3]):[0-5][0-9]$'; then
  echo "INGESTION_AT deve essere HH:MM (24h), ricevuto \"$INGESTION_AT\"" >&2
  exit 1
fi

echo "Scheduler avviato. Ingestione ogni giorno alle $INGESTION_AT ($(date '+%Z'))."

# Una passata subito all'avvio, se richiesta: comoda al primo deploy, dove
# aspettare fino alle 5:30 per sapere se la catena funziona non ha senso.
if [ "${INGESTION_RUN_ON_START:-false}" = "true" ]; then
  echo "INGESTION_RUN_ON_START=true: passata immediata."
  /app/docker/scheduler/run-daily.sh
fi

while true; do
  ADESSO=$(date +%s)
  OGGI=$(date -d "today $INGESTION_AT" +%s)

  # Se l'ora di oggi e' passata, si punta a domani.
  if [ "$OGGI" -gt "$ADESSO" ]; then
    PROSSIMA=$OGGI
  else
    PROSSIMA=$(date -d "tomorrow $INGESTION_AT" +%s)
  fi

  ATTESA=$((PROSSIMA - ADESSO))
  echo "Prossima ingestione: $(date -d "@$PROSSIMA" '+%Y-%m-%d %H:%M %Z') (fra $((ATTESA / 60)) min)."
  sleep "$ATTESA"

  /app/docker/scheduler/run-daily.sh
done
