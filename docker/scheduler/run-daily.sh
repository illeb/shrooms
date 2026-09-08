#!/bin/sh
# La giornata dell'applicazione, in ordine.
#
# Gira nel container `scheduler`, che usa la stessa immagine dell'API: un
# comando lanciato a mano e lo stesso comando lanciato qui eseguono
# esattamente lo stesso codice, che e' il motivo per cui il cron non ha una
# sua implementazione parallela.
#
# Non usa `set -e`. Un passo che finisce in PARTIAL - tipicamente un rate
# limit di Open-Meteo - ha comunque scritto dati validi, e fermare la catena
# li' vorrebbe dire lasciare la mappa a ieri per un problema che si risolve
# domani da solo. Ogni passo riporta il suo esito e la catena continua; solo
# un database irraggiungibile fa fallire tutto, e lo fa al primo passo.
set -u

CLI="node dist/src/cli/main.cli.js"
FAILED=0

step() {
  titolo=$1
  shift
  echo ""
  echo "──── $titolo ────"
  if $CLI "$@"; then
    return 0
  fi
  echo "!! passo fallito: $titolo"
  FAILED=$((FAILED + 1))
}

echo "════ ingestione giornaliera $(date '+%Y-%m-%d %H:%M:%S %Z') ════"

# Il database prima di tutto: se non risponde, il resto e' fiato sprecato.
if ! $CLI health:check; then
  echo "!! database irraggiungibile, non parto"
  exit 1
fi

# 1. Arpae. Finestra di sette giorni e non di uno: Arpae valida e corregge i
#    giorni gia' pubblicati, e rileggerli e' il modo in cui recuperiamo le
#    correzioni. Non ha limiti di chiamate, quindi la finestra costa solo tempo.
step "Arpae Emilia-Romagna" ingest:weather --source=ARPAE_ER

# 2. Open-Meteo sulla stessa finestra: suolo e umidita', che nessuna rete
#    regionale misura, piu' i giorni recenti che la rianalisi rivede.
#    ~3.200 localita' x 7 giorni / 14 = circa 1.600 chiamate pesate contro le
#    10.000 gratuite: il mantenimento sta larghissimo, e' il backfill iniziale
#    a costare.
step "Open-Meteo, finestra recente" ingest:weather --source=OPEN_METEO

# 3. Il passo che fa convergere il sistema da solo.
#
#    `--only-missing` salta le stazioni che hanno gia' tutti i giorni
#    dell'intervallo, quindi quando non manca nulla questo passo costa una
#    query e zero chiamate. Quando invece un rate limit ha lasciato buchi -
#    ed e' successo - li chiude al primo giorno in cui c'e' quota, senza che
#    nessuno debba accorgersene e rilanciare a mano.
#    Due intervalli e non uno, allineati a come Open-Meteo serve i dati:
#    l'archivio ERA5 arriva fino a sei giorni indietro, i giorni piu' recenti
#    stanno sull'altro endpoint.
#
#    La ragione e' la ripresa. `--only-missing` valuta l'intervallo **intero**:
#    con un unico comando da 89 giorni, una cella che ne ha ricevuti 84 prima
#    del rate limit risulta incompleta e il giorno dopo viene riscaricata da
#    zero. Con gli intervalli separati il progresso e' durevole - chi ha finito
#    l'archivio viene saltato domani, e resta solo la coda recente, che costa
#    un ventesimo. Su celle appena create, dove mancano tutti i giorni, e' la
#    differenza fra convergere in due mattine e non convergere mai.
ARCHIVIO_DA=$(date -u -d '89 days ago' '+%Y-%m-%d')
ARCHIVIO_A=$(date -u -d '6 days ago' '+%Y-%m-%d')
RECENTE_DA=$(date -u -d '5 days ago' '+%Y-%m-%d')
RECENTE_A=$(date -u -d 'yesterday' '+%Y-%m-%d')

step "Open-Meteo, archivio ($ARCHIVIO_DA → $ARCHIVIO_A)" \
  ingest:weather --source=OPEN_METEO --from="$ARCHIVIO_DA" --to="$ARCHIVIO_A" --only-missing

step "Open-Meteo, giorni recenti ($RECENTE_DA → $RECENTE_A)" \
  ingest:weather --source=OPEN_METEO --from="$RECENTE_DA" --to="$RECENTE_A" --only-missing

# 4. I punteggi, una specie alla volta. Senza questo passo si scarica il meteo
#    e la mappa resta a ieri, che e' il modo piu' silenzioso di avere
#    un'applicazione rotta.
#
#    Le specie stanno in una variabile e non nel codice del ciclo perche' e'
#    l'unico punto da toccare quando se ne aggiunge una: il resto della catena
#    non sa quante siano. Ognuna ha il suo profilo e i suoi punteggi; le
#    feature meteo sono in comune, ed e' corretto - il bilancio idrico
#    descrive il suolo, non il fungo.
: "${INGESTION_SPECIES:=boletus-edulis boletus-aereus}"
for specie in $INGESTION_SPECIES; do
  step "Punteggi $specie" predict:run --species="$specie"
done

# 5. Potatura. Il modello guarda indietro ~120 giorni; la retention di default
#    ne tiene 400, cioe' una stagione intera per i confronti. Serve `--apply`
#    perche' il comando, da solo, si limita a dire cosa farebbe.
step "Potatura dello storico" data:prune --apply

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "════ giornata completata ════"
else
  echo "════ giornata completata con $FAILED passi falliti ════"
fi

# Sempre 0: il ciclo dello scheduler deve continuare anche dopo una giornata
# andata male. Gli esiti veri stanno nella tabella `ingestion_run`, che
# registra ogni ingestione con stato, righe e durata.
exit 0
