import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WATER_BALANCE_PARAMS,
  runWaterBalance,
  type WaterBalanceDayInput,
} from './balance.js';

function series(
  days: number,
  fn: (i: number) => { precipitationMm: number; etoMm: number },
): WaterBalanceDayInput[] {
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)),
    ...fn(i),
  }));
}

describe('runWaterBalance', () => {
  it('mantiene lo SWI dentro [0, 1] e non supera mai la riserva utile', () => {
    const out = runWaterBalance(
      series(120, (i) => ({ precipitationMm: i % 3 === 0 ? 40 : 0, etoMm: 4 })),
    );
    for (const day of out) {
      expect(day.swi).toBeGreaterThanOrEqual(0);
      expect(day.swi).toBeLessThanOrEqual(1);
      expect(day.soilWaterMm).toBeLessThanOrEqual(DEFAULT_WATER_BALANCE_PARAMS.awcMm);
    }
  });

  it('registra come ruscellamento l acqua che eccede la capacita', () => {
    const out = runWaterBalance(
      series(1, () => ({ precipitationMm: 200, etoMm: 0 })),
      {
        awcMm: 100,
        initialSwi: 0.5,
      },
    );
    const day = out[0]!;
    expect(day.soilWaterMm).toBe(100);
    expect(day.runoffMm).toBeCloseTo(150, 6); // 50 gia presenti + 200 - 100 di capienza
  });

  it('chiude il bilancio di massa ogni giorno', () => {
    const input = series(60, (i) => ({ precipitationMm: i % 5 === 0 ? 22 : 0, etoMm: 3.5 }));
    const out = runWaterBalance(input, { awcMm: 120, initialSwi: 0.4 });

    let previous = 0.4 * 120;
    for (let i = 0; i < out.length; i += 1) {
      const day = out[i]!;
      const inp = input[i]!;
      expect(day.soilWaterMm).toBeCloseTo(
        previous + inp.precipitationMm - day.actualEtMm - day.runoffMm,
        6,
      );
      previous = day.soilWaterMm;
    }
  });

  it('svuota il serbatoio in siccita prolungata, senza mai andare sotto zero', () => {
    const out = runWaterBalance(
      series(200, () => ({ precipitationMm: 0, etoMm: 5 })),
      {
        initialSwi: 1,
      },
    );
    const last = out.at(-1)!;
    expect(last.swi).toBeLessThan(0.05);
    expect(last.soilWaterMm).toBeGreaterThanOrEqual(0);
  });

  it('rallenta l evapotraspirazione quando il suolo e secco', () => {
    const wet = runWaterBalance(
      series(1, () => ({ precipitationMm: 0, etoMm: 5 })),
      { initialSwi: 1 },
    );
    const dry = runWaterBalance(
      series(1, () => ({ precipitationMm: 0, etoMm: 5 })),
      { initialSwi: 0.2 },
    );
    expect(dry[0]!.actualEtMm).toBeLessThan(wet[0]!.actualEtMm);
  });

  /**
   * Il test che giustifica l'esistenza di questo modulo: la pioggia cumulata
   * da sola non basta. 150 mm di temporali estivi lasciano il suolo piu secco
   * di 80 mm di pioggia autunnale, perche' in agosto l'ETo se li mangia.
   */
  it('150 mm in agosto lasciano il suolo piu secco di 80 mm in ottobre', () => {
    const agosto = runWaterBalance(
      series(30, (i) => ({ precipitationMm: i === 0 || i === 14 ? 75 : 0, etoMm: 6 })),
      { initialSwi: 0.5 },
    );
    const ottobre = runWaterBalance(
      series(30, (i) => ({ precipitationMm: i < 10 ? 8 : 0, etoMm: 1.5 })),
      { initialSwi: 0.5 },
    );

    const swiAgosto = agosto.at(-1)!.swi;
    const swiOttobre = ottobre.at(-1)!.swi;

    expect(swiOttobre).toBeGreaterThan(swiAgosto);
    expect(swiOttobre).toBeGreaterThan(0.7); // fruttificazione plausibile
    expect(swiAgosto).toBeLessThan(0.6);
  });

  it('marca la finestra di spin-up', () => {
    const out = runWaterBalance(series(90, () => ({ precipitationMm: 2, etoMm: 2 })));
    expect(out[0]!.warmup).toBe(true);
    expect(out[59]!.warmup).toBe(true);
    expect(out[60]!.warmup).toBe(false);
  });

  it('rifiuta parametri non fisici', () => {
    expect(() => runWaterBalance([], { awcMm: 0 })).toThrow(RangeError);
    expect(() => runWaterBalance([], { kc: -1 })).toThrow(RangeError);
  });
});
