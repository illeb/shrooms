import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { fetchOpenMeteo, sleep } from './open-meteo-http';
import type {
  DailyObservationUpsert,
  DateRange,
  FetchOptions,
  FetchSummary,
  ObservationSink,
  StationUpsert,
  WeatherSourceAdapter,
} from '../weather-source.adapter';

/**
 * Open-Meteo.
 *
 * Copre i due buchi che nessuna rete regionale italiana riempie:
 *
 *  1. **La temperatura del suolo.** Nessuna rete Arpae la misura, ed e' la
 *     variabile centrale del modello.
 *  2. **L'umidita' volumetrica del suolo**, che affianca e valida il bilancio
 *     idrico calcolato da noi.
 *
 * Usiamo solo la rianalisi del passato: nessun dato di previsione entra nel
 * sistema. Il modello risponde a "ci sono le condizioni ADESSO", guardando
 * indietro alla pioggia caduta e alle temperature seguite, non in avanti.
 *
 * Sorgente a griglia: non ha stazioni proprie, interroga le coordinate di
 * quelle che gli vengono passate e i suoi valori finiscono sulla stessa
 * riga-stazione dell'osservato, distinti solo dalla colonna `source`.
 *
 * Licenza: il tier gratuito e' **non commerciale**, 10.000 chiamate al giorno.
 * Con il batching multi-coordinata bastano poche chiamate al giorno per tutte
 * le stazioni; per l'uso commerciale servono il piano a pagamento o il
 * self-host (e' open source).
 */
@Injectable()
export class OpenMeteoAdapter implements WeatherSourceAdapter {
  readonly code = 'OPEN_METEO' as const;
  /** Modellato: perde contro l'osservato nel merge. */
  readonly priority = 10;
  readonly stationScope = 'provided' as const;

  private readonly logger = new Logger(OpenMeteoAdapter.name);
  private readonly apiUrl: string;
  private readonly archiveUrl: string;

  /**
   * Coordinate per chiamata. Open-Meteo accetta liste separate da virgola e
   * risponde con un array nello stesso ordine: 300 stazioni sono 3 chiamate.
   */
  private static readonly CHUNK_SIZE = 100;

  /**
   * Giorni di latenza dell'archivio ERA5. Prima di questa soglia si usa
   * l'archivio, dopo l'endpoint /v1/forecast, che nonostante il nome serve
   * anche i giorni appena trascorsi. In nessun caso chiediamo giorni futuri.
   */
  private static readonly ARCHIVE_LAG_DAYS = 6;

  /**
   * `era5_seamless` combina ERA5 ed ERA5-Land: precipitazione da ERA5 (in
   * ERA5-Land e' nulla) e suolo dalla griglia piu' fine a 9 km.
   */
  private static readonly ARCHIVE_MODEL = 'era5_seamless';

  /**
   * Quanto indietro arriva davvero l'endpoint del passato recente.
   *
   * Il servizio ne dichiara 92 nel messaggio d'errore, ed era il numero che
   * stava qui, ma e' il limite del parametro, non dei dati: chiedendo 92
   * giorni risponde 200 con le prime trenta righe a `null`. Misurato sul
   * campo, i valori partono da oggi-61. Piu' indietro si passa dall'archivio.
   */
  private static readonly RECENT_MAX_PAST_DAYS = 61;

  /**
   * Giorni per richiesta.
   *
   * Open-Meteo non conta le chiamate ma il loro peso (coordinate x giorni x
   * variabili): un anno intero per 100 stazioni in un colpo solo sfonda il
   * limite al minuto e torna 429. Spezzando in trimestri ogni richiesta resta
   * piccola e prevedibile.
   */
  private static readonly MAX_DAYS_PER_REQUEST = 92;

  private static readonly DAILY_VARS = [
    'temperature_2m_mean',
    'temperature_2m_min',
    'temperature_2m_max',
    'precipitation_sum',
    'relative_humidity_2m_mean',
    'soil_temperature_0_to_7cm_mean',
    'soil_temperature_7_to_28cm_mean',
    'soil_moisture_0_to_7cm_mean',
  ] as const;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.apiUrl = config.get('OPEN_METEO_BASE_URL', { infer: true });
    this.archiveUrl = config.get('OPEN_METEO_ARCHIVE_URL', { infer: true });
  }

  /** Non ha stazioni proprie: usa quelle che gli vengono passate. */
  async syncStations(): Promise<StationUpsert[]> {
    return [];
  }

  async fetchDaily(
    range: DateRange,
    stations: StationUpsert[],
    sink: ObservationSink,
    options: FetchOptions = {},
  ): Promise<FetchSummary> {
    if (stations.length === 0) return { stationsSeen: 0, observationsWritten: 0 };

    const today = startOfUtcDay(new Date());
    // Ultimo giorno COMPLETO. Il giorno in corso non e' un'osservazione: il
    // modello lo chiuderebbe con le ore non ancora avvenute, cioe' con una
    // previsione.
    const lastComplete = addDays(today, -1);
    const archiveEnd = addDays(today, -OpenMeteoAdapter.ARCHIVE_LAG_DAYS);

    const from = startOfUtcDay(range.from);
    let to = startOfUtcDay(range.to);

    // Invariante del progetto: nel database non entrano dati futuri, e nemmeno
    // il giorno in corso. Il modello valuta le condizioni attuali sulla base
    // di giorni gia' chiusi.
    if (to > lastComplete) {
      this.logger.warn(
        `Richiesto fino al ${isoDay(to)}: si ingeriscono solo giorni completi, ritaglio al ${isoDay(lastComplete)}.`,
      );
      to = lastComplete;
    }
    if (to < from) return { stationsSeen: 0, observationsWritten: 0 };
    const recentEnd = to;

    let written = 0;
    let incompleteReason: string | undefined;

    // Passato consolidato -> archivio ERA5, salvo richiesta contraria.
    if (from <= archiveEnd && !options.preferRecent) {
      const end = to < archiveEnd ? to : archiveEnd;
      const r = await this.query('archive', stations, from, end, sink);
      written += r.written;
      incompleteReason ??= r.stoppedBecause;
    }

    // Passato recente -> endpoint "forecast", che serve anche i giorni appena
    // trascorsi non ancora consolidati in archivio. Mai oltre oggi.
    const recentStart = options.preferRecent ? from : addDays(archiveEnd, 1);
    if (to >= recentStart) {
      const earliest = addDays(today, -OpenMeteoAdapter.RECENT_MAX_PAST_DAYS);

      let start = from > recentStart ? from : recentStart;
      if (start < earliest) start = earliest;

      if (start <= recentEnd && incompleteReason === undefined) {
        const r = await this.query('recent', stations, start, recentEnd, sink);
        written += r.written;
        incompleteReason ??= r.stoppedBecause;
      }
    }

    return {
      stationsSeen: 0,
      observationsWritten: written,
      ...(incompleteReason === undefined ? {} : { incompleteReason }),
    };
  }

  private async query(
    endpoint: 'archive' | 'recent',
    stations: StationUpsert[],
    from: Date,
    to: Date,
    sink: ObservationSink,
  ): Promise<{ written: number; stoppedBecause?: string }> {
    const groups = chunk(stations, OpenMeteoAdapter.CHUNK_SIZE);
    const slices = sliceDays(from, to, OpenMeteoAdapter.MAX_DAYS_PER_REQUEST);
    const total = groups.length * slices.length;

    let written = 0;
    let done = 0;

    for (const slice of slices) {
      for (const group of groups) {
        const url = this.buildUrl(endpoint, group, slice.from, slice.to);

        let results: OpenMeteoResponse[];
        try {
          results = await this.fetchWithRetry(url, endpoint);
        } catch (error) {
          // Il limite orario non si sblocca aspettando qualche minuto: invece
          // di far fallire tutto, chiudiamo qui e teniamo il gia' scritto.
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Lettura interrotta dopo ${done}/${total} richieste: ${reason}`);
          return { written, stoppedBecause: reason };
        }

        if (results.length !== group.length) {
          throw new Error(
            `Open-Meteo ha restituito ${results.length} risultati per ${group.length} coordinate`,
          );
        }

        const observations: DailyObservationUpsert[] = [];
        for (const [i, result] of results.entries()) {
          const station = group[i];
          if (!station) continue;
          observations.push(...toObservations(station.externalId, result));
        }

        // Scrittura per fetta: se il rate limit arriva alla richiesta dopo,
        // quanto scaricato finora e' gia' al sicuro.
        written += await sink({ stations: [], observations });

        done += 1;
        this.logger.debug(
          `${endpoint} ${done}/${total}: ${group.length} coordinate, ${isoDay(slice.from)} -> ${isoDay(slice.to)}`,
        );

        if (done < total) await sleep(300);
      }
    }

    return { written };
  }

  /** Una risposta o un array, a seconda che le coordinate siano una o tante. */
  private async fetchWithRetry(url: string, endpoint: string): Promise<OpenMeteoResponse[]> {
    const payload = await fetchOpenMeteo<OpenMeteoResponse | OpenMeteoResponse[]>(
      url,
      endpoint,
      this.logger,
    );
    return Array.isArray(payload) ? payload : [payload];
  }

  private buildUrl(
    endpoint: 'archive' | 'recent',
    stations: StationUpsert[],
    from: Date,
    to: Date,
  ): string {
    const base =
      endpoint === 'archive' ? `${this.archiveUrl}/v1/archive` : `${this.apiUrl}/v1/forecast`;

    const params = new URLSearchParams({
      latitude: stations.map((s) => s.latitude.toFixed(4)).join(','),
      longitude: stations.map((s) => s.longitude.toFixed(4)).join(','),
      start_date: isoDay(from),
      end_date: isoDay(to),
      daily: OpenMeteoAdapter.DAILY_VARS.join(','),
      timezone: 'Europe/Rome',
    });

    if (endpoint === 'archive') params.set('models', OpenMeteoAdapter.ARCHIVE_MODEL);

    return `${base}?${params.toString()}`;
  }
}

interface OpenMeteoResponse {
  daily?: {
    time?: string[];
    temperature_2m_mean?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    relative_humidity_2m_mean?: Array<number | null>;
    soil_temperature_0_to_7cm_mean?: Array<number | null>;
    soil_temperature_7_to_28cm_mean?: Array<number | null>;
    soil_moisture_0_to_7cm_mean?: Array<number | null>;
  };
}

function toObservations(externalId: string, result: OpenMeteoResponse): DailyObservationUpsert[] {
  const daily = result.daily;
  const times = daily?.time;
  if (!daily || !times) return [];

  const out: DailyObservationUpsert[] = [];

  for (const [i, day] of times.entries()) {
    const date = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;

    const row: DailyObservationUpsert = {
      externalId,
      date,
      tMeanC: at(daily.temperature_2m_mean, i),
      tMinC: at(daily.temperature_2m_min, i),
      tMaxC: at(daily.temperature_2m_max, i),
      precipMm: at(daily.precipitation_sum, i),
      rhMeanPct: at(daily.relative_humidity_2m_mean, i),
      soilT0To7C: at(daily.soil_temperature_0_to_7cm_mean, i),
      soilT7To28C: at(daily.soil_temperature_7_to_28cm_mean, i),
      soilMoisture0To7: at(daily.soil_moisture_0_to_7cm_mean, i),
    };

    // Un giorno tutto nullo non merita una riga.
    const hasValue =
      row.tMeanC !== null ||
      row.precipMm !== null ||
      row.soilT0To7C !== null ||
      row.soilMoisture0To7 !== null;
    if (hasValue) out.push(row);
  }

  return out;
}

function at(values: Array<number | null> | undefined, index: number): number | null {
  const v = values?.[index];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Spezza un intervallo in fette di al massimo `maxDays` giorni. */
function sliceDays(from: Date, to: Date, maxDays: number): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, maxDays - 1);
    out.push({ from: start, to: end > to ? to : end });
    start = addDays(end, 1);
  }
  return out;
}
