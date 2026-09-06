/**
 * Costruzione del feature store.
 *
 * Da una serie giornaliera grezza (aria, pioggia, suolo) alle ~30 feature che
 * il motore di scoring sa leggere. Funzione pura: nessun I/O, nessun database,
 * cosi' un backtest su una stagione intera gira in memoria e in millisecondi.
 */

import { dayOfYear, hargreavesEto } from '../water/eto.js';
import { runWaterBalance, WATER_BALANCE_SPINUP_DAYS } from '../water/balance.js';
import { writeFeature, type DailyFeatures, type FeatureKey } from '../types.js';
import {
  thermalShock,
  trailingCount,
  trailingMean,
  trailingStreak,
  trailingSum,
  type DailySeries,
} from './windows.js';

/** Un giorno di osservazioni gia' fuse fra le sorgenti. */
export interface DailyInput {
  date: Date;
  tMeanC?: number | null;
  tMinC?: number | null;
  tMaxC?: number | null;
  precipMm?: number | null;
  rhMeanPct?: number | null;
  soilT0To7C?: number | null;
  soilT7To28C?: number | null;
  soilMoisture0To7?: number | null;
}

export interface SiteParams {
  latitudeDeg: number;
  altitudeM?: number | null;
  /** Riserva idrica utile del suolo, mm. */
  awcMm: number;
  /** Coefficiente colturale del soprassuolo. */
  kc: number;
}

/** Soglie usate per contare le strisce di condizioni avverse. */
export const STREAK_THRESHOLDS = {
  /** Sotto questo SWI il suolo e' considerato secco. */
  droughtSwi: 0.25,
  /** Sopra questa temperatura dell'aria la giornata e' "di caldo". */
  heatTMaxC: 28,
  /** Sotto questa minima si conta una gelata. */
  frostTMinC: 0,
} as const;

function toSeries<K extends keyof DailyInput>(
  days: readonly DailyInput[],
  key: K,
): Array<number | null> {
  return days.map((d) => {
    const v = d[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
}

/**
 * Calcola le feature giornaliere.
 *
 * `days` deve essere **contiguo e ordinato**: un giorno per elemento, con i
 * campi a `null` dove il dato manca. I buchi non vengono interpolati; le
 * finestre mobili che non raggiungono la copertura minima restituiscono `null`
 * e le regole che vi si appoggiano vengono semplicemente saltate.
 */
export function buildDailyFeatures(days: readonly DailyInput[], site: SiteParams): DailyFeatures[] {
  if (days.length === 0) return [];

  const tMean = toSeries(days, 'tMeanC');
  const tMin = toSeries(days, 'tMinC');
  const tMax = toSeries(days, 'tMaxC');
  const precip = toSeries(days, 'precipMm');
  const soilT = toSeries(days, 'soilT0To7C');

  // ETo da Hargreaves: servono solo Tmin/Tmax/latitudine/giorno, cioe' quello
  // che ogni stazione pubblica. Nessuna dipendenza da Open-Meteo.
  const eto = days.map((d, i) => {
    const lo = tMin[i];
    const hi = tMax[i];
    if (lo === null || lo === undefined || hi === null || hi === undefined) return 0;
    return hargreavesEto({
      tMinC: lo,
      tMaxC: hi,
      ...(tMean[i] === null || tMean[i] === undefined ? {} : { tMeanC: tMean[i] as number }),
      latitudeDeg: site.latitudeDeg,
      dayOfYear: dayOfYear(d.date),
    });
  });

  const balance = runWaterBalance(
    days.map((d, i) => ({
      date: d.date,
      precipitationMm: precip[i] ?? 0,
      etoMm: eto[i] ?? 0,
    })),
    { awcMm: site.awcMm, kc: site.kc },
  );

  const swiSeries: Array<number | null> = balance.map((b) => b.swi);

  return days.map((day, i) => {
    const bal = balance[i];

    const features: DailyFeatures = {
      date: day.date,
      doy: dayOfYear(day.date),
      warmup: i < WATER_BALANCE_SPINUP_DAYS,
    };

    if (site.altitudeM !== null && site.altitudeM !== undefined) {
      features.altitude = site.altitudeM;
    }

    writeFeature(features, 'tMean', tMean[i]);
    writeFeature(features, 'tMin', tMin[i]);
    writeFeature(features, 'tMax', tMax[i]);
    writeFeature(features, 'precip', precip[i]);
    writeFeature(features, 'rh', toNumber(day.rhMeanPct));
    writeFeature(features, 'soilT0_7', soilT[i]);
    writeFeature(features, 'soilT7_28', toNumber(day.soilT7To28C));
    writeFeature(features, 'soilMoisture0_7', toNumber(day.soilMoisture0To7));

    if (bal) {
      features.eto = Math.round((eto[i] ?? 0) * 100) / 100;
      features.soilWaterMm = Math.round(bal.soilWaterMm * 10) / 10;
      features.swi = Math.round(bal.swi * 1000) / 1000;
    }

    // Cumulate di pioggia.
    for (const w of [3, 5, 7, 10, 14, 21, 30, 60] as const) {
      writeFeature(features, `p${w}` satisfies FeatureKey, trailingSum(precip, i, w));
    }

    // Medie di temperatura, aria e suolo.
    for (const w of [5, 7, 10] as const) {
      writeFeature(features, `tMean${w}` satisfies FeatureKey, trailingMean(tMean, i, w));
      writeFeature(features, `soilTMean${w}` satisfies FeatureKey, trailingMean(soilT, i, w));
    }

    writeFeature(features, 'thermalShock', thermalShock(soilT[i] === null ? tMean : soilT, i));

    features.droughtStreak = trailingStreak(swiSeries, i, (v) => v < STREAK_THRESHOLDS.droughtSwi);
    features.heatDays = trailingCount(tMax, i, 14, (v) => v > STREAK_THRESHOLDS.heatTMaxC);
    features.frostDays = trailingCount(tMin, i, 10, (v) => v < STREAK_THRESHOLDS.frostTMinC);

    return features;
  });
}

function toNumber(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
