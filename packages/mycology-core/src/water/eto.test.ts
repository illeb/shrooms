import { describe, expect, it } from 'vitest';
import { dayOfYear, extraterrestrialRadiation, hargreavesEto } from './eto.js';

describe('extraterrestrialRadiation', () => {
  // FAO-56, Esempio 8: Ra per il 3 settembre (giorno 246) a 20 gradi Sud = 32.2 MJ/m2/giorno.
  it('riproduce l esempio 8 della FAO-56', () => {
    expect(extraterrestrialRadiation({ latitudeDeg: -20, dayOfYear: 246 })).toBeCloseTo(32.2, 1);
  });

  it('ha il massimo al solstizio d estate alle latitudini italiane', () => {
    const june = extraterrestrialRadiation({ latitudeDeg: 44.5, dayOfYear: 172 });
    const december = extraterrestrialRadiation({ latitudeDeg: 44.5, dayOfYear: 355 });
    expect(june).toBeGreaterThan(40);
    expect(december).toBeLessThan(15);
    expect(june).toBeGreaterThan(december);
  });

  it('resta finito oltre il circolo polare (notte e giorno polare)', () => {
    expect(extraterrestrialRadiation({ latitudeDeg: 80, dayOfYear: 355 })).toBeCloseTo(0, 5);
    expect(Number.isFinite(extraterrestrialRadiation({ latitudeDeg: 80, dayOfYear: 172 }))).toBe(
      true,
    );
  });

  it('rifiuta input fuori range', () => {
    expect(() => extraterrestrialRadiation({ latitudeDeg: 44, dayOfYear: 0 })).toThrow(RangeError);
    expect(() => extraterrestrialRadiation({ latitudeDeg: 120, dayOfYear: 10 })).toThrow(
      RangeError,
    );
  });
});

describe('hargreavesEto', () => {
  it('da un valore plausibile per una giornata estiva in Appennino', () => {
    // 15 luglio, 44.5 N, 18/32 gradi: attesi 5-7 mm/giorno in pianura padana.
    const eto = hargreavesEto({ tMinC: 18, tMaxC: 32, latitudeDeg: 44.5, dayOfYear: 196 });
    expect(eto).toBeGreaterThan(5);
    expect(eto).toBeLessThan(7);
  });

  it('e molto piu basso in autunno, a parita di sito', () => {
    const july = hargreavesEto({ tMinC: 18, tMaxC: 32, latitudeDeg: 44.5, dayOfYear: 196 });
    const october = hargreavesEto({ tMinC: 8, tMaxC: 17, latitudeDeg: 44.5, dayOfYear: 288 });
    expect(october).toBeLessThan(july / 3);
  });

  it('non produce mai valori negativi', () => {
    expect(hargreavesEto({ tMinC: 10, tMaxC: 10, latitudeDeg: 44.5, dayOfYear: 100 })).toBe(0);
    expect(hargreavesEto({ tMinC: 20, tMaxC: 5, latitudeDeg: 44.5, dayOfYear: 100 })).toBe(0);
    expect(hargreavesEto({ tMinC: -25, tMaxC: -20, latitudeDeg: 44.5, dayOfYear: 20 })).toBe(0);
  });

  it('tollera dati mancanti restituendo 0', () => {
    expect(hargreavesEto({ tMinC: Number.NaN, tMaxC: 20, latitudeDeg: 44.5, dayOfYear: 100 })).toBe(
      0,
    );
  });

  it('cresce con l escursione termica', () => {
    const narrow = hargreavesEto({ tMinC: 14, tMaxC: 16, latitudeDeg: 44.5, dayOfYear: 196 });
    const wide = hargreavesEto({ tMinC: 8, tMaxC: 22, latitudeDeg: 44.5, dayOfYear: 196 });
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('dayOfYear', () => {
  it('mappa correttamente gli estremi e i bisestili', () => {
    expect(dayOfYear(new Date('2026-01-01T00:00:00Z'))).toBe(1);
    expect(dayOfYear(new Date('2026-12-31T00:00:00Z'))).toBe(365);
    expect(dayOfYear(new Date('2024-12-31T00:00:00Z'))).toBe(366);
    expect(dayOfYear(new Date('2026-09-05T00:00:00Z'))).toBe(248);
  });
});
