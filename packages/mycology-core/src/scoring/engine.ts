/**
 * Motore di scoring.
 *
 * Non conosce nessuna specie: legge un `SpeciesProfile` e lo applica a una
 * serie di feature. Cambiare specie, o cambiare idea sui porcini, significa
 * cambiare il profilo — mai questo file.
 *
 * La composizione e' **moltiplicativa**, non additiva: legge del minimo di
 * Liebig. Se manca l'acqua non importa quanto sia perfetta la temperatura.
 */

import {
  clamp01,
  gaussian,
  linearRamp,
  saturating,
  trapezoid,
  weightedGeometricMean,
} from '../math/membership.js';
import { readFeature } from '../types.js';
import type {
  Condition,
  DailyFeatures,
  FruitingClass,
  FruitingScore,
  MembershipSpec,
  RuleContribution,
  RuleSpec,
  ScoreConfidence,
  SpeciesProfile,
} from '../types.js';
import { detectWetEvents, evaluateTrigger } from './trigger.js';

/** Applica una funzione di appartenenza a un valore. */
export function applyMembership(value: number, spec: MembershipSpec): number {
  switch (spec.type) {
    case 'trapezoid':
      return trapezoid(value, spec);
    case 'gaussian':
      return gaussian(value, spec);
    case 'saturating':
      return saturating(value, spec);
    case 'linear':
      return linearRamp(value, spec);
  }
}

/** Valuta una condizione di inibitore. `null` (dato mancante) non attiva nulla. */
export function evaluateCondition(condition: Condition, features: DailyFeatures): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, features));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, features));
  if ('not' in condition) return !evaluateCondition(condition.not, features);

  const value = readFeature(features, condition.feature);
  if (value === undefined) return false;

  switch (condition.op) {
    case 'lt':
      return value < condition.value;
    case 'lte':
      return value <= condition.value;
    case 'gt':
      return value > condition.value;
    case 'gte':
      return value >= condition.value;
  }
}

/** Punteggio fenologico: siamo nella stagione giusta per questa quota? */
export function phenologyScore(features: DailyFeatures, profile: SpeciesProfile): number {
  const bands = profile.phenology.altitudeBands;
  if (bands.length === 0) return 1;

  const doy = features.doy;
  if (doy === undefined) return 1;

  // Senza quota non possiamo scegliere la fascia: accettiamo se una qualsiasi
  // fascia copre il giorno, invece di penalizzare un dato che non abbiamo.
  const altitude = features.altitude;

  for (const band of bands) {
    const altitudeOk = altitude === undefined || (altitude >= band.fromM && altitude <= band.toM);
    if (!altitudeOk) continue;
    if (doy >= band.doyFrom && doy <= band.doyTo) return 1;
  }
  return 0;
}

function classify(score: number, profile: SpeciesProfile): FruitingClass {
  const t = profile.classThresholds;
  if (score >= t.eccezionale) return 'eccezionale';
  if (score >= t.buona) return 'buona';
  if (score >= t.discreta) return 'discreta';
  if (score >= t.scarsa) return 'scarsa';
  return 'nulla';
}

function evaluateRule(rule: RuleSpec, features: DailyFeatures): RuleContribution {
  const raw = readFeature(features, rule.feature);
  const mode = rule.mode ?? 'limiting';

  if (raw === undefined) {
    const onMissing = rule.onMissing ?? 'skip';
    return {
      ruleId: rule.id,
      feature: rule.feature,
      value: null,
      score: onMissing === 'zero' ? 0 : 1,
      weight: rule.weight,
      mode,
      skipped: onMissing === 'skip',
    };
  }

  return {
    ruleId: rule.id,
    feature: rule.feature,
    value: raw,
    score: clamp01(applyMembership(raw, rule.membership)),
    weight: rule.weight,
    mode,
    skipped: false,
  };
}

export interface ScoreOptions {
  /**
   * Provenienza dei dati, riportata nel risultato. Non entra nel calcolo:
   * serve alla UI per dire quanta fiducia merita il numero.
   */
  confidence?: ScoreConfidence;
}

/**
 * Calcola il punteggio di buttata per ogni giorno della serie.
 *
 * `features` deve essere contiguo e ordinato: gli eventi di bagnatura e le
 * finestre di incubazione ragionano per indici.
 */
export function scoreSeries(
  features: readonly DailyFeatures[],
  profile: SpeciesProfile,
  options: ScoreOptions = {},
): FruitingScore[] {
  const confidence = options.confidence ?? 'observed';

  const events = detectWetEvents(features, profile.trigger);
  const triggers = evaluateTrigger(features, events, profile.incubation);

  // Un inibitore che "persiste" resta attivo per N giorni dopo l'ultimo in cui
  // scatta: una gelata non smette di aver fatto danno il giorno dopo.
  const inhibitorUntil = new Map<string, number>();

  return features.map((f, i) => {
    const contributions = profile.rules.map((rule) => evaluateRule(rule, f));

    const limiting = contributions.filter((c) => c.mode === 'limiting' && !c.skipped);
    const bonuses = contributions.filter((c) => c.mode === 'bonus' && !c.skipped);

    // Base: media geometrica pesata delle regole limitanti.
    let score = weightedGeometricMean(limiting.map((c) => ({ value: c.score, weight: c.weight })));

    // I bonus alzano il punteggio verso 1 in proporzione al loro peso, senza
    // mai poterlo abbassare: la loro assenza non e' una colpa.
    for (const b of bonuses) {
      score += (1 - score) * clamp01(b.score) * clamp01(b.weight);
    }

    const trigger = triggers[i] ?? { score: 0, daysSince: null, event: null };
    const phenology = phenologyScore(f, profile);

    score *= trigger.score * phenology;

    // Inibitori.
    const active: string[] = [];
    for (const inhibitor of profile.inhibitors) {
      if (evaluateCondition(inhibitor.when, f)) {
        inhibitorUntil.set(inhibitor.id, i + (inhibitor.persistDays ?? 0));
      }
      const until = inhibitorUntil.get(inhibitor.id);
      if (until !== undefined && i <= until) {
        score *= clamp01(inhibitor.factor);
        active.push(inhibitor.id);
      }
    }

    const finalScore = Math.round(clamp01(score) * 1000) / 10;

    return {
      date: f.date,
      score: finalScore,
      class: classify(finalScore, profile),
      confidence,
      contributions,
      activeInhibitors: active,
      triggerScore: Math.round(trigger.score * 1000) / 1000,
      daysSinceWetEvent: trigger.daysSince,
      phenologyScore: phenology,
      warmup: f.warmup ?? false,
    };
  });
}
