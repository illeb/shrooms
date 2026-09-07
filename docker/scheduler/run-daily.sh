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
INIZIO=$(date -u -d '89 days ago' '+%Y-%m-%d')
FINE=$(date -u -d 'yesterday' '+%Y-%m-%d')
step "Open-Meteo, recupero buchi ($INIZIO → $FINE)" \
  ingest:weather --source=OPEN_METEO --from="$INIZIO" --to="$FINE" --only-missing

# 4. I punteggi. Senza questo passo si scarica il meteo e la mappa resta a
#    ieri, che e' il modo piu' silenzioso di avere un'applicazione rotta.
step "Punteggi di fruttificazione" predict:run

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
