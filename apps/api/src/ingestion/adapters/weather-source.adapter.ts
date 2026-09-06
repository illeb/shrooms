import type { WeatherSourceCode } from '../../generated/prisma/enums.ts';

/** Una stazione così come la vede una sorgente, prima di entrare nel database. */
export interface StationUpsert {
  source: WeatherSourceCode;
  /** Identificativo stabile nella sorgente. Non deve mai cambiare fra due run. */
  externalId: string;
  name: string;
  network?: string | null;
  latitude: number;
  longitude: number;
  altitudeM?: number | null;
  region?: string | null;
  province?: string | null;
  active?: boolean;
}

/**
 * Un giorno di dati per una stazione, già aggregato su giorno locale
 * (Europe/Rome) e in unità SI leggibili: gradi Celsius, millimetri, percentuali.
 */
export interface DailyObservationUpsert {
  externalId: string;
  /** Mezzanotte UTC del giorno locale a cui il dato si riferisce. */
  date: Date;
  tMeanC?: number | null;
  tMinC?: number | null;
  tMaxC?: number | null;
  precipMm?: number | null;
  rhMeanPct?: number | null;
  soilT0To7C?: number | null;
  soilT7To28C?: number | null;
  soilMoisture0To7?: number | null;
  /** Quante misure sotto-giornaliere hanno prodotto questo aggregato. */
  sampleCount?: number | null;
}

/** Un blocco di dati pronto per essere scritto. */
export interface FetchBatch {
  /**
   * Stazioni viste leggendo questo blocco. Vuoto per le sorgenti a griglia,
   * che non hanno un'anagrafica propria.
   *
   * Sta qui e non in `syncStations` perche' Arpae l'anagrafica non la
   * pubblica: si ricava dalle intestazioni delle righe di dati. Ricavarla in
   * una seconda passata significherebbe riscaricare gli stessi file, e
   * perdere le stazioni attive solo nei mesi piu' vecchi dell'intervallo.
   */
  stations: StationUpsert[];
  observations: DailyObservationUpsert[];
}

/**
 * Riceve i blocchi man mano che l'adapter li produce e li persiste.
 *
 * Serve a due cose insieme: tenere la memoria limitata (un backfill di un anno
 * sono oltre centomila osservazioni) e rendere durevole il lavoro parziale, in
 * modo che un rate limit a meta' strada non butti via quanto gia' scaricato.
 * Ritorna quante righe ha effettivamente scritto.
 */
export type ObservationSink = (batch: FetchBatch) => Promise<number>;

/** Riepilogo di una lettura completata. */
export interface FetchSummary {
  stationsSeen: number;
  observationsWritten: number;
  /** Valorizzato se la lettura si e' interrotta prima della fine. */
  incompleteReason?: string;
}

export interface DateRange {
  /** Inclusivo. */
  from: Date;
  /** Inclusivo. */
  to: Date;
}

/**
 * Contratto unico per ogni sorgente meteo.
 *
 * Aggiungere una regione significa implementare questa interfaccia e
 * registrarla: nessun'altra parte del sistema deve sapere che esiste.
 */
export interface WeatherSourceAdapter {
  readonly code: WeatherSourceCode;

  /**
   * Priorità nel merge, più alto vince. L'osservato batte il modellato:
   * una stazione reale conosce la sua valle meglio di qualsiasi griglia.
   */
  readonly priority: number;

  /**
   * Da quale anagrafica provengono gli `externalId` che l'adapter emette.
   *
   * `own`      la sorgente ha le sue stazioni (Arpae).
   * `provided` la sorgente e' a griglia e rimanda indietro gli id delle
   *            stazioni che le sono state passate (Open-Meteo), cosi' i suoi
   *            valori finiscono sulla stessa riga-stazione dell'osservato.
   */
  readonly stationScope: 'own' | 'provided';

  /** Elenca le stazioni della sorgente. */
  syncStations(): Promise<StationUpsert[]>;

  /**
   * Scarica i dati giornalieri nell'intervallo.
   *
   * `stations` è la lista già presente a database: le sorgenti a griglia
   * (Open-Meteo) la usano come elenco di coordinate da interrogare, quelle
   * a stazione la usano per filtrare.
   */
  fetchDaily(
    range: DateRange,
    stations: StationUpsert[],
    sink: ObservationSink,
  ): Promise<FetchSummary>;
}
