/**
 * Aggregazione dei campioni sotto-giornalieri Arpae in valori giornalieri.
 *
 * Perche' aggreghiamo noi invece di usare i giornalieri gia' pubblicati:
 *
 *  1. Arpae pubblica due aggregati giornalieri con convenzioni diverse
 *     (timbrati 00:00Z e 08:00Z) e valori diversi per lo stesso giorno.
 *  2. Un aggregato timbrato `T` copre le 24 h che *finiscono* in `T`
 *     (verificato su 134 campioni: coincide al 100% con la somma dei 15
 *     minuti del giorno precedente). E' una trappola da fuso orario.
 *  3. Molte piu' stazioni pubblicano i sotto-orari che i giornalieri.
 *
 * Aggregando su giorno locale Europe/Rome otteniamo un'unica convenzione,
 * la stessa che chiediamo a Open-Meteo con `timezone=Europe/Rome`.
 */

import type { DailyObservationUpsert, StationUpsert } from '../weather-source.adapter';
import type { ArpaeSample, ArpaeStationHeader } from './arpae-bufr';

/** Copertura minima per accettare un giorno, come frazione dei campioni attesi. */
const MIN_COVERAGE = 0.75;

/** Campioni di temperatura minimi per calcolare media/min/max del giorno. */
const MIN_TEMPERATURE_SAMPLES = 18;

const ROME_DAY = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Giorno locale italiano (YYYY-MM-DD) di un istante UTC, DST inclusa. */
export function romeDayKey(at: Date): string {
  return ROME_DAY.format(at);
}

interface Accumulator {
  tSum: number;
  tCount: number;
  tMin: number;
  tMax: number;
  rhSum: number;
  rhCount: number;
  /** Somma delle cumulate, separata per ampiezza di finestra. */
  precipByWindow: Map<number, { sum: number; count: number }>;
}

function emptyAccumulator(): Accumulator {
  return {
    tSum: 0,
    tCount: 0,
    tMin: Number.POSITIVE_INFINITY,
    tMax: Number.NEGATIVE_INFINITY,
    rhSum: 0,
    rhCount: 0,
    precipByWindow: new Map(),
  };
}

/**
 * Accumulatore in streaming: consuma i campioni uno alla volta senza mai
 * tenere in memoria il file, che per un mese sta sulle centinaia di MB.
 */
export class ArpaeDailyAggregator {
  private readonly stations = new Map<string, ArpaeStationHeader>();
  private readonly days = new Map<string, Accumulator>();
  /** Quante volte ogni stazione ha usato una certa finestra di cumulata. */
  private readonly windowUsage = new Map<string, Map<number, number>>();

  add(sample: ArpaeSample): void {
    const { externalId } = sample.station;
    this.stations.set(externalId, sample.station);

    const key = `${externalId} ${romeDayKey(sample.at)}`;
    let acc = this.days.get(key);
    if (!acc) {
      acc = emptyAccumulator();
      this.days.set(key, acc);
    }

    if (sample.airTemperatureC !== null) {
      acc.tSum += sample.airTemperatureC;
      acc.tCount += 1;
      if (sample.airTemperatureC < acc.tMin) acc.tMin = sample.airTemperatureC;
      if (sample.airTemperatureC > acc.tMax) acc.tMax = sample.airTemperatureC;
    }

    if (sample.relativeHumidityPct !== null) {
      acc.rhSum += sample.relativeHumidityPct;
      acc.rhCount += 1;
    }

    if (sample.precipitationMm !== null && sample.precipitationWindowS !== null) {
      const w = sample.precipitationWindowS;
      const bucket = acc.precipByWindow.get(w) ?? { sum: 0, count: 0 };
      bucket.sum += sample.precipitationMm;
      bucket.count += 1;
      acc.precipByWindow.set(w, bucket);

      let usage = this.windowUsage.get(externalId);
      if (!usage) {
        usage = new Map();
        this.windowUsage.set(externalId, usage);
      }
      usage.set(w, (usage.get(w) ?? 0) + 1);
    }
  }

  /**
   * Finestra di cumulata "ufficiale" di una stazione: la piu' usata nel file.
   *
   * Serve perche' la stessa stazione puo' pubblicare la pioggia a 15', 30' e
   * un'ora: sommarle tutte insieme la conterebbe tre volte.
   */
  private preferredWindow(externalId: string): number | null {
    const usage = this.windowUsage.get(externalId);
    if (!usage || usage.size === 0) return null;

    let best: number | null = null;
    let bestCount = -1;
    for (const [window, count] of usage) {
      // A parita' di frequenza vince la finestra piu' fine.
      if (count > bestCount || (count === bestCount && best !== null && window < best)) {
        best = window;
        bestCount = count;
      }
    }
    return best;
  }

  stationList(): StationUpsert[] {
    return [...this.stations.values()].map((s) => ({
      source: 'ARPAE_ER' as const,
      externalId: s.externalId,
      name: s.name,
      network: s.network,
      latitude: s.latitude,
      longitude: s.longitude,
      altitudeM: s.altitudeM,
      region: 'Emilia-Romagna',
      active: true,
    }));
  }

  /** Chiude gli accumulatori e produce le osservazioni giornaliere. */
  finish(): DailyObservationUpsert[] {
    const out: DailyObservationUpsert[] = [];

    for (const [key, acc] of this.days) {
      const sep = key.indexOf(' ');
      const externalId = key.slice(0, sep);
      const dayKey = key.slice(sep + 1);

      const hasTemperature = acc.tCount >= MIN_TEMPERATURE_SAMPLES;

      let precipMm: number | null = null;
      let precipSamples = 0;
      const window = this.preferredWindow(externalId);
      if (window !== null) {
        const bucket = acc.precipByWindow.get(window);
        if (bucket) {
          const expected = 86_400 / window;
          if (bucket.count >= expected * MIN_COVERAGE) {
            precipMm = Math.round(bucket.sum * 100) / 100;
            precipSamples = bucket.count;
          }
        }
      }

      if (!hasTemperature && precipMm === null) continue;

      out.push({
        externalId,
        date: new Date(`${dayKey}T00:00:00.000Z`),
        tMeanC: hasTemperature ? round1(acc.tSum / acc.tCount) : null,
        tMinC: hasTemperature ? round1(acc.tMin) : null,
        tMaxC: hasTemperature ? round1(acc.tMax) : null,
        precipMm,
        rhMeanPct: acc.rhCount >= MIN_TEMPERATURE_SAMPLES ? round1(acc.rhSum / acc.rhCount) : null,
        sampleCount: Math.max(acc.tCount, precipSamples),
      });
    }

    return out;
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
