import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { CliModule } from '../cli.module';
import { ForestGridService } from '../ingestion/forest-grid.service';
import { ForestMapService } from '../ingestion/forest-map.service';
import { GeocodingService } from '../ingestion/geocoding.service';
import { IngestionService } from '../ingestion/ingestion.service';
import type { WeatherSourceCode } from '../generated/prisma/enums.ts';
import { PrismaService } from '../prisma/prisma.service';
import { MycologyService } from '../mycology/mycology.service';
import { SpeciesModelService } from '../mycology/species-model.service';

/**
 * Entry point dei comandi one-shot.
 *
 * Usa lo stesso container di dipendenze del server: un comando lanciato a mano
 * e lo stesso comando lanciato dal cron eseguono esattamente lo stesso codice,
 * che e' il motivo per cui il cron non ha una sua implementazione parallela.
 *
 *   pnpm --filter @mushrooms/api cli <comando> [opzioni]
 */
type Command = (app: INestApplicationContext, args: Args) => Promise<void>;

const logger = new Logger('CLI');

// --------------------------------------------------------------------------
// Parsing argomenti
// --------------------------------------------------------------------------

interface Args {
  flags: Map<string, string>;
  has(name: string): boolean;
  str(name: string, fallback?: string): string;
  int(name: string, fallback: number): number;
  date(name: string, fallback: Date): Date;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq === -1) flags.set(token.slice(2), 'true');
    else flags.set(token.slice(2, eq), token.slice(eq + 1));
  }

  return {
    flags,
    has: (name) => flags.has(name),
    str(name, fallback) {
      const v = flags.get(name) ?? fallback;
      if (v === undefined) throw new Error(`Opzione obbligatoria mancante: --${name}`);
      return v;
    },
    int(name, fallback) {
      const raw = flags.get(name);
      if (raw === undefined) return fallback;
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n)) throw new Error(`--${name} deve essere un intero, ricevuto "${raw}"`);
      return n;
    },
    date(name, fallback) {
      const raw = flags.get(name);
      if (raw === undefined) return fallback;
      const d = new Date(`${raw}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`--${name} deve essere una data YYYY-MM-DD, ricevuto "${raw}"`);
      }
      return d;
    },
  };
}

function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Ultimo giorno completo, cioe' ieri.
 *
 * Il giorno in corso e' per definizione parziale: Arpae lo scarta per
 * copertura insufficiente e Open-Meteo lo completerebbe con la previsione
 * delle ore restanti, che e' esattamente cio' che non vogliamo.
 */
function lastCompleteDay(): Date {
  return addDays(today(), -1);
}

/**
 * Quanto passato serve davvero.
 *
 * Il modello guarda indietro al massimo ~120 giorni: 60 di spin-up del
 * bilancio idrico piu' la finestra mobile piu' lunga (p60). Un anno e' gia'
 * tre volte tanto, e in piu' copre una stagione intera per i confronti.
 * Storici pluriennali non aggiungono nulla e costano un file da ~22 MB al mese.
 */
const DEFAULT_BACKFILL_MONTHS = 12;

/** Finestra da tenere a database: l'anno utile piu' il margine di spin-up. */
const DEFAULT_RETENTION_DAYS = 400;

/**
 * Quanto suolo scaricare da Open-Meteo in un backfill.
 *
 * Due vincoli che convergono sullo stesso numero:
 *  - il modello guarda indietro ~120 giorni (60 di spin-up + finestra p60);
 *  - Open-Meteo pesa le chiamate come coordinate x giorni/14, quindi 570
 *    stazioni per 120 giorni valgono ~4.900 chiamate contro le 5.000 orarie
 *    del tier gratuito. Un anno intero ne varrebbe ~14.900 e verrebbe respinto.
 *
 * Arpae invece non ha limiti: l'aria e la pioggia si caricano per l'anno pieno.
 */
const DEFAULT_SOIL_DAYS = 120;

/** Specie di default dei comandi micologici. */
const DEFAULT_SPECIES = 'boletus-edulis';

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Filtro di quota comune ai comandi di ingestione. */
function altitudeFilter(args: Args): { minAltitudeM?: number; maxAltitudeM?: number } {
  return {
    ...(args.has('min-altitude') ? { minAltitudeM: args.int('min-altitude', 0) } : {}),
    ...(args.has('max-altitude') ? { maxAltitudeM: args.int('max-altitude', 0) } : {}),
  };
}

function parseSource(raw: string): WeatherSourceCode {
  const known: WeatherSourceCode[] = ['ARPAE_ER', 'OPEN_METEO', 'MARCHE_AMAP', 'SIR_TOSCANA'];
  const normalised = raw.toUpperCase().replace(/-/g, '_') as WeatherSourceCode;
  if (!known.includes(normalised)) {
    throw new Error(`Sorgente sconosciuta "${raw}". Disponibili: ${known.join(', ')}`);
  }
  return normalised;
}

// --------------------------------------------------------------------------
// Comandi
// --------------------------------------------------------------------------

const COMMANDS: Record<string, { describe: string; usage?: string; run: Command }> = {
  'health:check': {
    describe: 'Verifica configurazione e connessione al database.',
    run: async (app) => {
      const prisma = app.get(PrismaService);
      await prisma.ping();
      const stations = await prisma.station.count();
      const observations = await prisma.dailyObservation.count();
      logger.log(`Database OK — ${stations} stazioni, ${observations} osservazioni giornaliere.`);
    },
  },

  'sources:list': {
    describe: 'Elenca le sorgenti meteo registrate.',
    run: async (app) => {
      for (const s of app.get(IngestionService).listSources()) {
        logger.log(
          `${s.code.padEnd(14)} priorita=${String(s.priority).padStart(3)}  anagrafica=${s.scope}`,
        );
      }
    },
  },

  'ingest:stations': {
    describe: "Allinea l'anagrafica delle stazioni di una sorgente.",
    usage: '--source=ARPAE_ER',
    run: async (app, args) => {
      const source = parseSource(args.str('source', 'ARPAE_ER'));
      const count = await app.get(IngestionService).syncStations(source);
      logger.log(`${source}: ${count} stazioni allineate.`);
    },
  },

  'ingest:weather': {
    describe: 'Scarica le osservazioni giornaliere di una sorgente.',
    usage:
      '--source=… [--from=…] [--to=…] [--days=N] [--min-altitude=N] [--max-altitude=N] ' +
      '[--only-missing] [--prefer-recent]',
    run: async (app, args) => {
      const source = parseSource(args.str('source', 'ARPAE_ER'));
      // Default: la finestra scorrevole che serve al cron giornaliero. Sette
      // giorni e non uno solo, cosi' raccogliamo anche le correzioni che Arpae
      // applica ai giorni gia' pubblicati.
      const days = args.int('days', 7);
      const to = args.date('to', lastCompleteDay());
      const from = args.date('from', addDays(to, -(days - 1)));

      logger.log(`${source}: ingestione ${isoDay(from)} -> ${isoDay(to)}`);
      const result = await app
        .get(IngestionService)
        .ingest(
          source,
          { from, to },
          { ...altitudeFilter(args), ...(args.has('only-missing') ? { onlyMissing: true } : {}) },
          { preferRecent: args.has('prefer-recent') },
        );
      logger.log(
        `${source}: ${result.observationsWritten} osservazioni, ${result.stationsUpserted} stazioni, ` +
          `in ${(result.durationMs / 1000).toFixed(1)}s`,
      );
      if (result.incompleteReason) {
        logger.warn(
          `Coperto solo in parte: ${result.incompleteReason}. ` +
            `I dati scaricati sono a database, rilancia per completare.`,
        );
      }
    },
  },

  'ingest:daily': {
    describe: 'Ciclo giornaliero: Arpae (aria e pioggia) + Open-Meteo (suolo).',
    usage: '[--days=N]',
    run: async (app, args) => {
      const ingestion = app.get(IngestionService);
      // Sette giorni e non uno: raccogliamo anche le correzioni che Arpae
      // applica ai giorni gia' pubblicati.
      const days = args.int('days', 7);
      const to = lastCompleteDay();
      const from = addDays(to, -(days - 1));

      logger.log(`Finestra: ${isoDay(from)} -> ${isoDay(to)} (ultimo giorno completo)`);

      const arpae = await ingestion.ingest('ARPAE_ER', { from, to });
      logger.log(
        `Arpae:      ${arpae.observationsWritten} osservazioni in ${(arpae.durationMs / 1000).toFixed(1)}s`,
      );

      // Stessa finestra: Open-Meteo aggiunge solo le variabili del suolo, che
      // nessuna rete Arpae misura. Nessun giorno futuro.
      const om = await ingestion.ingest('OPEN_METEO', { from, to });
      logger.log(
        `Open-Meteo: ${om.observationsWritten} osservazioni in ${(om.durationMs / 1000).toFixed(1)}s`,
      );
    },
  },

  'ingest:backfill': {
    describe: `Carica il passato recente (default ${DEFAULT_BACKFILL_MONTHS} mesi). Arpae + suolo Open-Meteo.`,
    usage: `[--months=N] [--soil-days=N] [--min-altitude=N] [--max-altitude=N] [--skip-soil]`,
    run: async (app, args) => {
      const ingestion = app.get(IngestionService);
      const to = args.date('to', lastCompleteDay());
      const months = args.int('months', DEFAULT_BACKFILL_MONTHS);
      const from = args.date('from', addMonths(to, -months));

      const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
      if (spanDays > DEFAULT_RETENTION_DAYS) {
        logger.warn(
          `Richiesti ${spanDays} giorni: il modello ne usa al massimo ~120 e la ` +
            `retention di default ne tiene ${DEFAULT_RETENTION_DAYS}. Il grosso di questo ` +
            `scaricamento verrebbe poi potato da data:prune.`,
        );
      }

      logger.log(`Backfill ${isoDay(from)} -> ${isoDay(to)} (un file al mese lato Arpae)`);

      const arpae = await ingestion.ingest('ARPAE_ER', { from, to });
      logger.log(
        `Arpae:      ${arpae.observationsWritten} osservazioni in ${(arpae.durationMs / 1000).toFixed(1)}s`,
      );

      // Il suolo non e' un extra: e' la variabile centrale del modello e Arpae
      // non la misura. Si salta solo se si vuole ricaricare la sola aria.
      if (args.has('skip-soil')) {
        logger.warn('--skip-soil: nessuna temperatura del suolo caricata.');
        return;
      }

      // Finestra piu' corta di quella dell'aria: e' tutto cio' che il modello
      // usa, ed e' quanto il tier gratuito di Open-Meteo concede in un'ora.
      const soilFrom = addDays(to, -args.int('soil-days', DEFAULT_SOIL_DAYS));
      logger.log(`Suolo (Open-Meteo): ${isoDay(soilFrom)} -> ${isoDay(to)}`);

      const om = await ingestion.ingest('OPEN_METEO', { from: soilFrom, to }, altitudeFilter(args));
      logger.log(
        `Open-Meteo: ${om.observationsWritten} osservazioni in ${(om.durationMs / 1000).toFixed(1)}s`,
      );
      if (om.incompleteReason) {
        logger.warn(
          `Coperto solo in parte. I dati scaricati sono a database: rilancia fra un'ora per completare.`,
        );
      }
    },
  },

  'data:prune': {
    describe: `Elimina le osservazioni piu' vecchie della finestra utile (default ${DEFAULT_RETENTION_DAYS} giorni).`,
    usage: '[--keep-days=N] [--apply]',
    run: async (app, args) => {
      const prisma = app.get(PrismaService);
      const keepDays = args.int('keep-days', DEFAULT_RETENTION_DAYS);
      const cutoff = addDays(today(), -keepDays);

      const doomed = await prisma.dailyObservation.count({ where: { date: { lt: cutoff } } });

      if (!args.has('apply')) {
        // Cancellare e' irreversibile: di default si limita a dire cosa farebbe.
        logger.log(
          `${doomed} osservazioni antecedenti al ${isoDay(cutoff)} verrebbero eliminate. ` +
            `Rilancia con --apply per procedere.`,
        );
        return;
      }

      const { count } = await prisma.dailyObservation.deleteMany({
        where: { date: { lt: cutoff } },
      });
      logger.log(`${count} osservazioni eliminate (antecedenti al ${isoDay(cutoff)}).`);
    },
  },

  // -------------------------------------------------------------------------
  // Modello
  // -------------------------------------------------------------------------

  'model:list': {
    describe: 'Elenca i profili di specie registrati.',
    run: async (app) => {
      const rows = await app.get(SpeciesModelService).list();
      if (rows.length === 0) {
        logger.log('Nessun profilo registrato. Ne verra creato uno al primo predict:run.');
        return;
      }
      for (const r of rows) {
        logger.log(
          `${r.active ? '*' : ' '} ${r.species.padEnd(18)} v${String(r.version).padStart(3)}  ${r.source ?? ''}`,
        );
      }
    },
  },

  'model:export': {
    describe: 'Scrive il profilo attivo in YAML, pronto da editare.',
    usage: '[--species=boletus-edulis] [--file=profilo.yaml]',
    run: async (app, args) => {
      const species = args.str('species', DEFAULT_SPECIES);
      const file = args.str('file', `${species}.yaml`);
      await app.get(SpeciesModelService).exportToYaml(species, file);
      logger.log(`Modifica i numeri e ricarica con: cli model:load --file=${file}`);
    },
  },

  'model:load': {
    describe: 'Valida e attiva un profilo YAML come nuova versione.',
    usage: '--file=profilo.yaml',
    run: async (app, args) => {
      const file = args.str('file');
      const profile = await app.get(SpeciesModelService).loadFromYaml(file);
      logger.log(
        `${profile.species} v${profile.version} attivo. ` +
          `Ricalcola i punteggi con: cli predict:run`,
      );
    },
  },

  // -------------------------------------------------------------------------
  // Previsione
  // -------------------------------------------------------------------------

  'predict:run': {
    describe: 'Calcola feature e punteggi di buttata e li salva.',
    usage: '[--species=…] [--days=N] [--from=…] [--to=…] [--min-altitude=N] [--max-altitude=N]',
    run: async (app, args) => {
      const species = args.str('species', DEFAULT_SPECIES);
      const to = args.date('to', lastCompleteDay());
      const from = args.date('from', addDays(to, -(args.int('days', 30) - 1)));

      const result = await app
        .get(MycologyService)
        .computeAll(species, { from, to }, altitudeFilter(args));

      logger.log(
        `${result.stationsProcessed} stazioni, ${result.featuresWritten} feature, ` +
          `${result.predictionsWritten} punteggi in ${(result.durationMs / 1000).toFixed(1)}s`,
      );
    },
  },

  'predict:today': {
    describe: "Le stazioni con le condizioni migliori nell'ultimo giorno calcolato.",
    usage: '[--species=…] [--limit=N] [--min-score=N]',
    run: async (app, args) => {
      const prisma = app.get(PrismaService);
      const species = args.str('species', DEFAULT_SPECIES);
      const limit = args.int('limit', 15);
      const minScore = args.int('min-score', 0);

      const model = await prisma.speciesModel.findFirst({
        where: { species, active: true },
        select: { id: true, version: true },
      });
      if (!model) {
        logger.warn(`Nessun profilo attivo per ${species}: esegui prima predict:run.`);
        return;
      }

      const latest = await prisma.fruitingPrediction.aggregate({
        where: { modelId: model.id },
        _max: { date: true },
      });
      const date = latest._max.date;
      if (!date) {
        logger.warn('Nessun punteggio calcolato: esegui prima predict:run.');
        return;
      }

      const rows = await prisma.fruitingPrediction.findMany({
        where: { modelId: model.id, date, score: { gte: minScore } },
        orderBy: { score: 'desc' },
        take: limit,
        select: {
          score: true,
          class: true,
          daysSinceWetEvent: true,
          station: { select: { name: true, altitudeM: true, province: true } },
        },
      });

      logger.log(`${species} v${model.version} — ${isoDay(date)}`);
      if (rows.length === 0) {
        logger.log('Nessuna stazione sopra la soglia: in questo momento non ci sono condizioni.');
        return;
      }
      logger.log('  score  classe        quota   giorni dalla pioggia   stazione');
      for (const r of rows) {
        const quota =
          r.station.altitudeM === null
            ? '     '
            : `${Math.round(r.station.altitudeM)}m`.padStart(5);
        const since =
          r.daysSinceWetEvent === null ? '  -' : String(r.daysSinceWetEvent).padStart(3);
        logger.log(
          `  ${r.score.toFixed(1).padStart(5)}  ${r.class.padEnd(12)}  ${quota}   ${since}                   ${r.station.name}`,
        );
      }
    },
  },

  'predict:backtest': {
    describe: 'Andamento giorno per giorno di una stazione, senza salvare nulla.',
    usage: '--station="Nome" [--species=…] [--from=…] [--to=…] [--all-days]',
    run: async (app, args) => {
      const prisma = app.get(PrismaService);
      const name = args.str('station');
      const species = args.str('species', DEFAULT_SPECIES);
      const to = args.date('to', lastCompleteDay());
      const from = args.date('from', addDays(to, -89));

      const station = await prisma.station.findFirst({
        where: { name: { contains: name, mode: 'insensitive' } },
        select: { id: true, name: true, altitudeM: true },
      });
      if (!station) {
        logger.error(`Nessuna stazione trovata per "${name}".`);
        process.exitCode = 1;
        return;
      }

      const { scores } = await app
        .get(MycologyService)
        .scoreStation(station.id, species, { from, to });

      const shown = args.has('all-days') ? scores : scores.filter((s) => s.score > 0);

      logger.log(`${station.name} (${station.altitudeM ?? '?'} m) — ${species}`);
      logger.log('  data         score  classe        innesco  giorni  inibitori');
      for (const s of shown) {
        logger.log(
          `  ${isoDay(s.date)}  ${s.score.toFixed(1).padStart(5)}  ${s.class.padEnd(12)}  ` +
            `${s.triggerScore.toFixed(2).padStart(7)}  ${String(s.daysSinceWetEvent ?? '-').padStart(6)}  ` +
            `${s.activeInhibitors.join(',')}`,
        );
      }
      if (shown.length === 0) {
        logger.log('  Nessun giorno con punteggio maggiore di zero nel periodo.');
      }
    },
  },

  'stations:geocode': {
    describe: 'Assegna provincia e regione alle stazioni dalle coordinate.',
    usage: '[--skip-download]',
    run: async (app, args) => {
      const geocoding = app.get(GeocodingService);

      if (!args.has('skip-download')) {
        logger.log('Scarico i confini provinciali (ISTAT via openpolis)...');
        await geocoding.importBoundaries();
      }

      const result = await geocoding.assignProvinces();
      logger.log(
        `${result.contained} stazioni dentro un confine, ${result.nearest} attribuite ` +
          `alla provincia piu' vicina entro 5 km, ${result.unresolved} irrisolte.`,
      );
    },
  },

  'forest:import': {
    describe: 'Carica una cartografia forestale regionale.',
    usage: '[--source=er|ift] [--dir=~/Downloads] [--zip=…/ift.zip]',
    run: async (app, args) => {
      const service = app.get(ForestMapService);
      const source = args.str('source', 'er').toLowerCase();

      if (source === 'ift' || source === 'toscana') {
        const zip = args.str('zip', `${process.env['HOME'] ?? '.'}/Downloads/ift.zip`);
        logger.log(`Inventario Forestale Toscano da ${zip}`);
        const result = await service.importToscana(zip);
        logger.log(`${result.polygons} pixel forestali toscani caricati.`);
        return;
      }

      if (source !== 'er' && source !== 'emilia') {
        throw new Error(`--source sconosciuta "${source}". Disponibili: er, ift`);
      }

      const dir = args.str('dir', `${process.env['HOME'] ?? '.'}/Downloads`);
      logger.log(`Cerco CartaForestale2025XX.zip in ${dir}`);
      const result = await service.importEmiliaRomagna(dir);
      logger.log(`${result.files} province, ${result.polygons} poligoni forestali caricati.`);
    },
  },

  'sites:generate': {
    describe: 'Genera le celle di bosco su cui calcolare la previsione.',
    usage:
      '[--bbox=sud,ovest,nord,est] [--cell-km=3] [--min-altitude=400] [--max-altitude=1700] [--limit=N]',
    run: async (app, args) => {
      // Default: la fascia appenninica emiliano-romagnola.
      const raw = args.str('bbox', '43.75,9.50,44.55,12.40').split(',').map(Number);
      if (raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) {
        throw new Error('--bbox va scritto come sud,ovest,nord,est');
      }
      const bbox: [number, number, number, number] = [raw[0]!, raw[1]!, raw[2]!, raw[3]!];

      const result = await app.get(ForestGridService).generate({
        bbox,
        cellKm: args.int('cell-km', 3),
        minAltitudeM: args.int('min-altitude', 400),
        maxAltitudeM: args.int('max-altitude', 1700),
        ...(args.has('limit') ? { limit: args.int('limit', 0) } : {}),
      });

      logger.log(
        `${result.candidates} celle candidate -> ${result.forest} boscate -> ` +
          `${result.inAltitude} in quota -> ${result.written} salvate.`,
      );
      logger.log('Ora scarica il meteo delle celle: cli ingest:weather --source=OPEN_METEO');
    },
  },

  'data:summary': {
    describe: 'Riepilogo di cosa contiene il database.',
    run: async (app) => {
      const prisma = app.get(PrismaService);

      const bySource = await prisma.dailyObservation.groupBy({
        by: ['source'],
        _count: { _all: true },
        _min: { date: true },
        _max: { date: true },
      });

      const stations = await prisma.station.groupBy({
        by: ['source'],
        _count: { _all: true },
      });

      logger.log('Stazioni:');
      for (const s of stations) logger.log(`  ${s.source.padEnd(14)} ${s._count._all}`);

      logger.log('Osservazioni giornaliere:');
      for (const o of bySource) {
        const min = o._min.date ? isoDay(o._min.date) : '-';
        const max = o._max.date ? isoDay(o._max.date) : '-';
        logger.log(
          `  ${o.source.padEnd(14)} ${String(o._count._all).padStart(8)}  ${min} -> ${max}`,
        );
      }

      const withSoil = await prisma.dailyObservation.count({
        where: { soilT0To7C: { not: null } },
      });
      const future = await prisma.dailyObservation.count({ where: { date: { gt: today() } } });
      logger.log(`  con temperatura del suolo: ${withSoil}`);
      logger.log(`  datate nel futuro:         ${future}  (deve essere 0)`);
    },
  },
};

// --------------------------------------------------------------------------

function printHelp(): void {
  const lines = Object.entries(COMMANDS).map(([key, { describe, usage }]) => {
    const head = `  ${key.padEnd(18)} ${describe}`;
    return usage ? `${head}\n  ${' '.repeat(18)} ${usage}` : head;
  });
  process.stdout.write(`Comandi disponibili:\n${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);

  if (!name || name === 'help' || name === '--help') {
    printHelp();
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    logger.error(`Comando sconosciuto: ${name}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(CliModule, { bufferLogs: false });
  try {
    await command.run(app, parseArgs(rest));
  } catch (error) {
    logger.error(`Comando "${name}" fallito`, error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
