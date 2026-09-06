import { describe, expect, it } from 'vitest';
import { buildDailyFeatures, type DailyInput, type SiteParams } from '../features/build.js';
import { BOLETUS_EDULIS } from '../profiles/boletus-edulis.js';
import { scoreSeries } from './engine.js';
import { detectWetEvents, evaluateTrigger } from './trigger.js';
import type { DailyFeatures, SpeciesProfile } from '../types.js';

/** Stazione appenninica tipo: 44.5 N, 800 m. */
const SITE: SiteParams = { latitudeDeg: 44.5, altitudeM: 800, awcMm: 120, kc: 0.85 };

/**
 * Costruisce una stagione sintetica.
 *
 * `startUtc` e' il primo giorno; `shape(i)` restituisce il meteo del giorno i.
 */
function season(
  startUtc: string,
  days: number,
  shape: (i: number) => Partial<DailyInput>,
): DailyInput[] {
  const start = new Date(startUtc).getTime();
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(start + i * 86_400_000),
    ...shape(i),
  }));
}

/** Estate secca e calda (spin-up), poi rottura autunnale con pioggia. */
function autumnBreak(): DailyInput[] {
  return season('2025-07-01T00:00:00Z', 150, (i) => {
    // Giorno 0-99: caldo e secco. Giorno 100-102: 90 mm. Poi fresco.
    const summer = i < 100;
    const rainDay = i >= 100 && i <= 102;
    return {
      tMeanC: summer ? 24 : 13,
      tMinC: summer ? 18 : 8,
      tMaxC: summer ? 31 : 18,
      precipMm: rainDay ? 30 : summer && i % 20 === 0 ? 4 : 0,
      soilT0To7C: summer ? 25 : 13.5,
    };
  });
}

describe('scoreSeries — profilo boletus-edulis', () => {
  it('durante il caldo secco estivo il punteggio e azzerato', () => {
    const features = buildDailyFeatures(autumnBreak(), SITE);
    const scores = scoreSeries(features, BOLETUS_EDULIS);

    // Giorno 90: piena estate, nessuna pioggia da settimane.
    const summer = scores[90]!;
    expect(summer.score).toBe(0);
    // E' la regola secca di Brejon & Hoffman 2025 a bloccarlo.
    expect(summer.activeInhibitors).toContain('heat-drought');
  });

  it('dopo la rottura autunnale il punteggio sale, con il picco dentro la finestra di incubazione', () => {
    const features = buildDailyFeatures(autumnBreak(), SITE);
    const scores = scoreSeries(features, BOLETUS_EDULIS);

    // La pioggia cade ai giorni 100-102; l'incubazione del profilo e' 8-28
    // giorni con ottimo 12-18. Il picco deve cadere in quella finestra.
    const window = scores.slice(100, 140);
    const peak = window.reduce((best, s) => (s.score > best.score ? s : best), window[0]!);
    const peakIndex = scores.indexOf(peak);

    expect(peak.score).toBeGreaterThan(0);
    expect(peakIndex - 102).toBeGreaterThanOrEqual(BOLETUS_EDULIS.incubation.minDays - 1);
    expect(peakIndex - 102).toBeLessThanOrEqual(BOLETUS_EDULIS.incubation.maxDays);
    expect(peak.daysSinceWetEvent).not.toBeNull();
  });

  it('il giorno stesso della pioggia il punteggio e ancora nullo: i funghi non sono istantanei', () => {
    const features = buildDailyFeatures(autumnBreak(), SITE);
    const scores = scoreSeries(features, BOLETUS_EDULIS);
    expect(scores[102]!.triggerScore).toBe(0);
    expect(scores[102]!.score).toBe(0);
  });

  it('espone il contributo di ogni regola, cosi il punteggio e ispezionabile', () => {
    const features = buildDailyFeatures(autumnBreak(), SITE);
    const scores = scoreSeries(features, BOLETUS_EDULIS);
    const day = scores[115]!;

    expect(day.contributions.map((c) => c.ruleId)).toEqual(BOLETUS_EDULIS.rules.map((r) => r.id));
    const air = day.contributions.find((c) => c.ruleId === 'air-temperature')!;
    expect(air.value).not.toBeNull();
    expect(air.score).toBeGreaterThan(0);
  });
});

describe('composizione alla Liebig', () => {
  const minimal: SpeciesProfile = {
    ...BOLETUS_EDULIS,
    rules: [
      {
        id: 'a',
        feature: 'tMean5',
        membership: { type: 'trapezoid', a: 0, b: 5, c: 20, d: 25 },
        weight: 1,
      },
      {
        id: 'b',
        feature: 'swi',
        membership: { type: 'trapezoid', a: 0.9, b: 0.95, c: 1, d: 1.01 },
        weight: 1,
      },
    ],
    inhibitors: [],
  };

  it('una sola regola a zero azzera tutto, per quanto perfette siano le altre', () => {
    // Temperatura ideale, suolo secco: la regola 'b' vale 0.
    const features: DailyFeatures[] = [
      {
        date: new Date('2025-10-01T00:00:00Z'),
        tMean5: 13,
        swi: 0.1,
        doy: 274,
        altitude: 800,
        p5: 50,
      },
    ];
    const [score] = scoreSeries(features, minimal);
    expect(score!.score).toBe(0);
  });
});

describe('regole con dato mancante', () => {
  it('una feature assente salta la regola invece di penalizzarla', () => {
    const withSoil: DailyFeatures[] = [
      {
        date: new Date('2025-10-01T00:00:00Z'),
        tMean5: 13,
        soilTMean7: 13,
        swi: 0.8,
        doy: 274,
        altitude: 800,
      },
    ];
    const withoutSoil: DailyFeatures[] = [
      { date: new Date('2025-10-01T00:00:00Z'), tMean5: 13, swi: 0.8, doy: 274, altitude: 800 },
    ];

    const a = scoreSeries(withSoil, BOLETUS_EDULIS)[0]!;
    const b = scoreSeries(withoutSoil, BOLETUS_EDULIS)[0]!;

    const soilRule = b.contributions.find((c) => c.ruleId === 'soil-temperature')!;
    expect(soilRule.skipped).toBe(true);
    expect(soilRule.value).toBeNull();

    // Senza dato del suolo il punteggio non deve essere piu' basso: un buco di
    // copertura non e' un giudizio negativo.
    expect(b.score).toBeGreaterThanOrEqual(a.score * 0.999);
  });
});

describe('fenologia', () => {
  it('a gennaio il punteggio e nullo anche col meteo perfetto', () => {
    const january: DailyFeatures[] = [
      {
        date: new Date('2026-01-15T00:00:00Z'),
        tMean5: 13,
        swi: 0.9,
        p21: 120,
        doy: 15,
        altitude: 800,
      },
    ];
    expect(scoreSeries(january, BOLETUS_EDULIS)[0]!.phenologyScore).toBe(0);
    expect(scoreSeries(january, BOLETUS_EDULIS)[0]!.score).toBe(0);
  });

  it('in ottobre a 800 m la finestra e aperta', () => {
    const october: DailyFeatures[] = [
      {
        date: new Date('2025-10-10T00:00:00Z'),
        tMean5: 13,
        swi: 0.9,
        p21: 120,
        doy: 283,
        altitude: 800,
      },
    ];
    expect(scoreSeries(october, BOLETUS_EDULIS)[0]!.phenologyScore).toBe(1);
  });
});

describe('inibitori', () => {
  it('il gelo azzera e continua a pesare nei giorni successivi', () => {
    const days: DailyFeatures[] = Array.from({ length: 8 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 9, 20 + i)),
      tMean5: 13,
      swi: 0.9,
      p21: 120,
      p5: 40,
      doy: 293 + i,
      altitude: 800,
      // Gelata solo il primo giorno.
      frostDays: i === 0 ? 1 : 0,
    }));

    const scores = scoreSeries(days, BOLETUS_EDULIS);
    expect(scores[0]!.activeInhibitors).toContain('frost');
    // persistDays = 5: ancora attivo al giorno 5, non piu' al 6.
    expect(scores[5]!.activeInhibitors).toContain('frost');
    expect(scores[6]!.activeInhibitors).not.toContain('frost');
  });
});

describe('detectWetEvents', () => {
  it('le fixture usano la finestra dichiarata dal profilo', () => {
    // Se il profilo cambia windowDays, queste fixture vanno aggiornate:
    // meglio un fallimento esplicito qui che eventi mai riconosciuti.
    expect(BOLETUS_EDULIS.trigger.windowDays).toBe(5);
  });

  it('la pioggia su terreno arido non innesca: evapora invece di accumularsi', () => {
    const dry: DailyFeatures[] = [{ date: new Date('2025-08-01T00:00:00Z'), p5: 40, swi: 0.2 }];
    expect(detectWetEvents(dry, BOLETUS_EDULIS.trigger)).toHaveLength(0);
  });

  it('la stessa pioggia su terreno gia umido innesca', () => {
    const wet: DailyFeatures[] = [{ date: new Date('2025-10-01T00:00:00Z'), p5: 40, swi: 0.6 }];
    const events = detectWetEvents(wet, BOLETUS_EDULIS.trigger);
    expect(events).toHaveLength(1);
    expect(events[0]!.magnitude).toBeGreaterThan(0.4);
  });

  it('giorni contigui sopra soglia sono un evento solo', () => {
    const days: DailyFeatures[] = [30, 55, 60, 0, 0].map((p5, i) => ({
      date: new Date(Date.UTC(2025, 9, 1 + i)),
      p5,
      swi: 0.6,
    }));
    const events = detectWetEvents(days, BOLETUS_EDULIS.trigger);
    expect(events).toHaveLength(1);
    // Vince il giorno piu' forte della sequenza.
    expect(events[0]!.precipMm).toBe(60);
  });

  it('due piogge distanziate producono due impulsi distinti', () => {
    const days: DailyFeatures[] = Array.from({ length: 40 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 8, 1 + i)),
      p5: i === 0 || i === 20 ? 45 : 0,
      swi: 0.6,
    }));
    const events = detectWetEvents(days, BOLETUS_EDULIS.trigger);
    expect(events).toHaveLength(2);

    const triggers = evaluateTrigger(days, events, BOLETUS_EDULIS.incubation);
    // Un picco per evento, sfasati di 20 giorni.
    expect(triggers[15]!.score).toBeGreaterThan(0);
    expect(triggers[35]!.score).toBeGreaterThan(0);
    // Fra i due impulsi il punteggio cala.
    expect(triggers[29]!.score).toBeLessThan(triggers[15]!.score);
  });
});
