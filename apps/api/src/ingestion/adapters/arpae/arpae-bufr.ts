/**
 * Decodifica del formato open data di Arpae SIMC.
 *
 * I file sono JSONL in stile BUFR/DB-All.e: una riga = una stazione a un
 * istante, con le grandezze identificate da codici B. Modulo puro e senza I/O,
 * così è testabile riga per riga.
 *
 * Riferimento: https://dati.arpae.it/dataset/dati-dalle-stazioni-meteo-locali-della-rete-idrometeorologica-regionale
 */

/** Codici B usati; verificati sui dati reali di settembre 2026. */
export const B = {
  STATION_NAME: 'B01019',
  NETWORK: 'B01194',
  LATITUDE: 'B05001',
  LONGITUDE: 'B06001',
  STATION_HEIGHT: 'B07030',
  /** Temperatura dell'aria, in KELVIN. */
  AIR_TEMPERATURE: 'B12101',
  /** Umidità relativa, %. */
  RELATIVE_HUMIDITY: 'B13003',
  /** Precipitazione totale, mm. */
  PRECIPITATION: 'B13011',
} as const;

/** Primo elemento di `timerange`: che tipo di elaborazione è il valore. */
export const TIMERANGE_KIND = {
  AVERAGE: 0,
  ACCUMULATION: 1,
  MAXIMUM: 2,
  MINIMUM: 3,
  INSTANT: 254,
} as const;

/** `level` [103, mm dal suolo]: 2 m è l'altezza standard per T e umidità. */
const LEVEL_HEIGHT_ABOVE_GROUND = 103;
const HEIGHT_2M_MM = 2000;
/** `level` [1]: superficie del suolo, dove si misura la pioggia. */
const LEVEL_GROUND = 1;

const KELVIN_OFFSET = 273.15;

interface RawVar {
  v: number | string | null;
}

interface RawBlock {
  timerange?: [number, number, number];
  level?: Array<number | null>;
  vars: Record<string, RawVar | undefined>;
}

interface RawLine {
  network?: string;
  lon?: number;
  lat?: number;
  date?: string;
  data?: RawBlock[];
}

export interface ArpaeStationHeader {
  externalId: string;
  name: string;
  network: string;
  latitude: number;
  longitude: number;
  altitudeM: number | null;
}

export interface ArpaeSample {
  station: ArpaeStationHeader;
  /** Istante della misura, UTC. */
  at: Date;
  /** Temperatura dell'aria a 2 m, °C, istantanea o media del sotto-periodo. */
  airTemperatureC: number | null;
  /** Umidità relativa a 2 m, %. */
  relativeHumidityPct: number | null;
  /** Precipitazione cumulata sul sotto-periodo, mm. */
  precipitationMm: number | null;
  /** Durata in secondi della cumulata di precipitazione (900, 1800, 3600...). */
  precipitationWindowS: number | null;
}

function num(value: RawVar | undefined): number | null {
  if (!value) return null;
  const v = value.v;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(value: RawVar | undefined): string | null {
  if (!value) return null;
  return typeof value.v === 'string' ? value.v : null;
}

function isTwoMetres(level: Array<number | null> | undefined): boolean {
  return level?.[0] === LEVEL_HEIGHT_ABOVE_GROUND && level?.[1] === HEIGHT_2M_MM;
}

function isGround(level: Array<number | null> | undefined): boolean {
  return level?.[0] === LEVEL_GROUND;
}

/**
 * Identificativo stabile di stazione.
 *
 * `ident` è null per tutte le stazioni fisse, quindi la chiave è la terna
 * rete + coordinate intere (come pubblicate nell'intestazione della riga, in
 * decimillesimi di grado): non cambia fra un file e l'altro.
 */
export function arpaeExternalId(network: string, lon: number, lat: number): string {
  return `${network}:${lon}:${lat}`;
}

/**
 * Decodifica una riga JSONL in un campione.
 *
 * Ritorna `null` per righe non parsabili o prive di intestazione di stazione:
 * su archivi di vent'anni qualche riga malformata è la norma, e non deve
 * fermare l'ingestione.
 */
export function parseArpaeLine(line: string): ArpaeSample | null {
  let raw: RawLine;
  try {
    raw = JSON.parse(line) as RawLine;
  } catch {
    return null;
  }

  const { network, lon, lat, date, data } = raw;
  if (!network || typeof lon !== 'number' || typeof lat !== 'number' || !date || !data) {
    return null;
  }

  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return null;

  let name: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let altitudeM: number | null = null;

  let airTemperatureC: number | null = null;
  let relativeHumidityPct: number | null = null;
  let precipitationMm: number | null = null;
  let precipitationWindowS: number | null = null;

  for (const block of data) {
    const { timerange, level, vars } = block;

    // Blocco di intestazione: nessun timerange, contiene l'anagrafica.
    if (!timerange) {
      name = str(vars[B.STATION_NAME]) ?? name;
      latitude = num(vars[B.LATITUDE]) ?? latitude;
      longitude = num(vars[B.LONGITUDE]) ?? longitude;
      altitudeM = num(vars[B.STATION_HEIGHT]) ?? altitudeM;
      continue;
    }

    const [kind, , windowS] = timerange;

    if (isGround(level) && kind === TIMERANGE_KIND.ACCUMULATION) {
      const mm = num(vars[B.PRECIPITATION]);
      // Teniamo solo le cumulate sotto-giornaliere: i giornalieri già
      // pubblicati usano due convenzioni diverse (00:00Z e 08:00Z) e non
      // sono confrontabili fra loro.
      if (mm !== null && windowS > 0 && windowS < 86_400) {
        // A parità di riga può esserci più di una finestra: teniamo la più
        // fine, la scelta definitiva la fa l'aggregatore per stazione.
        if (precipitationWindowS === null || windowS < precipitationWindowS) {
          precipitationMm = mm;
          precipitationWindowS = windowS;
        }
      }
      continue;
    }

    if (isTwoMetres(level) && kind === TIMERANGE_KIND.INSTANT) {
      const kelvin = num(vars[B.AIR_TEMPERATURE]);
      if (kelvin !== null) airTemperatureC = kelvin - KELVIN_OFFSET;
      const rh = num(vars[B.RELATIVE_HUMIDITY]);
      if (rh !== null) relativeHumidityPct = rh;
    }
  }

  if (!name || latitude === null || longitude === null) return null;

  return {
    station: {
      externalId: arpaeExternalId(network, lon, lat),
      name,
      network,
      latitude,
      longitude,
      altitudeM,
    },
    at,
    airTemperatureC,
    relativeHumidityPct,
    precipitationMm,
    precipitationWindowS,
  };
}
