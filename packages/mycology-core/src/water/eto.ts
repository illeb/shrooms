/**
 * Evapotraspirazione di riferimento con il metodo di Hargreaves-Samani.
 *
 * Scelta deliberata: richiede solo Tmin, Tmax, latitudine e giorno dell'anno.
 * Sono esattamente le variabili che ogni stazione Arpae pubblica, quindi il
 * bilancio idrico gira anche dove non abbiamo radiazione, vento o umidità.
 *
 * Riferimento: Allen et al., FAO Irrigation & Drainage Paper 56, eq. 21-25 e 52.
 */

/** Costante solare, MJ m^-2 min^-1 (FAO-56). */
const SOLAR_CONSTANT = 0.082;

/** Fattore di conversione da MJ m^-2 giorno^-1 a mm giorno^-1 (FAO-56 tab. 4). */
const MJ_TO_MM = 0.408;

const DEG_TO_RAD = Math.PI / 180;

export interface ExtraterrestrialRadiationInput {
  /** Latitudine in gradi decimali; positiva a nord. */
  latitudeDeg: number;
  /** Giorno dell'anno, 1..366. */
  dayOfYear: number;
}

/**
 * Radiazione extraterrestre giornaliera `Ra`, in MJ m^-2 giorno^-1 (FAO-56 eq. 21).
 *
 * È puramente astronomica: dipende solo da dove e quando, mai dal meteo.
 */
export function extraterrestrialRadiation({
  latitudeDeg,
  dayOfYear,
}: ExtraterrestrialRadiationInput): number {
  if (dayOfYear < 1 || dayOfYear > 366) {
    throw new RangeError(`extraterrestrialRadiation: dayOfYear fuori range (${dayOfYear})`);
  }
  if (latitudeDeg < -90 || latitudeDeg > 90) {
    throw new RangeError(`extraterrestrialRadiation: latitudine fuori range (${latitudeDeg})`);
  }

  const phi = latitudeDeg * DEG_TO_RAD;

  // Distanza relativa inversa Terra-Sole (eq. 23).
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);

  // Declinazione solare, rad (eq. 24).
  const delta = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);

  // Angolo orario al tramonto (eq. 25). Il clamp copre notte/giorno polare,
  // dove -tan(phi)tan(delta) esce da [-1, 1].
  const cosOmega = Math.min(Math.max(-Math.tan(phi) * Math.tan(delta), -1), 1);
  const omegaS = Math.acos(cosOmega);

  return (
    ((24 * 60) / Math.PI) *
    SOLAR_CONSTANT *
    dr *
    (omegaS * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(omegaS))
  );
}

export interface HargreavesInput {
  tMinC: number;
  tMaxC: number;
  /** Se omessa si usa (tMin + tMax) / 2. */
  tMeanC?: number;
  latitudeDeg: number;
  dayOfYear: number;
}

/**
 * ETo giornaliera in mm, Hargreaves-Samani (FAO-56 eq. 52):
 *
 *   ETo = 0.0023 * Ra[mm/g] * (Tmean + 17.8) * sqrt(Tmax - Tmin)
 *
 * Ritorna 0 (mai un valore negativo) quando l'escursione termica è nulla o i
 * dati sono incoerenti: in un bilancio idrico un ETo negativo creerebbe acqua
 * dal nulla.
 */
export function hargreavesEto({
  tMinC,
  tMaxC,
  tMeanC,
  latitudeDeg,
  dayOfYear,
}: HargreavesInput): number {
  if (!Number.isFinite(tMinC) || !Number.isFinite(tMaxC)) return 0;

  const range = tMaxC - tMinC;
  if (range <= 0) return 0;

  const mean = tMeanC ?? (tMinC + tMaxC) / 2;
  const raMm = MJ_TO_MM * extraterrestrialRadiation({ latitudeDeg, dayOfYear });

  const eto = 0.0023 * raMm * (mean + 17.8) * Math.sqrt(range);
  return eto > 0 ? eto : 0;
}

/** Giorno dell'anno (1..366) di una data, in UTC. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((current - start) / 86_400_000);
}
