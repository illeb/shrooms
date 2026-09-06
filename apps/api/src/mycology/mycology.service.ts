import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildDailyFeatures,
  scoreSeries,
  type DailyFeatures,
  type DailyInput,
  type FruitingScore,
  type SpeciesProfile,
} from '@mushrooms/mycology-core';
import { PrismaService } from '../prisma/prisma.service';
import { SpeciesModelService } from './species-model.service';
import type { WeatherSourceCode } from '../generated/prisma/enums.ts';

/**
 * Priorita' delle sorgenti nel merge.
 *
 * L'osservato batte il modellato, variabile per variabile: una stazione reale
 * conosce la sua valle meglio di qualsiasi cella di griglia. Ma dove la
 * stazione non misura (il suolo, per tutte le reti Arpae) vince chi ha il dato.
 */
const SOURCE_PRIORITY: Record<WeatherSourceCode, number> = {
  ARPAE_ER: 100,
  MARCHE_AMAP: 100,
  SIR_TOSCANA: 90,
  OPEN_METEO: 10,
};

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ComputeResult {
  stationsProcessed: number;
  featuresWritten: number;
  predictionsWritten: number;
  durationMs: number;
}

const DAY_MS = 86_400_000;

@Injectable()
export class MycologyService {
  private readonly logger = new Logger(MycologyService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SpeciesModelService) private readonly models: SpeciesModelService,
  ) {}

  /**
   * Calcola feature e punteggi per tutte le stazioni con dati nell'intervallo.
   *
   * Una stazione alla volta: il bilancio idrico e' sequenziale per definizione
   * e le finestre mobili guardano indietro, quindi non c'e' nulla da
   * parallelizzare dentro una serie. Fra stazioni si potrebbe, ma tenere il
   * ciclo semplice vale piu' dei secondi risparmiati.
   */
  async computeAll(
    species: string,
    range: DateRange,
    filter: { minAltitudeM?: number; maxAltitudeM?: number } = {},
  ): Promise<ComputeResult> {
    const startedAt = Date.now();
    const { id: modelId, profile } = await this.models.active(species);

    const stations = await this.prisma.station.findMany({
      where: {
        active: true,
        ...(filter.minAltitudeM === undefined && filter.maxAltitudeM === undefined
          ? {}
          : {
              altitudeM: {
                ...(filter.minAltitudeM === undefined ? {} : { gte: filter.minAltitudeM }),
                ...(filter.maxAltitudeM === undefined ? {} : { lte: filter.maxAltitudeM }),
              },
            }),
      },
      select: { id: true, name: true, latitude: true, altitudeM: true },
      orderBy: { name: 'asc' },
    });

    this.logger.log(
      `${profile.species} v${profile.version}: ${stations.length} stazioni, ` +
        `${iso(range.from)} -> ${iso(range.to)}`,
    );

    let featuresWritten = 0;
    let predictionsWritten = 0;
    let processed = 0;

    for (const station of stations) {
      const result = await this.computeStation(station, profile, modelId, range);
      featuresWritten += result.features;
      predictionsWritten += result.predictions;
      processed += 1;

      if (processed % 100 === 0) {
        this.logger.log(`${processed}/${stations.length} stazioni`);
      }
    }

    return {
      stationsProcessed: processed,
      featuresWritten,
      predictionsWritten,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Serie di punteggi di una stazione, senza persistere nulla.
   *
   * E' il percorso del backtest: si cambiano i numeri del profilo e si guarda
   * subito l'effetto, senza riscrivere il database.
   */
  async scoreStation(
    stationId: string,
    species: string,
    range: DateRange,
    override?: SpeciesProfile,
  ): Promise<{ station: { name: string; altitudeM: number | null }; scores: FruitingScore[] }> {
    const station = await this.prisma.station.findUniqueOrThrow({
      where: { id: stationId },
      select: { id: true, name: true, latitude: true, altitudeM: true },
    });

    const profile = override ?? (await this.models.active(species)).profile;
    const { features } = await this.featuresFor(station, profile, range);

    return {
      station: { name: station.name, altitudeM: station.altitudeM },
      scores: scoreSeries(features, profile),
    };
  }

  private async computeStation(
    station: { id: string; name: string; latitude: number; altitudeM: number | null },
    profile: SpeciesProfile,
    modelId: string,
    range: DateRange,
  ): Promise<{ features: number; predictions: number }> {
    const { features, hasObserved } = await this.featuresFor(station, profile, range);
    if (features.length === 0) return { features: 0, predictions: 0 };

    const scores = scoreSeries(features, profile, {
      confidence: hasObserved ? 'observed' : 'modelled',
    });

    // Solo i giorni richiesti: la serie e' piu' lunga per via dello spin-up.
    const inRange = (d: Date) => d >= range.from && d <= range.to;

    const featureRows = features.filter((f) => inRange(f.date));
    const scoreRows = scores.filter((s) => inRange(s.date));

    await this.writeFeatures(station.id, featureRows);
    await this.writePredictions(station.id, modelId, scoreRows);

    return { features: featureRows.length, predictions: scoreRows.length };
  }

  /**
   * Costruisce la serie di feature di una stazione.
   *
   * L'intervallo viene esteso all'indietro dello spin-up del bilancio idrico
   * piu' la finestra mobile piu' lunga: senza quel preambolo i primi giorni
   * richiesti avrebbero un serbatoio inventato e cumulate incomplete.
   */
  private async featuresFor(
    station: { id: string; latitude: number; altitudeM: number | null },
    profile: SpeciesProfile,
    range: DateRange,
  ): Promise<{ features: DailyFeatures[]; hasObserved: boolean }> {
    const LOOKBACK_DAYS = 120;
    const from = new Date(range.from.getTime() - LOOKBACK_DAYS * DAY_MS);

    const rows = await this.prisma.dailyObservation.findMany({
      where: { stationId: station.id, date: { gte: from, lte: range.to } },
      orderBy: [{ date: 'asc' }],
    });

    if (rows.length === 0) return { features: [], hasObserved: false };

    const merged = mergeBySource(rows);
    const series = fillGaps(merged, from, range.to);

    const hasObserved = rows.some((r) => SOURCE_PRIORITY[r.source] >= 90);

    const features = buildDailyFeatures(series, {
      latitudeDeg: station.latitude,
      altitudeM: station.altitudeM,
      awcMm: profile.water.awcMm,
      kc: profile.water.kc,
    });

    return { features, hasObserved };
  }

  private async writeFeatures(stationId: string, features: DailyFeatures[]): Promise<void> {
    if (features.length === 0) return;

    const BATCH = 400;
    for (let i = 0; i < features.length; i += BATCH) {
      const batch = features.slice(i, i + BATCH);
      const values: unknown[] = [];
      const tuples: string[] = [];

      for (const f of batch) {
        const base = values.length;
        const { date, warmup, ...rest } = f;
        values.push(stationId, date, JSON.stringify(rest), warmup ?? false);
        tuples.push(
          `($${base + 1}::uuid, $${base + 2}::date, $${base + 3}::jsonb, $${base + 4}::boolean)`,
        );
      }

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "daily_station_feature" ("stationId", "date", "features", "warmup")
         VALUES ${tuples.join(', ')}
         ON CONFLICT ("stationId", "date") DO UPDATE SET
           "features"   = EXCLUDED."features",
           "warmup"     = EXCLUDED."warmup",
           "computedAt" = now()`,
        ...values,
      );
    }
  }

  private async writePredictions(
    stationId: string,
    modelId: string,
    scores: FruitingScore[],
  ): Promise<void> {
    if (scores.length === 0) return;

    const BATCH = 400;
    for (let i = 0; i < scores.length; i += BATCH) {
      const batch = scores.slice(i, i + BATCH);
      const values: unknown[] = [];
      const tuples: string[] = [];

      for (const s of batch) {
        const base = values.length;
        values.push(
          stationId,
          s.date,
          modelId,
          s.score,
          s.class,
          s.triggerScore,
          s.phenologyScore,
          s.daysSinceWetEvent,
          s.warmup,
          JSON.stringify({
            contributions: s.contributions,
            activeInhibitors: s.activeInhibitors,
            confidence: s.confidence,
          }),
        );
        const p = (n: number) => `$${base + n}`;
        tuples.push(
          `(${p(1)}::uuid, ${p(2)}::date, ${p(3)}::uuid, ${p(4)}::double precision, ` +
            `${p(5)}::varchar, ${p(6)}::double precision, ${p(7)}::double precision, ` +
            `${p(8)}::integer, ${p(9)}::boolean, ${p(10)}::jsonb)`,
        );
      }

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "fruiting_prediction" (
           "stationId", "date", "modelId", "score", "class",
           "triggerScore", "phenologyScore", "daysSinceWetEvent", "warmup", "detail"
         )
         VALUES ${tuples.join(', ')}
         ON CONFLICT ("stationId", "date", "modelId") DO UPDATE SET
           "score"             = EXCLUDED."score",
           "class"             = EXCLUDED."class",
           "triggerScore"      = EXCLUDED."triggerScore",
           "phenologyScore"    = EXCLUDED."phenologyScore",
           "daysSinceWetEvent" = EXCLUDED."daysSinceWetEvent",
           "warmup"            = EXCLUDED."warmup",
           "detail"            = EXCLUDED."detail",
           "computedAt"        = now()`,
        ...values,
      );
    }
  }
}

interface ObservationRow {
  date: Date;
  source: WeatherSourceCode;
  tMeanC: number | null;
  tMinC: number | null;
  tMaxC: number | null;
  precipMm: number | null;
  rhMeanPct: number | null;
  soilT0To7C: number | null;
  soilT7To28C: number | null;
  soilMoisture0To7: number | null;
}

const MERGED_FIELDS = [
  'tMeanC',
  'tMinC',
  'tMaxC',
  'precipMm',
  'rhMeanPct',
  'soilT0To7C',
  'soilT7To28C',
  'soilMoisture0To7',
] as const;

/**
 * Fonde le righe di sorgenti diverse per lo stesso giorno.
 *
 * Campo per campo, non riga per riga: da Arpae prendiamo aria e pioggia, da
 * Open-Meteo il suolo, e il risultato e' una sola serie coerente.
 */
export function mergeBySource(rows: readonly ObservationRow[]): DailyInput[] {
  const byDay = new Map<number, DailyInput>();

  const ordered = [...rows].sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]);

  for (const row of ordered) {
    const key = row.date.getTime();
    const existing = byDay.get(key) ?? { date: row.date };

    for (const field of MERGED_FIELDS) {
      // Ordinato per priorita' decrescente: chi arriva primo vince, e chi
      // segue riempie solo i buchi lasciati.
      if (existing[field] === undefined || existing[field] === null) {
        const value = row[field];
        if (value !== null) existing[field] = value;
      }
    }

    byDay.set(key, existing);
  }

  return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Rende la serie contigua: un elemento per giorno, vuoto dove manca il dato.
 *
 * Il bilancio idrico e le finestre mobili ragionano per indici: un giorno
 * saltato diventerebbe un giorno in cui il suolo non evapora.
 */
export function fillGaps(days: readonly DailyInput[], from: Date, to: Date): DailyInput[] {
  const byDay = new Map(days.map((d) => [startOfDay(d.date).getTime(), d]));
  const out: DailyInput[] = [];

  for (let t = startOfDay(from).getTime(); t <= startOfDay(to).getTime(); t += DAY_MS) {
    out.push(byDay.get(t) ?? { date: new Date(t) });
  }

  return out;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
