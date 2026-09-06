import { describe, expect, it } from 'vitest';
import {
  autumnAggregates,
  estimateSeasonalYield,
  MARTINEZ_PENA_BOLETUS,
  OPTIMAL_BASAL_AREA,
} from './yield-model.js';

describe('estimateSeasonalYield (Martinez-Pena et al. 2012)', () => {
  it('riproduce il massimo dichiarato dagli autori: ~70 kg/ha in autunno caldo e piovoso', () => {
    // Gli autori: "The expected maximum production for this species
    // (70 kg ha-1 yr-1 in wet and warm autumns) was reached when the stand
    // basal area was 40-45 m2 ha-1".
    // Autunno piovoso = 215 mm (media +30%, dagli scenari di Fig. 5).
    const yieldKgHa = estimateSeasonalYield({
      precipitationAugSepOctMm: 215,
      temperatureSepOctNovC: 28.4,
    });
    expect(yieldKgHa).toBeGreaterThan(60);
    expect(yieldKgHa).toBeLessThan(80);
  });

  it('un autunno secco e freddo rende molto meno di uno caldo e piovoso', () => {
    const wetWarm = estimateSeasonalYield({
      precipitationAugSepOctMm: 215,
      temperatureSepOctNovC: 28.4,
    });
    // Autunno secco = 115 mm (media -30%), e temperature basse.
    const dryCold = estimateSeasonalYield({
      precipitationAugSepOctMm: 115,
      temperatureSepOctNovC: 20,
    });
    expect(dryCold).toBeLessThan(wetWarm / 4);
  });

  it("ha il massimo di resa all'area basimetrica indicata dal paper (40-45 m2/ha)", () => {
    expect(OPTIMAL_BASAL_AREA).toBeGreaterThan(40);
    expect(OPTIMAL_BASAL_AREA).toBeLessThan(45);

    const at = (basalArea: number) =>
      estimateSeasonalYield(
        { precipitationAugSepOctMm: 215, temperatureSepOctNovC: 28.4 },
        { ...MARTINEZ_PENA_BOLETUS, basalArea },
      );

    // Boschi troppo radi e troppo fitti rendono meno: e' la campana di Fig. 5.
    expect(at(OPTIMAL_BASAL_AREA)).toBeGreaterThan(at(20));
    expect(at(OPTIMAL_BASAL_AREA)).toBeGreaterThan(at(70));
  });

  it('cresce con la pioggia e con la temperatura', () => {
    const base = { precipitationAugSepOctMm: 150, temperatureSepOctNovC: 25 };
    expect(estimateSeasonalYield({ ...base, precipitationAugSepOctMm: 250 })).toBeGreaterThan(
      estimateSeasonalYield(base),
    );
    expect(estimateSeasonalYield({ ...base, temperatureSepOctNovC: 30 })).toBeGreaterThan(
      estimateSeasonalYield(base),
    );
  });

  it('rifiuta un area basimetrica non fisica', () => {
    expect(() =>
      estimateSeasonalYield(
        { precipitationAugSepOctMm: 200, temperatureSepOctNovC: 25 },
        { ...MARTINEZ_PENA_BOLETUS, basalArea: 0 },
      ),
    ).toThrow(RangeError);
  });
});

describe('autumnAggregates', () => {
  function season(year: number, precipPerDay: number, tMeanC: number) {
    const days: Array<{ date: Date; precipMm: number; tMeanC: number }> = [];
    for (let month = 7; month <= 11; month += 1) {
      for (let day = 1; day <= 30; day += 1) {
        days.push({ date: new Date(Date.UTC(year, month, day)), precipMm: precipPerDay, tMeanC });
      }
    }
    return days;
  }

  it('somma la pioggia di ago-set-ott e le medie mensili di set-ott-nov', () => {
    const agg = autumnAggregates(season(2025, 2, 12), 2025);
    expect(agg).not.toBeNull();
    // 3 mesi x 30 giorni x 2 mm = 180 mm
    expect(agg!.precipitationAugSepOctMm).toBeCloseTo(180, 0);
    // Somma di 3 medie mensili da 12 C
    expect(agg!.temperatureSepOctNovC).toBeCloseTo(36, 0);
  });

  it('rifiuta una stagione incompleta invece di restituire un numero senza senso', () => {
    const partial = season(2025, 2, 12).slice(0, 40);
    expect(autumnAggregates(partial, 2025)).toBeNull();
  });

  it('ignora gli anni diversi da quello richiesto', () => {
    expect(autumnAggregates(season(2024, 2, 12), 2025)).toBeNull();
  });
});
