/**
 * Eventi di bagnatura e finestra di incubazione.
 *
 * E' il pezzo che traduce il "tempo di crescita per fungo": una pioggia non
 * produce funghi il giorno stesso, ne apre la possibilita' per una finestra
 * che si apre giorni dopo e si richiude.
 *
 * Il `max` sugli eventi (invece di una media) e' deliberato: riproduce le
 * fruttificazioni a impulsi distinti osservate da Brejon Lamartiniere &
 * Hoffman (2025), dove due piogge distanziate danno due buttate separate
 * invece di un unico picco appiattito.
 */

import { saturating, trapezoid } from '../math/membership.js';
import { isFeatureKey, readFeature } from '../types.js';
import type { DailyFeatures, IncubationSpec, TriggerSpec } from '../types.js';

export interface WetEvent {
  /** Indice nella serie del giorno in cui l'evento e' stato riconosciuto. */
  index: number;
  date: Date;
  /** Pioggia cumulata sulla finestra di innesco, mm. */
  precipMm: number;
  /** Riempimento del suolo raggiunto, 0..1. */
  swi: number;
  /** Peso dell'evento, 0..1: quanto e' stato "grosso". */
  magnitude: number;
}

/**
 * Individua gli eventi di bagnatura in una serie di feature.
 *
 * Un evento e' un giorno in cui la pioggia cumulata sulla finestra supera la
 * soglia **e** il suolo ha effettivamente accumulato acqua. La seconda
 * condizione e' quella che distingue 40 mm caduti su terreno arido d'agosto,
 * che evaporano, dagli stessi 40 mm su terreno gia' umido d'autunno.
 *
 * Giorni consecutivi sopra soglia appartengono allo stesso evento: si tiene
 * quello di magnitudine maggiore.
 */
export function detectWetEvents(features: readonly DailyFeatures[], spec: TriggerSpec): WetEvent[] {
  const events: WetEvent[] = [];
  let openEvent: WetEvent | null = null;

  for (let i = 0; i < features.length; i += 1) {
    const f = features[i];
    if (!f) continue;

    const precip = windowPrecip(f, spec.windowDays);
    const swi = f.swi;

    const isWet =
      precip !== null && precip >= spec.minPrecipMm && swi !== undefined && swi >= spec.minSwi;

    if (!isWet) {
      if (openEvent) {
        events.push(openEvent);
        openEvent = null;
      }
      continue;
    }

    const candidate: WetEvent = {
      index: i,
      date: f.date,
      precipMm: precip,
      swi: swi as number,
      magnitude: saturating(precip, { ref: spec.magnitudeRefMm }),
    };

    // Giorni contigui sopra soglia = un evento solo, quello piu' forte.
    if (openEvent === null || candidate.magnitude > openEvent.magnitude) {
      openEvent = candidate;
    }
  }

  if (openEvent) events.push(openEvent);
  return events;
}

/** La cumulata corrispondente alla finestra di innesco richiesta. */
function windowPrecip(f: DailyFeatures, windowDays: number): number | null {
  const key = `p${windowDays}`;
  if (isFeatureKey(key)) {
    const v = readFeature(f, key);
    if (v !== undefined) return v;
  }

  // Finestra non precalcolata: ripieghiamo sulla piu' stretta che la contiene.
  for (const fallback of ['p3', 'p5', 'p7', 'p10', 'p14'] as const) {
    if (Number.parseInt(fallback.slice(1), 10) < windowDays) continue;
    const alt = readFeature(f, fallback);
    if (alt !== undefined) return alt;
  }
  return null;
}

export interface TriggerEvaluation {
  /** Quanto la data e' "coperta" da un evento di bagnatura, 0..1. */
  score: number;
  /** Giorni trascorsi dall'evento che governa la data, `null` se nessuno. */
  daysSince: number | null;
  /** L'evento che ha prodotto il punteggio migliore. */
  event: WetEvent | null;
}

/**
 * Valuta, per ogni giorno della serie, quanto e' dentro una finestra di
 * fruttificazione aperta da un evento passato.
 *
 * Il punteggio combina *quanto ha piovuto* (magnitudine saturante) e *quanto
 * tempo e' passato* (trapezio sui giorni di incubazione).
 */
export function evaluateTrigger(
  features: readonly DailyFeatures[],
  events: readonly WetEvent[],
  incubation: IncubationSpec,
): TriggerEvaluation[] {
  const { minDays, optDaysFrom, optDaysTo, maxDays } = incubation;

  return features.map((_, i) => {
    let best: TriggerEvaluation = { score: 0, daysSince: null, event: null };

    for (const event of events) {
      const elapsed = i - event.index;
      if (elapsed < 0 || elapsed > maxDays) continue;

      const window = trapezoid(elapsed, {
        a: minDays - 1,
        b: optDaysFrom,
        c: optDaysTo,
        d: maxDays,
      });
      if (window === 0) continue;

      const score = event.magnitude * window;
      if (score > best.score) {
        best = { score, daysSince: elapsed, event };
      }
    }

    return best;
  });
}
