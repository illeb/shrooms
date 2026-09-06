/**
 * Modello di resa stagionale di Martinez-Pena et al. (2012),
 * Forest Ecology and Management 282:63-69.
 *
 *   Boletus = exp(-14.706 + 0.007*P_aut + 0.129*T_aut + 5.049*ln(G) - 0.121*G)
 *
 * E' il primo modello pubblicato per B. edulis, ricavato da 18 plot permanenti
 * in pineta di Pinus sylvestris a Soria, con quindici anni consecutivi di
 * raccolta settimanale.
 *
 * Due avvertenze che vanno riportate ovunque si mostri questo numero:
 *
 *  1. **R^2 = 0.222, RMSE = 43.2 kg/ha/anno.** Spiega un quinto della varianza.
 *     E' un ordine di grandezza, non una misura.
 *  2. **`G` non lo conosciamo.** L'area basimetrica e' una variabile di
 *     inventario forestale che nessun dato meteo contiene. Il default e'
 *     l'ottimo del modello, il che rende il termine in `G` una costante: il
 *     numero dice "quanto renderebbe un bosco ideale con questo meteo".
 *
 * Vive accanto al motore di scoring come **secondo parere indipendente**, non
 * come sua componente: lo scoring dice "oggi le condizioni ci sono", questo
 * dice "questa stagione, nel complesso, quanto vale".
 */

import type { YieldModelSpec } from '../types.js';

/**
 * Area basimetrica che massimizza la resa, m^2/ha.
 *
 * E' il punto in cui si annulla la derivata di `5.049*ln(G) - 0.121*G`,
 * cioe' 5.049/0.121. Gli autori la indicano come 40-45 m^2/ha.
 */
export const OPTIMAL_BASAL_AREA = 5.049 / 0.121;

/** Coefficienti pubblicati per B. edulis. */
export const MARTINEZ_PENA_BOLETUS: YieldModelSpec = {
  enabled: true,
  basalArea: 40,
  coefficients: {
    intercept: -14.706,
    pAutumn: 0.007,
    tAutumn: 0.129,
    lnG: 5.049,
    g: -0.121,
  },
};

/** Bonta' del modello, da riportare insieme al risultato. */
export const MARTINEZ_PENA_FIT = { rSquared: 0.222, rmseKgHa: 43.2 } as const;

export interface AutumnAggregates {
  /** Somma delle precipitazioni di agosto + settembre + ottobre, mm. */
  precipitationAugSepOctMm: number;
  /** Somma delle temperature medie mensili di settembre + ottobre + novembre, C. */
  temperatureSepOctNovC: number;
}

/**
 * Resa annua attesa di B. edulis, kg/ha/anno (peso fresco).
 *
 * Lo sfasamento di un mese fra le due finestre e' deliberato negli autori:
 * prima serve l'acqua (ago-ott), poi servono le temperature giuste (set-nov).
 * Prima l'acqua, poi il termometro.
 */
export function estimateSeasonalYield(
  aggregates: AutumnAggregates,
  spec: YieldModelSpec = MARTINEZ_PENA_BOLETUS,
): number {
  const { intercept, pAutumn, tAutumn, lnG, g } = spec.coefficients;
  const G = spec.basalArea;

  if (G <= 0)
    throw new RangeError(`estimateSeasonalYield: basalArea deve essere > 0, ricevuto ${G}`);

  const exponent =
    intercept +
    pAutumn * aggregates.precipitationAugSepOctMm +
    tAutumn * aggregates.temperatureSepOctNovC +
    lnG * Math.log(G) +
    g * G;

  return Math.round(Math.exp(exponent) * 10) / 10;
}

/**
 * Aggrega una serie giornaliera nelle due finestre che il modello richiede.
 *
 * Ritorna `null` se una delle due finestre non e' coperta: un autunno a meta'
 * darebbe un numero senza significato.
 */
export function autumnAggregates(
  days: ReadonlyArray<{ date: Date; precipMm?: number | null; tMeanC?: number | null }>,
  year: number,
): AutumnAggregates | null {
  const rainMonths = new Set([8, 9, 10]); // agosto, settembre, ottobre
  const tempMonths = new Set([9, 10, 11]); // settembre, ottobre, novembre

  let rain = 0;
  let rainDays = 0;
  const monthlyTemp = new Map<number, { sum: number; count: number }>();

  for (const d of days) {
    if (d.date.getUTCFullYear() !== year) continue;
    const month = d.date.getUTCMonth() + 1;

    if (rainMonths.has(month) && typeof d.precipMm === 'number') {
      rain += d.precipMm;
      rainDays += 1;
    }

    if (tempMonths.has(month) && typeof d.tMeanC === 'number') {
      const acc = monthlyTemp.get(month) ?? { sum: 0, count: 0 };
      acc.sum += d.tMeanC;
      acc.count += 1;
      monthlyTemp.set(month, acc);
    }
  }

  // Copertura minima: 80% dei giorni delle due finestre.
  if (rainDays < 92 * 0.8) return null;
  if (monthlyTemp.size < 3) return null;

  let temperature = 0;
  for (const month of tempMonths) {
    const acc = monthlyTemp.get(month);
    if (!acc || acc.count < 20) return null;
    temperature += acc.sum / acc.count;
  }

  return {
    precipitationAugSepOctMm: Math.round(rain * 10) / 10,
    temperatureSepOctNovC: Math.round(temperature * 10) / 10,
  };
}
