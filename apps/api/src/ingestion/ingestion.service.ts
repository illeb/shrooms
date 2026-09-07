import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { WeatherSourceCode } from '../generated/prisma/enums.ts';
import { ArpaeAdapter } from './adapters/arpae/arpae.adapter';
import { OpenMeteoAdapter } from './adapters/open-meteo/open-meteo.adapter';
import type {
  DailyObservationUpsert,
  DateRange,
  FetchBatch,
  FetchOptions,
  StationUpsert,
  WeatherSourceAdapter,
} from './adapters/weather-source.adapter';

/**
 * Restringe quali stazioni interrogare.
 *
 * Serve alle sorgenti a griglia: Open-Meteo pesa le chiamate come
 * `coordinate x giorni/14`, e scaricare la temperatura del suolo per una
 * stazione in pianura a 5 m non serve a nessun fungo di bosco. Filtrare per
 * quota e' il modo piu' diretto per far entrare un anno intero nel tier
 * gratuito. Non ha un default: la fascia utile dipende dalla specie.
 */
export interface StationFilter {
  minAltitudeM?: number;
  maxAltitudeM?: number;
  /**
   * Salta le stazioni che hanno gia' tutti i giorni dell'intervallo per
   * questa sorgente.
   *
   * Serve a riprendere un'ingestione fermata da un rate limit. Senza, la
   * ripartenza rifa' da capo anche i blocchi gia' scaricati: su Open-Meteo,
   * che pesa le chiamate come coordinate x giorni/14, riprendere costava
   * quanto la prima volta e con una quota giornaliera finita si finiva a non
   * chiudere mai. Con questo, ogni giro costa solo cio' che manca davvero.
   */
  onlyMissing?: boolean;
}

export interface IngestionResult {
  source: WeatherSourceCode;
  stationsUpserted: number;
  observationsWritten: number;
  durationMs: number;
  /** Valorizzato se la sorgente si e' fermata prima della fine dell'intervallo. */
  incompleteReason?: string;
}

/**
 * Quante osservazioni per INSERT multi-riga.
 *
 * Postgres accetta al massimo 65535 parametri per statement e ogni riga ne usa
 * 12: 500 righe stanno larghe e tengono le transazioni corte.
 */
const INSERT_BATCH = 500;

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly adapters: WeatherSourceAdapter[];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ArpaeAdapter) arpae: ArpaeAdapter,
    @Inject(OpenMeteoAdapter) openMeteo: OpenMeteoAdapter,
  ) {
    this.adapters = [arpae, openMeteo];
  }

  listSources(): Array<{ code: WeatherSourceCode; priority: number; scope: string }> {
    return this.adapters.map((a) => ({
      code: a.code,
      priority: a.priority,
      scope: a.stationScope,
    }));
  }

  private adapterFor(code: WeatherSourceCode): WeatherSourceAdapter {
    const adapter = this.adapters.find((a) => a.code === code);
    if (!adapter) {
      const known = this.adapters.map((a) => a.code).join(', ');
      throw new Error(`Nessun adapter per la sorgente "${code}". Disponibili: ${known}`);
    }
    return adapter;
  }

  /** Allinea l'anagrafica delle stazioni di una sorgente. */
  async syncStations(code: WeatherSourceCode): Promise<number> {
    const adapter = this.adapterFor(code);
    const stations = await adapter.syncStations();
    return this.upsertStations(stations);
  }

  /**
   * Ingestione di un intervallo per una sorgente.
   *
   * Idempotente: la chiave unica (stazione, giorno, sorgente) piu' l'ON
   * CONFLICT DO UPDATE fanno si' che rilanciare lo stesso giorno non duplichi
   * nulla e riscriva i valori che Arpae ha nel frattempo validato. Rileggere
   * sempre l'intero file del mese corrente non e' uno spreco: e' il modo in
   * cui recuperiamo le correzioni.
   */
  async ingest(
    code: WeatherSourceCode,
    range: DateRange,
    filter: StationFilter = {},
    options: FetchOptions = {},
  ): Promise<IngestionResult> {
    const adapter = this.adapterFor(code);
    const startedAt = Date.now();

    // Un run lasciato in RUNNING e' un processo morto senza chiudere la riga
    // (crash, kill, container riavviato). Chiuderlo qui evita che resti li' a
    // suggerire che un'ingestione sia ancora in corso.
    const stale = await this.prisma.ingestionRun.updateMany({
      where: { source: code, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        errorMessage: 'Interrotto senza chiudere il run (processo terminato).',
        finishedAt: new Date(),
      },
    });
    if (stale.count > 0) {
      this.logger.warn(`${stale.count} run precedenti di ${code} erano rimasti appesi: chiusi.`);
    }

    const run = await this.prisma.ingestionRun.create({
      data: { source: code, rangeFrom: range.from, rangeTo: range.to, status: 'RUNNING' },
    });

    try {
      // Le sorgenti a griglia hanno bisogno delle coordinate da interrogare:
      // sono quelle delle stazioni osservate gia' presenti a database.
      const providedStations =
        adapter.stationScope === 'provided'
          ? await this.observedStations(filter, code, range)
          : [];

      if (adapter.stationScope === 'provided' && providedStations.length === 0) {
        throw new Error(
          `${code} e' una sorgente a griglia ma non ci sono stazioni osservate a database: ` +
            `esegui prima l'ingestione di una sorgente a stazioni.`,
        );
      }

      // Per una sorgente a griglia gli externalId possono appartenere a piu'
      // anagrafiche (stazioni Arpae e celle di bosco): si risolvono su tutte.
      const scope: WeatherSourceCode | undefined =
        adapter.stationScope === 'own' ? code : undefined;
      const idByExternalId = await this.stationIdMap(scope);

      let stationsUpserted = 0;
      let orphans = 0;

      // Il sink viene invocato dall'adapter man mano che i dati arrivano: un
      // mese per Arpae, una fetta per Open-Meteo. Ogni blocco e' persistito
      // subito, cosi' un'interruzione a meta' non annulla il lavoro fatto.
      const sink = async (batch: FetchBatch): Promise<number> => {
        if (batch.stations.length > 0) {
          stationsUpserted += await this.upsertStations(batch.stations);
          // Le stazioni appena viste vanno risolvibili dalle osservazioni
          // dello stesso blocco.
          for (const [externalId, id] of await this.stationIdMap(scope)) {
            idByExternalId.set(externalId, id);
          }
        }

        const result = await this.writeObservations(code, batch.observations, idByExternalId);
        orphans += result.orphans;
        return result.written;
      };

      const summary = await adapter.fetchDaily(range, providedStations, sink, options);

      if (orphans > 0) {
        this.logger.warn(`${orphans} osservazioni scartate: stazione non trovata in anagrafica`);
      }

      await this.refreshStationCoverage();

      const durationMs = Date.now() - startedAt;
      if (summary.incompleteReason) {
        this.logger.warn(`${code}: intervallo coperto solo in parte — ${summary.incompleteReason}`);
      }

      await this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          // PARTIAL e non FAILED: i dati scaricati sono validi e persistiti,
          // manca solo la coda dell'intervallo. Rilanciare riprende da li'.
          status: summary.incompleteReason ? 'PARTIAL' : 'SUCCESS',
          rowsRead: summary.observationsWritten,
          rowsWritten: summary.observationsWritten,
          errorMessage: summary.incompleteReason?.slice(0, 2000) ?? null,
          finishedAt: new Date(),
          durationMs,
        },
      });

      return {
        source: code,
        stationsUpserted,
        observationsWritten: summary.observationsWritten,
        durationMs,
        ...(summary.incompleteReason === undefined
          ? {}
          : { incompleteReason: summary.incompleteReason }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          errorMessage: message.slice(0, 2000),
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      });
      throw error;
    }
  }

  /**
   * Coordinate da interrogare per una sorgente a griglia.
   *
   * Include le stazioni osservate **e** le celle di bosco: una cella e' una
   * stazione sintetica con `source = OPEN_METEO`, e ha bisogno degli stessi
   * dati. Senza, le celle resterebbero senza meteo.
   */
  private async observedStations(
    filter: StationFilter,
    source: WeatherSourceCode,
    range: DateRange,
  ): Promise<StationUpsert[]> {
    const altitude =
      filter.minAltitudeM === undefined && filter.maxAltitudeM === undefined
        ? {}
        : {
            altitudeM: {
              ...(filter.minAltitudeM === undefined ? {} : { gte: filter.minAltitudeM }),
              ...(filter.maxAltitudeM === undefined ? {} : { lte: filter.maxAltitudeM }),
            },
          };

    const covered = filter.onlyMissing ? await this.fullyCovered(source, range) : [];

    const rows = await this.prisma.station.findMany({
      where: {
        active: true,
        ...altitude,
        ...(covered.length > 0 ? { id: { notIn: covered } } : {}),
      },
      select: {
        source: true,
        externalId: true,
        name: true,
        network: true,
        latitude: true,
        longitude: true,
        altitudeM: true,
        region: true,
        province: true,
      },
      orderBy: { externalId: 'asc' },
    });

    if (filter.minAltitudeM !== undefined || filter.maxAltitudeM !== undefined) {
      this.logger.log(
        `Filtro di quota [${filter.minAltitudeM ?? '-'}, ${filter.maxAltitudeM ?? '-'}] m: ${rows.length} stazioni`,
      );
    }
    if (filter.onlyMissing) {
      this.logger.log(`Solo mancanti: ${covered.length} stazioni gia' complete, salto`);
    }

    return rows.map((r) => ({ ...r, active: true }));
  }

  /**
   * Stazioni che hanno gia' ogni giorno dell'intervallo per questa sorgente.
   *
   * "Ogni giorno" e non "abbastanza giorni": Open-Meteo e' una griglia, non
   * ha buchi, quindi una stazione con un giorno in meno ne ha davvero uno in
   * meno. Su una sorgente osservata come Arpae, dove i buchi sono la norma,
   * il confronto non si soddisfa quasi mai e il filtro non fa nulla - che e'
   * il comportamento giusto, perche' Arpae non ha quota da risparmiare.
   */
  private async fullyCovered(source: WeatherSourceCode, range: DateRange): Promise<string[]> {
    const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;

    const rows = await this.prisma.dailyObservation.groupBy({
      by: ['stationId'],
      where: { source, date: { gte: range.from, lte: range.to } },
      _count: { date: true },
      having: { date: { _count: { gte: days } } },
    });

    return rows.map((r) => r.stationId);
  }

  private async upsertStations(stations: StationUpsert[]): Promise<number> {
    let count = 0;
    for (const s of stations) {
      const data = {
        name: s.name,
        network: s.network ?? null,
        latitude: s.latitude,
        longitude: s.longitude,
        altitudeM: s.altitudeM ?? null,
        region: s.region ?? null,
        province: s.province ?? null,
        active: s.active ?? true,
      };
      await this.prisma.station.upsert({
        where: { source_externalId: { source: s.source, externalId: s.externalId } },
        create: { source: s.source, externalId: s.externalId, ...data },
        update: data,
      });
      count += 1;
    }
    return count;
  }

  private async stationIdMap(source?: WeatherSourceCode): Promise<Map<string, string>> {
    const rows = await this.prisma.station.findMany({
      where: source === undefined ? {} : { source },
      select: { id: true, externalId: true },
    });
    return new Map(rows.map((r) => [r.externalId, r.id]));
  }

  /**
   * INSERT multi-riga con ON CONFLICT DO UPDATE.
   *
   * Un `upsert` di Prisma per riga significherebbe una query per giorno-stazione:
   * su un backfill sono centinaia di migliaia di round-trip.
   */
  private async writeObservations(
    source: WeatherSourceCode,
    observations: DailyObservationUpsert[],
    idByExternalId: Map<string, string>,
  ): Promise<{ written: number; orphans: number }> {
    let written = 0;
    let orphans = 0;

    const resolved: Array<[string, DailyObservationUpsert]> = [];
    for (const o of observations) {
      const stationId = idByExternalId.get(o.externalId);
      if (!stationId) {
        orphans += 1;
        continue;
      }
      resolved.push([stationId, o]);
    }

    for (let i = 0; i < resolved.length; i += INSERT_BATCH) {
      const batch = resolved.slice(i, i + INSERT_BATCH);
      const values: unknown[] = [];
      const tuples: string[] = [];

      for (const [stationId, o] of batch) {
        const base = values.length;
        values.push(
          stationId,
          o.date,
          source,
          o.tMeanC ?? null,
          o.tMinC ?? null,
          o.tMaxC ?? null,
          o.precipMm ?? null,
          o.rhMeanPct ?? null,
          o.soilT0To7C ?? null,
          o.soilT7To28C ?? null,
          o.soilMoisture0To7 ?? null,
          o.sampleCount ?? null,
        );
        const p = (n: number): string => `$${base + n}`;
        tuples.push(
          `(${p(1)}::uuid, ${p(2)}::date, ${p(3)}::"WeatherSourceCode", ${p(4)}::double precision, ` +
            `${p(5)}::double precision, ${p(6)}::double precision, ${p(7)}::double precision, ` +
            `${p(8)}::double precision, ${p(9)}::double precision, ${p(10)}::double precision, ` +
            `${p(11)}::double precision, ${p(12)}::integer)`,
        );
      }

      const sql = `
        INSERT INTO "daily_observation" (
          "stationId", "date", "source", "tMeanC", "tMinC", "tMaxC", "precipMm",
          "rhMeanPct", "soilT0To7C", "soilT7To28C", "soilMoisture0To7",
          "sampleCount"
        )
        VALUES ${tuples.join(', ')}
        ON CONFLICT ("stationId", "date", "source") DO UPDATE SET
          "tMeanC"           = EXCLUDED."tMeanC",
          "tMinC"            = EXCLUDED."tMinC",
          "tMaxC"            = EXCLUDED."tMaxC",
          "precipMm"         = EXCLUDED."precipMm",
          "rhMeanPct"        = EXCLUDED."rhMeanPct",
          "soilT0To7C"       = EXCLUDED."soilT0To7C",
          "soilT7To28C"      = EXCLUDED."soilT7To28C",
          "soilMoisture0To7" = EXCLUDED."soilMoisture0To7",
          "sampleCount"      = EXCLUDED."sampleCount",
          "ingestedAt"       = now()
      `;

      written += await this.prisma.$executeRawUnsafe(sql, ...values);
    }

    return { written, orphans };
  }

  /** Ricalcola primo e ultimo giorno osservato di ogni stazione. */
  private async refreshStationCoverage(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      UPDATE "station" s SET
        "firstObservedOn" = c.min_date,
        "lastObservedOn"  = c.max_date,
        "updatedAt"       = now()
      FROM (
        SELECT "stationId", MIN("date") AS min_date, MAX("date") AS max_date
        FROM "daily_observation"
        GROUP BY "stationId"
      ) c
      WHERE s."id" = c."stationId"
        AND (s."firstObservedOn" IS DISTINCT FROM c.min_date
          OR s."lastObservedOn"  IS DISTINCT FROM c.max_date)
    `);
  }
}
