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

# Una passata subito all'avvio, attiva per default. Due motivi:
#
#  - al primo deploy, aspettare fino alle 5:30 per scoprire se la catena
#    funziona non ha senso;
#  - l'healthcheck chiede "c'e' stata un'ingestione nelle ultime 26 ore", e
#    senza corsa iniziale il container resterebbe unhealthy fino al giorno
#    dopo - il falso allarme che l'healthcheck doveva evitare.
#
# Costa una finestra recente, ~1.600 chiamate pesate su 10.000 giornaliere, e
# l'ingestione e' idempotente: rilanciarla non duplica niente.
#
# Quando ha girato l'ultima volta lo dice il DATABASE, non una variabile.
#
# CORRETTO SUL CAMPO: prima partiva da vuota, e il ciclo di recupero qui sotto
# concludeva che la corsa di oggi mancasse - anche se era avvenuta alle 5:30 e
# anche con `INGESTION_RUN_ON_START=false`, che quindi non impediva nulla e
# mentiva. Ogni riavvio del container dopo le 5:30 faceva una passata intera:
# innocua per i dati, che sono idempotenti, ma pagata in quota, che e' la
# risorsa scarsa di questo sistema.
#
# Con lo stato letto da `ingestion_run` lo scheduler diventa senza memoria
# propria: puoi riavviarlo dieci volte e resta una corsa al giorno.
ULTIMA_CORSA=$(cd /app/apps/api \
  && node dist/src/cli/main.cli.js ingestion:last 2>/dev/null \
  | sed -n 's/^ULTIMA_INGESTIONE=//p' | tail -1)
if [ -n "$ULTIMA_CORSA" ]; then
  echo "Ultima ingestione a database: $ULTIMA_CORSA."
else
  echo "Nessuna ingestione a database."
fi

if [ "${INGESTION_RUN_ON_START:-true}" = "true" ]; then
  echo "INGESTION_RUN_ON_START=true: passata immediata."
  /app/docker/scheduler/run-daily.sh
  ULTIMA_CORSA=$(date '+%Y-%m-%d')
fi

# Si controlla ogni minuto, invece di dormire fino all'ora esatta.
#
# CORRETTO SUL CAMPO: prima c'era un solo `sleep` lungo, calcolato una volta.
# Su un portatile non funziona - il Mac ha dormito la notte, la VM di Docker
# si e' sospesa, e `sleep` conta il tempo di attivita' della VM e non
# l'orologio da parete: la sveglia delle 5:30 e' arrivata con tre ore e mezza
# di ritardo, con il container "healthy" e nessun errore da nessuna parte.
#
# Un ciclo che confronta l'orologio ogni minuto e' immune a tutto questo:
# sospensione, salti d'orologio, correzioni NTP, cambi d'ora legale. E
# recupera: se l'ora e' passata mentre la macchina dormiva, si parte subito
# invece di rimandare a domani. Millequattrocento risvegli al giorno per un
# confronto fra due interi non si misurano.
while true; do
  OGGI=$(date '+%Y-%m-%d')
  BERSAGLIO=$(date -d "today $INGESTION_AT" +%s)
  ADESSO=$(date +%s)

  if [ "$ULTIMA_CORSA" != "$OGGI" ] && [ "$ADESSO" -ge "$BERSAGLIO" ]; then
    RITARDO=$(( (ADESSO - BERSAGLIO) / 60 ))
    if [ "$RITARDO" -gt 5 ]; then
      # Detto ad alta voce: un ritardo grosso vuol dire che la macchina era
      # sospesa o spenta, e va visto invece di essere assorbito in silenzio.
      echo "Sveglia in ritardo di $RITARDO min sull'orario delle $INGESTION_AT" \
           "(macchina sospesa o container fermo?). Parto adesso."
    fi
    /app/docker/scheduler/run-daily.sh
    ULTIMA_CORSA=$OGGI
    echo "Prossima ingestione: domani alle $INGESTION_AT ($(date '+%Z'))."
  fi

  sleep 60
done
