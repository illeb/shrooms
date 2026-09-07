# mushrooms-predictions

Previsione delle condizioni di fruttificazione dei funghi (a partire dai porcini,
gruppo _Boletus edulis_) a partire dai dati delle stazioni meteo italiane con
dati aperti.

**Stato: step 2 di 5 — ingestione.** Il monorepo gira end-to-end
(Nuxt → GraphQL → NestJS → Postgres) e scarica davvero i dati: Arpae per aria e
pioggia, Open-Meteo per il suolo. Il motore di scoring arriva nello step 3.

---

## Struttura

```
apps/
  api/                 NestJS 12 — GraphQL code-first, Prisma, cron + CLI di ingestione
  web/                 Nuxt 4 + Nuxt UI — tabella e mappa, client Apollo
packages/
  mycology-core/       Motore di previsione. TypeScript puro: niente Nest, niente DB,
                       niente rete. È qui che vive (e si tara) l'algoritmo.
  graphql-schema/      Artefatto SDL condiviso + codegen dei tipi per il frontend
docker/
  postgres/init/       Estensioni create alla prima inizializzazione del volume
```

## Requisiti

- Node **>= 22** (sviluppato su 24)
- pnpm **10**
- Docker (per Postgres + PostGIS)

## Avvio

```bash
cp .env.example .env
pnpm install
pnpm db:up                                   # Postgres + PostGIS su :55432
pnpm --filter @mushrooms/api db:migrate      # applica le migration
pnpm build
pnpm dev                                     # API :4000 — Web :3000
```

Verifica rapida:

```bash
curl localhost:4000/health           # {"status":"ok",...}
curl localhost:4000/health/ready     # {"status":"ok","database":"up"}
curl -X POST localhost:4000/graphql -H 'content-type: application/json' \
     -d '{"query":"{ apiInfo { name environment } }"}'
open http://localhost:3000
```

## Comandi

| Comando                                             | Cosa fa                                           |
| --------------------------------------------------- | ------------------------------------------------- |
| `pnpm build` / `pnpm test` / `pnpm typecheck`       | Pipeline Turborepo su tutti i package             |
| `pnpm db:up` / `pnpm db:down` / `pnpm db:psql`      | Ciclo di vita di Postgres                         |
| `pnpm --filter @mushrooms/api db:migrate`           | `prisma migrate dev`                              |
| `pnpm --filter @mushrooms/api cli`                  | Elenca i comandi one-shot (ingestione, backtest…) |
| `pnpm --filter @mushrooms/graphql-schema codegen`   | Rigenera i tipi TS delle query del frontend       |
| `pnpm --filter @mushrooms/mycology-core test:watch` | Loop di test sul motore                           |

## Note di configurazione

Alcune scelte non ovvie, con il perché:

- **Niente Turborepo, solo pnpm workspaces.** `pnpm -r` ricava l'ordine
  topologico dal grafo `workspace:*`, quindi i pacchetti si compilano prima
  delle app senza doverlo ridichiarare. L'unico vantaggio che Turbo aggiungeva
  era la cache — 5,8 s risparmiati su una ricostruzione senza modifiche, in un
  monorepo dove la build completa dura sei secondi. Non valeva una dipendenza e
  un file di configurazione in più. Da rivalutare con una CI a cache remota, o
  quando i pacchetti si moltiplicheranno.
- **`build:libs` esiste perché `pnpm -r` non ha un `dependsOn`.** `test` e
  `typecheck` hanno bisogno che `mycology-core` sia compilato (l'API typechecka
  contro i suoi `.d.ts`), ma non di ricostruire le app. Compilare i soli
  `packages/*` costa 0,6 s contro i 6 di una build completa.

- **Postgres sulla porta 55432**, non 5432: la 5432 è spesso già occupata da
  altri progetti. Cambiabile con `POSTGRES_PORT` nel `.env`.
- **Immagine `imresamu/postgis`** e non `postgis/postgis`: quest'ultima pubblica
  solo `amd64` e su Apple Silicon girerebbe emulata. Stesso contenuto, è la
  variante multi-arch indicata dal README ufficiale di PostGIS.
- **TypeScript bloccato alla 6.0.3.** La 7.x (port nativo in Go) non espone
  ancora l'API programmatica del compilatore, che serve alla CLI di Nest:
  torna nella 7.1. Da rivalutare allora.
- **GraphQL bloccato alla 16.** `@apollo/server` 5 e `graphql-config` non
  supportano ancora la 17.
- **Prisma 7 richiede un driver adapter esplicito** (`@prisma/adapter-pg`) e
  genera il client come _sorgenti TypeScript_ in `apps/api/src/generated/`
  (artefatto di build, non versionato: `prisma generate` gira nel `prebuild`).
- **Dependency injection esplicita** (`@Inject(...)`) nei costruttori Nest: la
  CLI gira con `tsx`, che non emette i metadati dei decoratori. Senza `@Inject`
  la stessa classe funziona sotto `nest build` e si rompe sotto `tsx`.
- **I filtri vivono nella query string**, non in uno stato locale: un link
  porta con se' cio' che stavi guardando (`?stazione=…&quotaMin=1000`), e il
  tasto indietro torna alla vista precedente. Nella rotta finisce solo cio' che
  si discosta dai default, altrimenti ogni pagina trascinerebbe cinque
  parametri inutili.
- **Leaflet, non MapLibre.** MapLibre elabora le sorgenti GeoJSON in un web
  worker che il bundler di Nuxt non emetteva fra gli asset: il risultato era una
  mappa perfetta con zero punti e nessun errore in console. Impostare
  `setWorkerUrl` faceva caricare il worker ma le sorgenti restavano vuote. Per
  duecento marker cliccabili il WebGL non serviva: con Leaflet i punti sono
  elementi SVG nel DOM, e cio' che si vede e' cio' che c'e'.
- **`CircleMarker` invece di `Marker`**: niente PNG delle icone, quindi nessun
  problema di percorsi degli asset, e il colore si imposta direttamente.
- **Apollo Client 3, non 4.** `@vue/apollo-composable` dichiara come peer
  `@apollo/client@^3`, e `@nuxtjs/apollo` e' fermo a una release candidate: la
  combinazione che sta in piedi e' Apollo Client 3.14 con un plugin Nuxt scritto
  a mano (12 righe) invece del modulo.
- **Le query passano da `useAsyncData`**, non da `useQuery` di
  `@vue/apollo-composable`: quest'ultimo non trasferisce il risultato dal server
  al client in Nuxt, e produce una seconda fetch con un lampo di stato vuoto in
  idratazione. La libreria resta Apollo, cambia solo chi tiene lo stato.
- **Apollo Client manda `apollo-require-preflight`**: Apollo Server 5 ha la
  protezione CSRF attiva di default. Preferito a disattivarla lato server.
- **La data viaggia come stringa `YYYY-MM-DD`**, non come `DateTime`: e' un
  giorno locale italiano, e passarlo come istante lo esporrebbe a slittamenti di
  fuso proprio dove abbiamo lavorato per evitarli.

## Il motore di previsione

`packages/mycology-core` è deliberatamente isolato dal resto: funzioni pure,
nessun I/O, test veloci. Oggi contiene le primitive numeriche e i contratti di
dominio:

- `math/membership.ts` — trapezio, gaussiana, curva saturante, rampa lineare e
  media geometrica pesata (composizione "alla Liebig": un fattore a zero azzera
  il punteggio).
- `water/eto.ts` — evapotraspirazione di riferimento con Hargreaves-Samani.
  Richiede solo Tmin/Tmax/latitudine/giorno, cioè quello che ogni stazione
  pubblica. Validato contro l'Esempio 8 della FAO-56.
- `water/balance.ts` — bilancio idrico del suolo a serbatoio. È la traduzione
  quantitativa di _"precipitazione cumulata **e residua al suolo**"_: c'è un
  test che verifica che 150 mm di temporali d'agosto lascino il suolo più
  secco di 80 mm di pioggia d'ottobre.
- `types.ts` — forma del `SpeciesProfile`, il file YAML in cui si tara il
  modello senza toccare codice.

Sopra queste primitive gira il motore:

- `features/build.ts` — dalle osservazioni fuse alle ~30 feature giornaliere:
  finestre mobili right-aligned, bilancio idrico, shock termico, strisce di
  siccita' e gelo.
- `scoring/trigger.ts` — eventi di bagnatura e finestra di incubazione. E' il
  pezzo che traduce il "tempo di crescita": una pioggia non produce funghi il
  giorno stesso, apre una finestra che si chiude giorni dopo.
- `scoring/engine.ts` — regole, inibitori, fenologia, composizione
  moltiplicativa. Non conosce nessuna specie: legge un `SpeciesProfile`.
- `profiles/boletus-edulis.ts` — il profilo, con la **provenienza di ogni
  numero** annotata: `[BH25]` Brejon Lamartiniere & Hoffman 2025, `[MP12]`
  Martinez-Pena et al. 2012, `[LIT]` letteratura generale.
- `scoring/yield-model.ts` — l'equazione di resa stagionale di [MP12], tenuta
  come secondo parere indipendente. Con R^2 = 0,22 e' un ordine di grandezza,
  non una misura, e va mostrata dicendolo.

## Tarare il modello

Il profilo si modifica in YAML, senza toccare codice:

```bash
cli model:export --file=profiles/boletus-edulis.yaml   # scrive il profilo attivo
# si editano i numeri
cli model:load --file=profiles/boletus-edulis.yaml     # valida e attiva una NUOVA versione
cli predict:run                                        # ricalcola i punteggi
```

Ogni caricamento crea una versione nuova invece di sovrascrivere: due tarature
convivono e si confrontano a parita' di dati. La validazione blocca i refusi
nelle chiavi di feature, che altrimenti produrrebbero una regola sempre saltata

- un modello che gira, da numeri plausibili, e ignora in silenzio un criterio.

## Come sono organizzati i dati

Due sorgenti, una riga per `(stazione, giorno, sorgente)`:

- **Arpae** misura aria e pioggia, ma **nessuna sua rete misura il suolo**.
- **Open-Meteo** aggiunge temperatura e umidita' del suolo per le stesse
  coordinate, dalla rianalisi ERA5 (`era5_seamless`: pioggia da ERA5, suolo
  dalla griglia ERA5-Land a 9 km).

Il grezzo resta separato per sorgente e ricostruibile; il merge per priorita'
(osservato batte modellato) avviene a valle, quando si calcolano le feature.

### Quanto passato serve

Il modello guarda indietro **~120 giorni**: 60 di spin-up del bilancio idrico
piu' la finestra mobile piu' lunga. Storici pluriennali non aggiungono nulla.

Le due sorgenti hanno pero' costi molto diversi, e i default lo rispecchiano:

|                       | Finestra di default | Perche'                                                                                                                                                                   |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arpae (aria, pioggia) | **12 mesi**         | Nessun limite: un file gzip al mese, ~4 minuti in tutto                                                                                                                   |
| Open-Meteo (suolo)    | **120 giorni**      | Pesa `coordinate x giorni/14`: 570 stazioni per 120 giorni valgono ~4.900 chiamate contro le 5.000 orarie del tier gratuito. Un anno ne varrebbe ~14.900 e viene respinto |

Il filtro `--min-altitude` / `--max-altitude` e' la leva piu' efficace per
rientrare nei limiti: la temperatura del suolo di una stazione di pianura a 5 m
non serve a nessun fungo di bosco, e restringere alla fascia 300-1500 m porta
le stazioni da ~600 a ~190. Non ha un default, perche' la fascia utile dipende
dalla specie.

Se un rate limit interrompe l'ingestione, il run finisce in stato `PARTIAL`:
i dati scaricati sono gia' persistiti e rilanciare riprende da li'.

**Nota sul bilancio idrico:** gira su pioggia Arpae ed ETo calcolata dalle sole
Tmin/Tmax Arpae (Hargreaves). Non dipende da Open-Meteo, che serve solo alla
regola sulla temperatura del suolo.

Due convenzioni che valgono ovunque:

- **Giorno locale `Europe/Rome`.** Gli aggregati giornalieri che Arpae pubblica
  seguono due convenzioni diverse (00:00Z e 08:00Z) con valori diversi, e uno
  timbrato `T` copre le 24 h che _finiscono_ in `T`. Aggregando noi i
  sotto-orari otteniamo un'unica convenzione, la stessa che chiediamo a
  Open-Meteo.
- **Solo giorni completi.** Il giorno in corso non e' un'osservazione: un
  modello meteo lo chiuderebbe con le ore non ancora avvenute.

## Prossimi passi

1. ~~Scaffolding monorepo~~ ✅
2. ~~Schema di dominio + adapter Arpae e Open-Meteo + ingestione~~ ✅
3. ~~Feature store + motore di scoring + profilo `boletus-edulis` + backtest~~ ✅
4. ~~Layer GraphQL + frontend: tabella e mappa~~ ✅ (manca il cron di ingestione)
5. ~~Celle di bosco: griglia esagonale su carta forestale + mappa~~ ✅
6. Dettaglio stazione, andamento degli ultimi 60 giorni, segnalazioni sul campo

## Le celle di bosco

Le stazioni stanno dove qualcuno ha messo un termometro, di solito a fondovalle:
delle 188 della fascia, solo 31 superano i 900 m. I porcini stanno nel bosco, in
quota. `PredictionSite` separa le due cose.

Una cella e' un esagono di ~3 km con la sua specie dominante e la sua quota,
costruito in tre passaggi scelti per il costo:

1. **Esagoni** da `ST_HexagonGrid` in PostGIS.
2. **Quota** dall'API elevation di Open-Meteo, che scarta subito pianura e
   crinale nudo.
3. **Specie dominante** dalla carta di Uso del Suolo 2023 RER via WMS
   `GetFeatureInfo`, una interrogazione puntuale per cella. Scaricare i
   poligoni era impraticabile: un riquadro da 0,2 gradi pesa 55 MB e novanta
   secondi.

Ogni cella ha una `Station` gemella con `source = OPEN_METEO`: cosi' riusa senza
modifiche ingestione, feature store e motore di scoring. Nel nostro schema una
"stazione" e' gia' un punto di misura, non un impianto fisico.

## Fonti dati

| Fonte                           | Copertura                                                                     | Accesso                                               |
| ------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Arpae SIMC** (Emilia-Romagna) | ~210 stazioni con T+P, storico dal 2006                                       | JSONL aperto, nessuna chiave                          |
| **AMAP Marche**                 | 88 stazioni, sensori di T del suolo a 5/10/20/30/50 cm                        | API REST aperta per l'anagrafica; misure su richiesta |
| **SIR Toscana**                 | ~800 stazioni                                                                 | Solo scraping, sessione protetta                      |
| **Open-Meteo**                  | Tutto il territorio: T e umidità del suolo, storico dal 1950, forecast +16 gg | API aperta (tier gratuito **non commerciale**)        |
