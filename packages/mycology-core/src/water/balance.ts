/**
 * Bilancio idrico del suolo a serbatoio singolo ("bucket model").
 *
 * È la traduzione quantitativa di "precipitazione cumulata **e residua al
 * suolo**": 150 mm caduti in agosto evaporano, 80 mm caduti in ottobre
 * restano. Sommare la pioggia degli ultimi N giorni non distingue i due casi,
 * questo modello sì.
 *
 *   W(t)   = clamp( W(t-1) + P(t) - ETa(t), 0, AWC )
 *   ETa(t) = ETo(t) * Kc * ( W(t-1) / AWC )
 *   SWI(t) = W(t) / AWC
 *
 * Il fattore W(t-1)/AWC è uno stress idrico lineare: più il suolo è secco,
 * meno riesce a evaporare. È l'approssimazione standard (FAO-56 cap. 8) ed è
 * sufficiente finché non abbiamo dati di umidità del suolo misurati.
 */

import { clamp } from '../math/membership.js';

export interface WaterBalanceParams {
  /**
   * Riserva idrica utile della zona radicale, in mm.
   * Default 120 mm ≈ suolo forestale con ~60 cm di zona radicale.
   */
  awcMm: number;
  /** Coefficiente colturale del soprassuolo. Default 0.85 per bosco. */
  kc: number;
  /** Riempimento iniziale del serbatoio, in frazione di AWC. */
  initialSwi: number;
}

export const DEFAULT_WATER_BALANCE_PARAMS: WaterBalanceParams = {
  awcMm: 120,
  kc: 0.85,
  initialSwi: 0.5,
};

/**
 * Giorni di "riscaldamento" da scartare prima di fidarsi dell'output: dopo
 * ~60 giorni la condizione iniziale arbitraria è stata dimenticata.
 */
export const WATER_BALANCE_SPINUP_DAYS = 60;

export interface WaterBalanceDayInput {
  date: Date;
  /** Precipitazione giornaliera, mm. */
  precipitationMm: number;
  /** ETo giornaliera, mm. Calcolabile con `hargreavesEto`. */
  etoMm: number;
}

export interface WaterBalanceDayOutput {
  date: Date;
  /** Acqua nel serbatoio a fine giornata, mm. */
  soilWaterMm: number;
  /** Soil Water Index: soilWaterMm / awcMm, in [0, 1]. */
  swi: number;
  /** Evapotraspirazione effettivamente avvenuta, mm. */
  actualEtMm: number;
  /** Acqua persa perché il serbatoio era pieno (ruscellamento + percolazione), mm. */
  runoffMm: number;
  /** `true` finché siamo dentro la finestra di spin-up: valore non affidabile. */
  warmup: boolean;
}

/**
 * Esegue il bilancio su una serie giornaliera **contigua e ordinata**.
 *
 * I giorni mancanti non vengono interpolati: chi chiama deve avere già colmato
 * i buchi (dalla sorgente modellata) o accettare che il serbatoio non evapori
 * nei giorni assenti.
 */
export function runWaterBalance(
  days: readonly WaterBalanceDayInput[],
  params: Partial<WaterBalanceParams> = {},
): WaterBalanceDayOutput[] {
  const { awcMm, kc, initialSwi } = { ...DEFAULT_WATER_BALANCE_PARAMS, ...params };

  if (awcMm <= 0) throw new RangeError(`runWaterBalance: awcMm deve essere > 0, ricevuto ${awcMm}`);
  if (kc <= 0) throw new RangeError(`runWaterBalance: kc deve essere > 0, ricevuto ${kc}`);

  let water = clamp(initialSwi, 0, 1) * awcMm;
  const out: WaterBalanceDayOutput[] = [];

  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    if (day === undefined) continue;

    const precipitation = Number.isFinite(day.precipitationMm)
      ? Math.max(day.precipitationMm, 0)
      : 0;
    const eto = Number.isFinite(day.etoMm) ? Math.max(day.etoMm, 0) : 0;

    // Lo stress si valuta sul contenuto d'acqua di inizio giornata.
    const stress = clamp(water / awcMm, 0, 1);
    const actualEt = Math.min(eto * kc * stress, water);

    const raw = water + precipitation - actualEt;
    const runoff = Math.max(raw - awcMm, 0);
    water = clamp(raw, 0, awcMm);

    out.push({
      date: day.date,
      soilWaterMm: water,
      swi: water / awcMm,
      actualEtMm: actualEt,
      runoffMm: runoff,
      warmup: i < WATER_BALANCE_SPINUP_DAYS,
    });
  }

  return out;
}
