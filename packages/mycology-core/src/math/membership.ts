/**
 * Funzioni di appartenenza: i mattoni con cui il profilo di specie traduce
 * una feature meteo grezza in un punteggio adimensionale in [0, 1].
 *
 * Sono volutamente elementari e con parametri leggibili: un profilo di specie
 * si tara spostando questi numeri, non riscrivendo codice.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export interface TrapezoidParams {
  /** Sotto questa soglia il punteggio è 0. */
  a: number;
  /** Inizio del plateau ottimale. */
  b: number;
  /** Fine del plateau ottimale. */
  c: number;
  /** Sopra questa soglia il punteggio è 0. */
  d: number;
}

/**
 * Trapezio: 0 fuori da [a, d], rampa lineare su [a, b] e [c, d], 1 sul plateau [b, c].
 *
 * Preferito alla gaussiana perché i quattro parametri hanno un significato
 * immediato ("sotto 6 °C niente, ottimo fra 11 e 16, sopra 21 niente").
 */
export function trapezoid(x: number, { a, b, c, d }: TrapezoidParams): number {
  if (!(a <= b && b <= c && c <= d)) {
    throw new RangeError(
      `trapezoid: attesi a <= b <= c <= d, ricevuti a=${a} b=${b} c=${c} d=${d}`,
    );
  }
  if (!Number.isFinite(x)) return 0;
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

export interface GaussianParams {
  /** Centro della campana (l'ottimo). */
  mu: number;
  /** Ampiezza: a mu ± sigma il punteggio vale ~0.61. */
  sigma: number;
}

/** Variante liscia del trapezio, per quando serve una transizione morbida. */
export function gaussian(x: number, { mu, sigma }: GaussianParams): number {
  if (sigma <= 0) throw new RangeError(`gaussian: sigma deve essere > 0, ricevuto ${sigma}`);
  if (!Number.isFinite(x)) return 0;
  return Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));
}

export interface SaturatingParams {
  /** Valore a cui il punteggio raggiunge ~0.63; controlla quanto "presto" satura. */
  ref: number;
}

/**
 * Curva saturante `1 - exp(-x / ref)`: cresce monotona e si appiattisce.
 *
 * Usata dove "di più è meglio, ma con rendimenti decrescenti": pioggia
 * cumulata, magnitudine di un evento di bagnatura.
 */
export function saturating(x: number, { ref }: SaturatingParams): number {
  if (ref <= 0) throw new RangeError(`saturating: ref deve essere > 0, ricevuto ${ref}`);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return 1 - Math.exp(-x / ref);
}

export interface LinearRampParams {
  /** Valore a cui il punteggio è 0. */
  from: number;
  /** Valore a cui il punteggio è 1. */
  to: number;
}

/** Rampa lineare fra due estremi; `from > to` produce una rampa decrescente. */
export function linearRamp(x: number, { from, to }: LinearRampParams): number {
  if (from === to) throw new RangeError('linearRamp: from e to non possono coincidere');
  if (!Number.isFinite(x)) return 0;
  return clamp01((x - from) / (to - from));
}

/**
 * Media geometrica pesata: la composizione "alla Liebig" usata dal motore.
 *
 * A differenza della media aritmetica, un singolo fattore a 0 azzera il
 * risultato — che è esattamente il comportamento voluto: se manca l'acqua,
 * non importa quanto sia perfetta la temperatura.
 */
export function weightedGeometricMean(
  terms: ReadonlyArray<{ value: number; weight: number }>,
): number {
  if (terms.length === 0) return 1;

  let weightSum = 0;
  for (const t of terms) {
    if (t.weight < 0) throw new RangeError(`weightedGeometricMean: peso negativo (${t.weight})`);
    weightSum += t.weight;
  }
  if (weightSum === 0) return 1;

  let logSum = 0;
  for (const t of terms) {
    if (t.weight === 0) continue;
    if (t.value <= 0) return 0;
    logSum += t.weight * Math.log(clamp01(t.value));
  }
  return Math.exp(logSum / weightSum);
}
