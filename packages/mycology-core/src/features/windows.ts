/**
 * Finestre mobili "right-aligned": ogni valore riassume i N giorni che
 * *precedono* la data, quella inclusa.
 *
 * L'allineamento a destra non e' un dettaglio: e' la forma in cui Brejon
 * Lamartiniere & Hoffman (2025) hanno trovato il segnale, perche' cio' che
 * conta e' il meteo che ha preceduto la fruttificazione, non quello che la
 * circonda.
 */

/** Serie giornaliera contigua: un elemento per giorno, `null` dove il dato manca. */
export type DailySeries = ReadonlyArray<number | null>;

/**
 * Copertura minima di una finestra per considerarla valida.
 *
 * Sotto questa soglia si restituisce `null` invece di una somma calcolata su
 * meta' dei giorni, che sarebbe indistinguibile da un periodo davvero secco.
 */
const MIN_WINDOW_COVERAGE = 0.7;

function windowSlice(index: number, days: number): { start: number; end: number } {
  return { start: Math.max(0, index - days + 1), end: index + 1 };
}

/** Somma sui `days` giorni fino a `index` incluso. `null` se troppi buchi. */
export function trailingSum(series: DailySeries, index: number, days: number): number | null {
  const { start, end } = windowSlice(index, days);
  let sum = 0;
  let present = 0;

  for (let i = start; i < end; i += 1) {
    const v = series[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    sum += v;
    present += 1;
  }

  const expected = end - start;
  if (expected < days || present < expected * MIN_WINDOW_COVERAGE) return null;
  return Math.round(sum * 100) / 100;
}

/** Media sui `days` giorni fino a `index` incluso. `null` se troppi buchi. */
export function trailingMean(series: DailySeries, index: number, days: number): number | null {
  const { start, end } = windowSlice(index, days);
  let sum = 0;
  let present = 0;

  for (let i = start; i < end; i += 1) {
    const v = series[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    sum += v;
    present += 1;
  }

  const expected = end - start;
  if (expected < days || present < expected * MIN_WINDOW_COVERAGE || present === 0) return null;
  return Math.round((sum / present) * 100) / 100;
}

/**
 * Quanti giorni consecutivi, fino a `index` incluso, soddisfano il predicato.
 *
 * Usato per le strisce: giorni di siccita', di gelo, di caldo eccessivo.
 * Un giorno con dato mancante interrompe il conteggio invece di prolungarlo:
 * non sappiamo cosa sia successo, e non vogliamo inventarlo.
 */
export function trailingStreak(
  series: DailySeries,
  index: number,
  predicate: (value: number) => boolean,
): number {
  let streak = 0;
  for (let i = index; i >= 0; i -= 1) {
    const v = series[i];
    if (v === null || v === undefined || !Number.isFinite(v)) break;
    if (!predicate(v)) break;
    streak += 1;
  }
  return streak;
}

/** Quanti giorni nella finestra soddisfano il predicato (non consecutivi). */
export function trailingCount(
  series: DailySeries,
  index: number,
  days: number,
  predicate: (value: number) => boolean,
): number {
  const { start, end } = windowSlice(index, days);
  let count = 0;
  for (let i = start; i < end; i += 1) {
    const v = series[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (predicate(v)) count += 1;
  }
  return count;
}

/**
 * Shock termico: di quanto si e' abbassata la temperatura.
 *
 * Differenza fra la media dei giorni `[-10, -6]` e quella dei giorni `[-4, 0]`.
 * Positivo = si e' raffreddato. E' il "calo delle temperature notturne dopo il
 * caldo" che Martinez-Pena et al. (2012) citano fra i fattori che governano
 * l'emergenza, e che ogni cercatore conosce.
 */
export function thermalShock(series: DailySeries, index: number): number | null {
  const before = meanBetween(series, index - 10, index - 6);
  const now = meanBetween(series, index - 4, index);
  if (before === null || now === null) return null;
  return Math.round((before - now) * 10) / 10;
}

function meanBetween(series: DailySeries, from: number, to: number): number | null {
  if (from < 0) return null;
  let sum = 0;
  let present = 0;
  for (let i = from; i <= to; i += 1) {
    const v = series[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    sum += v;
    present += 1;
  }
  const expected = to - from + 1;
  if (present < expected * MIN_WINDOW_COVERAGE || present === 0) return null;
  return sum / present;
}
