import { describe, expect, it } from 'vitest';
import { arpaeExternalId, parseArpaeLine } from './arpae-bufr';
import { ArpaeDailyAggregator, romeDayKey } from './arpae-aggregator';
import { monthsBetween } from './arpae.adapter';

/** Riga reale dal file Arpae 2026-09, ridotta ai blocchi rilevanti. */
const REAL_LINE = JSON.stringify({
  version: '0.1',
  network: 'agrmet',
  ident: null,
  lon: 1003873,
  lat: 4478042,
  date: '2026-09-05T06:15:00Z',
  data: [
    {
      vars: {
        B01019: { v: 'Pieve di Cusignano' },
        B01194: { v: 'agrmet' },
        B05001: { v: 44.78042 },
        B06001: { v: 10.03873 },
        B07030: { v: 277.0 },
      },
    },
    { timerange: [1, 0, 900], level: [1, null, null, null], vars: { B13011: { v: 0.4 } } },
    {
      timerange: [254, 0, 0],
      level: [103, 2000, null, null],
      vars: { B12101: { v: 297.55 }, B13003: { v: 44 } },
    },
  ],
});

describe('parseArpaeLine', () => {
  it('estrae anagrafica, temperatura in Celsius e pioggia', () => {
    const s = parseArpaeLine(REAL_LINE);
    expect(s).not.toBeNull();

    expect(s!.station).toEqual({
      externalId: 'agrmet:1003873:4478042',
      name: 'Pieve di Cusignano',
      network: 'agrmet',
      latitude: 44.78042,
      longitude: 10.03873,
      altitudeM: 277,
    });

    // 297.55 K = 24.4 C
    expect(s!.airTemperatureC).toBeCloseTo(24.4, 1);
    expect(s!.relativeHumidityPct).toBe(44);
    expect(s!.precipitationMm).toBe(0.4);
    expect(s!.precipitationWindowS).toBe(900);
    expect(s!.at.toISOString()).toBe('2026-09-05T06:15:00.000Z');
  });

  it('ignora gli aggregati giornalieri gia pubblicati', () => {
    // Arpae pubblica lo stesso giorno con due convenzioni (00:00Z e 08:00Z)
    // e valori diversi: sommarli sarebbe sbagliato, li scartiamo.
    const line = JSON.stringify({
      network: 'agrmet',
      lon: 1,
      lat: 2,
      date: '2026-09-05T00:00:00Z',
      data: [
        { vars: { B01019: { v: 'X' }, B05001: { v: 44 }, B06001: { v: 10 } } },
        { timerange: [1, 0, 86400], level: [1, null, null, null], vars: { B13011: { v: 12.4 } } },
      ],
    });
    const s = parseArpaeLine(line);
    expect(s!.precipitationMm).toBeNull();
    expect(s!.precipitationWindowS).toBeNull();
  });

  it('ignora la temperatura misurata a quote diverse da 2 m', () => {
    const line = JSON.stringify({
      network: 'x',
      lon: 1,
      lat: 2,
      date: '2026-09-05T00:00:00Z',
      data: [
        { vars: { B01019: { v: 'X' }, B05001: { v: 44 }, B06001: { v: 10 } } },
        { timerange: [254, 0, 0], level: [103, 10000, null, null], vars: { B12101: { v: 300 } } },
      ],
    });
    expect(parseArpaeLine(line)!.airTemperatureC).toBeNull();
  });

  it('sopravvive a valori nulli, righe rotte e anagrafica assente', () => {
    // I valori mancanti sono marcati null: presenti davvero nei file reali.
    const withNull = JSON.stringify({
      network: 'x',
      lon: 1,
      lat: 2,
      date: '2026-09-05T00:00:00Z',
      data: [
        { vars: { B01019: { v: 'X' }, B05001: { v: 44 }, B06001: { v: 10 } } },
        { timerange: [1, 0, 900], level: [1, null, null, null], vars: { B13011: { v: null } } },
      ],
    });
    expect(parseArpaeLine(withNull)!.precipitationMm).toBeNull();

    expect(parseArpaeLine('{ non e json')).toBeNull();
    expect(parseArpaeLine('')).toBeNull();
    // Senza nome stazione non sappiamo a chi attribuire il dato.
    expect(
      parseArpaeLine(
        JSON.stringify({ network: 'x', lon: 1, lat: 2, date: '2026-09-05T00:00:00Z', data: [] }),
      ),
    ).toBeNull();
  });

  it('costruisce un id stabile dalle coordinate intere', () => {
    expect(arpaeExternalId('simnpr', 1003873, 4478042)).toBe('simnpr:1003873:4478042');
  });
});

describe('romeDayKey', () => {
  it('usa il giorno locale italiano, non quello UTC', () => {
    // 22:30 UTC del 4 settembre e' gia' il 5 settembre a Roma (CEST, +2).
    expect(romeDayKey(new Date('2026-09-04T22:30:00Z'))).toBe('2026-09-05');
    expect(romeDayKey(new Date('2026-09-04T21:59:00Z'))).toBe('2026-09-04');
    // In inverno lo scarto e' di un'ora sola (CET, +1).
    expect(romeDayKey(new Date('2026-01-04T23:30:00Z'))).toBe('2026-01-05');
    expect(romeDayKey(new Date('2026-01-04T22:30:00Z'))).toBe('2026-01-04');
  });
});

describe('ArpaeDailyAggregator', () => {
  const station = {
    externalId: 'agrmet:1:2',
    name: 'Test',
    network: 'agrmet',
    latitude: 44.5,
    longitude: 11,
    altitudeM: 700,
  };

  function sample(at: string, over: Partial<Record<string, number | null>> = {}) {
    return {
      station,
      at: new Date(at),
      airTemperatureC: (over['airTemperatureC'] as number | null) ?? null,
      relativeHumidityPct: (over['relativeHumidityPct'] as number | null) ?? null,
      precipitationMm: (over['precipitationMm'] as number | null) ?? null,
      precipitationWindowS: (over['precipitationWindowS'] as number | null) ?? null,
    };
  }

  /**
   * Una giornata locale di misure a 15 minuti: 96 campioni.
   *
   * `startUtc` e' la mezzanotte ITALIANA espressa in UTC: in estate (CEST, +2)
   * il giorno locale 2026-09-10 va dalle 22:00Z del 9 alle 22:00Z del 10.
   * Partire dalla mezzanotte UTC spezzerebbe i campioni fra due giorni locali,
   * che e' esattamente il comportamento voluto dell'aggregatore.
   */
  function fullDay(
    agg: ArpaeDailyAggregator,
    startUtc: string,
    temp: (i: number) => number,
    rainPerStep = 0,
  ) {
    for (let i = 0; i < 96; i += 1) {
      const at = new Date(startUtc).getTime() + i * 15 * 60_000;
      agg.add(
        sample(new Date(at).toISOString(), {
          airTemperatureC: temp(i),
          precipitationMm: rainPerStep,
          precipitationWindowS: 900,
        }),
      );
    }
  }

  it('calcola media, minima, massima e cumulata del giorno', () => {
    const agg = new ArpaeDailyAggregator();
    // Onda termica fra 10 e 20 gradi, piu' 0.5 mm ogni quarto d'ora.
    fullDay(agg, '2026-09-09T22:00:00Z', (i) => 15 + 5 * Math.sin((2 * Math.PI * i) / 96), 0.5);

    const days = agg.finish();
    const target = days.find((d) => d.date.toISOString().startsWith('2026-09-10'));
    expect(target).toBeDefined();
    expect(target!.tMeanC).toBeCloseTo(15, 0);
    expect(target!.tMinC).toBeCloseTo(10, 0);
    expect(target!.tMaxC).toBeCloseTo(20, 0);
    expect(target!.precipMm).toBeCloseTo(48, 1); // 96 x 0.5
  });

  it('non somma finestre di cumulata diverse (niente doppio conteggio)', () => {
    const agg = new ArpaeDailyAggregator();
    // La stazione pubblica sia i 15 minuti sia l'ora: la stessa pioggia,
    // due volte. Deve vincere una sola finestra.
    const localMidnight = new Date('2026-09-10T22:00:00Z').getTime();
    for (let i = 0; i < 96; i += 1) {
      const at = new Date(localMidnight + i * 15 * 60_000).toISOString();
      agg.add(sample(at, { precipitationMm: 1, precipitationWindowS: 900 }));
    }
    for (let i = 0; i < 24; i += 1) {
      const at = new Date(localMidnight + i * 60 * 60_000).toISOString();
      agg.add(sample(at, { precipitationMm: 4, precipitationWindowS: 3600 }));
    }

    const day = agg.finish().find((d) => d.date.toISOString().startsWith('2026-09-11'));
    // 96 x 1 mm dalla finestra a 15 minuti, la piu' frequente. Non 96 + 96.
    expect(day!.precipMm).toBeCloseTo(96, 1);
  });

  it('scarta i giorni con copertura insufficiente', () => {
    const agg = new ArpaeDailyAggregator();
    // Solo 4 campioni su 96: il giorno non e' rappresentativo.
    for (let i = 0; i < 4; i += 1) {
      const at = new Date(
        new Date('2026-09-11T22:00:00Z').getTime() + i * 15 * 60_000,
      ).toISOString();
      agg.add(sample(at, { airTemperatureC: 18, precipitationMm: 1, precipitationWindowS: 900 }));
    }
    expect(agg.finish()).toHaveLength(0);
  });

  it('espone le stazioni incontrate', () => {
    const agg = new ArpaeDailyAggregator();
    fullDay(agg, '2026-09-12T22:00:00Z', () => 12);
    const [s] = agg.stationList();
    expect(s).toMatchObject({
      source: 'ARPAE_ER',
      externalId: 'agrmet:1:2',
      name: 'Test',
      region: 'Emilia-Romagna',
      altitudeM: 700,
    });
  });
});

describe('monthsBetween', () => {
  it('copre gli estremi e attraversa il capodanno', () => {
    expect(
      monthsBetween(new Date('2026-09-05T00:00:00Z'), new Date('2026-09-20T00:00:00Z')),
    ).toEqual([{ year: 2026, month: 9 }]);
    expect(
      monthsBetween(new Date('2025-11-20T00:00:00Z'), new Date('2026-02-03T00:00:00Z')),
    ).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });
});
