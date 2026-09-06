import { describe, expect, it } from 'vitest';
import {
  gaussian,
  linearRamp,
  saturating,
  trapezoid,
  weightedGeometricMean,
} from './membership.js';

// Parametri di temperatura del suolo del profilo porcino: ottimo 11-16 °C.
const SOIL_T = { a: 6, b: 11, c: 16, d: 21 };

describe('trapezoid', () => {
  it('azzera fuori dal supporto', () => {
    expect(trapezoid(6, SOIL_T)).toBe(0);
    expect(trapezoid(3, SOIL_T)).toBe(0);
    expect(trapezoid(21, SOIL_T)).toBe(0);
    expect(trapezoid(30, SOIL_T)).toBe(0);
  });

  it('vale 1 su tutto il plateau', () => {
    expect(trapezoid(11, SOIL_T)).toBe(1);
    expect(trapezoid(13.2, SOIL_T)).toBe(1); // ottimo di Brejon & Hoffman 2025
    expect(trapezoid(16, SOIL_T)).toBe(1); // il valore indicato da Stefano
  });

  it('sale e scende linearmente sulle rampe', () => {
    expect(trapezoid(8.5, SOIL_T)).toBeCloseTo(0.5, 10);
    expect(trapezoid(18.5, SOIL_T)).toBeCloseTo(0.5, 10);
  });

  it('accetta rampe degeneri (soglia netta)', () => {
    expect(trapezoid(5, { a: 5, b: 5, c: 10, d: 10 })).toBe(0);
    expect(trapezoid(7, { a: 5, b: 5, c: 10, d: 10 })).toBe(1);
  });

  it('rifiuta parametri non ordinati', () => {
    expect(() => trapezoid(1, { a: 5, b: 2, c: 10, d: 12 })).toThrow(RangeError);
  });

  it('resta in [0, 1] su tutto il dominio', () => {
    for (let x = -50; x <= 50; x += 0.25) {
      const y = trapezoid(x, SOIL_T);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe('gaussian', () => {
  it('vale 1 nel centro e ~0.607 a una sigma', () => {
    expect(gaussian(13.2, { mu: 13.2, sigma: 4 })).toBe(1);
    expect(gaussian(17.2, { mu: 13.2, sigma: 4 })).toBeCloseTo(Math.exp(-0.5), 10);
  });

  it('rifiuta sigma non positiva', () => {
    expect(() => gaussian(1, { mu: 0, sigma: 0 })).toThrow(RangeError);
  });
});

describe('saturating', () => {
  it('parte da 0 e cresce monotona senza superare 1', () => {
    expect(saturating(0, { ref: 90 })).toBe(0);
    expect(saturating(-10, { ref: 90 })).toBe(0);
    expect(saturating(90, { ref: 90 })).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(saturating(10_000, { ref: 90 })).toBeLessThanOrEqual(1);
  });

  it('ha rendimenti decrescenti', () => {
    const first = saturating(50, { ref: 90 }) - saturating(0, { ref: 90 });
    const second = saturating(100, { ref: 90 }) - saturating(50, { ref: 90 });
    expect(second).toBeLessThan(first);
  });
});

describe('linearRamp', () => {
  it('gestisce rampe crescenti e decrescenti', () => {
    expect(linearRamp(300, { from: 300, to: 1200 })).toBe(0);
    expect(linearRamp(750, { from: 300, to: 1200 })).toBeCloseTo(0.5, 10);
    expect(linearRamp(1500, { from: 300, to: 1200 })).toBe(1);
    expect(linearRamp(5, { from: 10, to: 0 })).toBeCloseTo(0.5, 10);
  });
});

describe('weightedGeometricMean', () => {
  it('un solo fattore nullo azzera il risultato (legge del minimo)', () => {
    expect(
      weightedGeometricMean([
        { value: 1, weight: 1 },
        { value: 1, weight: 1 },
        { value: 0, weight: 0.1 },
      ]),
    ).toBe(0);
  });

  it('penalizza piu della media aritmetica', () => {
    const terms = [
      { value: 1, weight: 1 },
      { value: 0.2, weight: 1 },
    ];
    const arithmetic = 0.6;
    expect(weightedGeometricMean(terms)).toBeLessThan(arithmetic);
    expect(weightedGeometricMean(terms)).toBeCloseTo(Math.sqrt(0.2), 10);
  });

  it('ignora i termini a peso zero', () => {
    expect(
      weightedGeometricMean([
        { value: 0.5, weight: 1 },
        { value: 0, weight: 0 },
      ]),
    ).toBeCloseTo(0.5, 10);
  });

  it('rifiuta pesi negativi', () => {
    expect(() => weightedGeometricMean([{ value: 1, weight: -1 }])).toThrow(RangeError);
  });
});
