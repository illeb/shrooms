import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import type {
  DateRange,
  FetchSummary,
  ObservationSink,
  StationUpsert,
  WeatherSourceAdapter,
} from '../weather-source.adapter';
import { parseArpaeLine } from './arpae-bufr';
import { ArpaeDailyAggregator } from './arpae-aggregator';

/**
 * Arpae SIMC, Emilia-Romagna.
 *
 * Sorgente osservata e completamente aperta: nessuna chiave, nessuna
 * registrazione, storico dal 2006. Un file gzip al mese, riscritto in continuo
 * anche per il mese corrente (verificato: aggiornato all'ora precedente), quindi
 * il cron giornaliero scarica un solo file e ha sia ieri sia le correzioni
 * arrivate nel frattempo sui giorni gia' visti.
 *
 * Non misura la temperatura del suolo in nessuna delle sue reti: quella
 * arriva da Open-Meteo.
 */
@Injectable()
export class ArpaeAdapter implements WeatherSourceAdapter {
  readonly code = 'ARPAE_ER' as const;
  /** Osservato: batte il modellato nel merge. */
  readonly priority = 100;
  readonly stationScope = 'own' as const;

  private readonly logger = new Logger(ArpaeAdapter.name);
  private readonly baseUrl: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.baseUrl = config.get('ARPAE_OPENDATA_BASE_URL', { infer: true });
  }

  /**
   * L'anagrafica non ha un endpoint dedicato: le stazioni si ricavano dalle
   * intestazioni delle righe di dati. Leggiamo il mese corrente, che e' il
   * campione piu' rappresentativo di cosa e' attivo oggi.
   */
  async syncStations(): Promise<StationUpsert[]> {
    const now = new Date();
    const aggregator = new ArpaeDailyAggregator();
    await this.streamMonth(now.getUTCFullYear(), now.getUTCMonth() + 1, aggregator);
    const stations = aggregator.stationList();
    this.logger.log(`Anagrafica Arpae: ${stations.length} stazioni`);
    return stations;
  }

  /**
   * Un file mensile alla volta: si legge, si aggrega, si scrive, si passa al
   * mese dopo. La memoria resta limitata a un mese e ogni mese completato e'
   * gia' al sicuro a database.
   */
  async fetchDaily(
    range: DateRange,
    _stations: StationUpsert[],
    sink: ObservationSink,
  ): Promise<FetchSummary> {
    const months = monthsBetween(range.from, range.to);
    const seen = new Set<string>();
    let written = 0;

    for (const { year, month } of months) {
      const aggregator = new ArpaeDailyAggregator();
      const lines = await this.streamMonth(year, month, aggregator);

      const observations = aggregator
        .finish()
        .filter((d) => d.date >= startOfDay(range.from) && d.date <= startOfDay(range.to));

      // Le stazioni si accumulano su tutti i mesi letti: una attiva solo nel
      // 2019 esiste per i dati del 2019, anche se oggi non trasmette piu'.
      const stations = aggregator.stationList();
      for (const s of stations) seen.add(s.externalId);

      written += await sink({ stations, observations });

      this.logger.log(
        `${year}-${String(month).padStart(2, '0')}: ${lines} righe -> ${observations.length} giorni-stazione`,
      );
    }

    return { stationsSeen: seen.size, observationsWritten: written };
  }

  /**
   * Scarica un file mensile e lo dà in pasto all'aggregatore riga per riga.
   *
   * Streaming obbligato: un mese sta sui 22 MB compressi e diverse centinaia
   * di MB una volta espanso. Ritorna il numero di righe lette.
   */
  private async streamMonth(
    year: number,
    month: number,
    aggregator: ArpaeDailyAggregator,
  ): Promise<number> {
    const url = `${this.baseUrl}/storico/${year}-${String(month).padStart(2, '0')}.json.gz`;

    const response = await fetch(url);
    if (response.status === 404) {
      this.logger.warn(`Nessun file per ${year}-${month}: ${url}`);
      return 0;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Arpae ha risposto ${response.status} per ${url}`);
    }

    const gunzip = createGunzip();
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    source.pipe(gunzip);

    const reader = createInterface({ input: gunzip, crlfDelay: Infinity });

    let lines = 0;
    let skipped = 0;
    for await (const line of reader) {
      if (!line) continue;
      lines += 1;
      const sample = parseArpaeLine(line);
      if (sample === null) {
        skipped += 1;
        continue;
      }
      aggregator.add(sample);
    }

    if (skipped > 0) {
      this.logger.debug(`${skipped}/${lines} righe scartate (malformate o senza anagrafica)`);
    }
    return lines;
  }
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

/** Mesi coperti dall'intervallo, estremi inclusi. */
export function monthsBetween(from: Date, to: Date): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth() + 1;
  const lastYear = to.getUTCFullYear();
  const lastMonth = to.getUTCMonth() + 1;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}
