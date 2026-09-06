/**
 * Contratti del dominio micologico.
 *
 * `SpeciesProfile` e' la rappresentazione tipizzata del profilo di specie:
 * e' QUI che si tara il modello, non nel codice. Il motore lo interpreta senza
 * conoscere nessuna specie in particolare.
 */

import type {
  GaussianParams,
  LinearRampParams,
  SaturatingParams,
  TrapezoidParams,
} from './math/membership.js';

/** Chiavi delle feature giornaliere calcolate dal feature store (livello L0). */
export type FeatureKey =
  // grandezze base
  | 'tMean'
  | 'tMin'
  | 'tMax'
  | 'precip'
  | 'rh'
  // suolo
  | 'soilT0_7'
  | 'soilT7_28'
  | 'soilMoisture0_7'
  // bilancio idrico
  | 'eto'
  | 'soilWaterMm'
  | 'swi'
  // finestre mobili di precipitazione (cumulate sui giorni precedenti, incluso oggi)
  | 'p3'
  | 'p5'
  | 'p7'
  | 'p10'
  | 'p14'
  | 'p21'
  | 'p30'
  | 'p60'
  // finestre mobili di temperatura (medie)
  | 'tMean5'
  | 'tMean7'
  | 'tMean10'
  | 'soilTMean5'
  | 'soilTMean7'
  | 'soilTMean10'
  // dinamica
  | 'thermalShock'
  | 'daysSinceWetEvent'
  | 'wetEventMagnitude'
  // inibitori
  | 'frostDays'
  | 'heatDays'
  | 'droughtStreak'
  // contesto
  | 'doy'
  | 'altitude';

/**
 * Elenco a runtime delle chiavi valide.
 *
 * Serve perche' alcune chiavi si compongono a runtime (la finestra di innesco
 * `p3`/`p5`/`p7` dipende dal profilo): senza una validazione un refuso nel
 * profilo diventerebbe silenziosamente una feature sempre assente.
 */
export const FEATURE_KEYS = [
  'tMean',
  'tMin',
  'tMax',
  'precip',
  'rh',
  'soilT0_7',
  'soilT7_28',
  'soilMoisture0_7',
  'eto',
  'soilWaterMm',
  'swi',
  'p3',
  'p5',
  'p7',
  'p10',
  'p14',
  'p21',
  'p30',
  'p60',
  'tMean5',
  'tMean7',
  'tMean10',
  'soilTMean5',
  'soilTMean7',
  'soilTMean10',
  'thermalShock',
  'daysSinceWetEvent',
  'wetEventMagnitude',
  'frostDays',
  'heatDays',
  'droughtStreak',
  'doy',
  'altitude',
] as const satisfies readonly FeatureKey[];

const FEATURE_KEY_SET: ReadonlySet<string> = new Set(FEATURE_KEYS);

export function isFeatureKey(value: string): value is FeatureKey {
  return FEATURE_KEY_SET.has(value);
}

/** Una riga del feature store: tutte le feature di una stazione in un giorno. */
export interface DailyFeatures extends Partial<Record<FeatureKey, number>> {
  date: Date;
  /** `true` finche' il bilancio idrico non ha dimenticato la condizione iniziale. */
  warmup?: boolean;
}

// ---------------------------------------------------------------------------
// Regole
// ---------------------------------------------------------------------------

export type MembershipSpec =
  | ({ type: 'trapezoid' } & TrapezoidParams)
  | ({ type: 'gaussian' } & GaussianParams)
  | ({ type: 'saturating' } & SaturatingParams)
  | ({ type: 'linear' } & LinearRampParams);

/**
 * `limiting` (default) partecipa alla media geometrica e puo' azzerare lo score.
 * `bonus` puo' solo alzarlo: la sua assenza non penalizza.
 */
export type RuleMode = 'limiting' | 'bonus';

export interface RuleSpec {
  id: string;
  feature: FeatureKey;
  membership: MembershipSpec;
  weight: number;
  mode?: RuleMode;
  /**
   * Cosa fare se la feature manca.
   *
   * `skip` (default) esclude la regola dal calcolo: e' il comportamento giusto
   * quando un dato e' assente per copertura (la temperatura del suolo prima
   * che Open-Meteo fosse caricato), perche' un buco non deve diventare un
   * giudizio negativo. `zero` la tratta come punteggio nullo.
   */
  onMissing?: 'skip' | 'zero';
}

// ---------------------------------------------------------------------------
// Inibitori
// ---------------------------------------------------------------------------

export type ComparisonOperator = 'lt' | 'lte' | 'gt' | 'gte';

/** Confronto elementare su una feature. */
export interface FeatureComparison {
  feature: FeatureKey;
  op: ComparisonOperator;
  value: number;
}

/**
 * Condizione di un inibitore.
 *
 * Struttura dati e non una stringa da interpretare: e' altrettanto leggibile
 * in YAML, ma non richiede di valutare espressioni arbitrarie provenienti da
 * un file di configurazione.
 */
export type Condition =
  FeatureComparison | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export interface InhibitorSpec {
  id: string;
  when: Condition;
  /** Fattore moltiplicativo applicato quando la condizione e' vera. 0 = blocco totale. */
  factor: number;
  /** Per quanti giorni l'inibizione resta attiva dopo l'ultimo giorno in cui scatta. */
  persistDays?: number;
}

// ---------------------------------------------------------------------------
// Fenologia, innesco, incubazione
// ---------------------------------------------------------------------------

/** Finestra fenologica: quando cercare, a quale quota. */
export interface AltitudeBand {
  fromM: number;
  toM: number;
  /** Giorno dell'anno di inizio e fine, estremi inclusi. */
  doyFrom: number;
  doyTo: number;
}

/** Rilevamento di un evento di bagnatura. */
export interface TriggerSpec {
  /** Su quanti giorni si somma la pioggia per riconoscere l'evento. */
  windowDays: number;
  minPrecipMm: number;
  /** Soglia di riempimento del suolo sotto la quale la pioggia non "attacca". */
  minSwi: number;
  /** Scala della curva saturante che pesa la magnitudine dell'evento. */
  magnitudeRefMm: number;
}

/** Il "tempo di crescita" della specie: ritardo fra bagnatura e fruttificazione. */
export interface IncubationSpec {
  minDays: number;
  optDaysFrom: number;
  optDaysTo: number;
  maxDays: number;
}

/** Coefficienti del modello di resa stagionale (Martinez-Pena et al. 2012). */
export interface YieldModelSpec {
  enabled: boolean;
  /** Area basimetrica del popolamento, m^2/ha. L'ottimo per B. edulis e' ~41.7. */
  basalArea: number;
  coefficients: {
    intercept: number;
    pAutumn: number;
    tAutumn: number;
    lnG: number;
    g: number;
  };
}

/** Parametri del bilancio idrico specifici del profilo. */
export interface WaterSpec {
  /** Riserva idrica utile del suolo, mm. */
  awcMm: number;
  /** Coefficiente colturale del soprassuolo. */
  kc: number;
}

export interface SpeciesProfile {
  /** Identificativo stabile, es. `boletus-edulis`. */
  species: string;
  /** Versione del profilo: ogni previsione salva quella con cui e' stata generata. */
  version: number;
  label: string;
  water: WaterSpec;
  trigger: TriggerSpec;
  incubation: IncubationSpec;
  rules: RuleSpec[];
  inhibitors: InhibitorSpec[];
  phenology: { altitudeBands: AltitudeBand[] };
  yieldModel?: YieldModelSpec;
  /** Soglie di score (0-100) per la classificazione della buttata. */
  classThresholds: { scarsa: number; discreta: number; buona: number; eccezionale: number };
}

// ---------------------------------------------------------------------------
// Risultato
// ---------------------------------------------------------------------------

export type FruitingClass = 'nulla' | 'scarsa' | 'discreta' | 'buona' | 'eccezionale';

/**
 * Provenienza del dato su cui lo score e' calcolato.
 *
 * Non ha nulla a che vedere col futuro: il sistema non usa previsioni meteo.
 * Distingue una stazione che ha misurato davvero da una cella di griglia
 * modellata, perche' la seconda merita meno fiducia della prima.
 */
export type ScoreConfidence = 'observed' | 'modelled';

/** Contributo di una singola regola, conservato per rendere lo score ispezionabile. */
export interface RuleContribution {
  ruleId: string;
  feature: FeatureKey;
  value: number | null;
  score: number;
  weight: number;
  mode: RuleMode;
  /** `true` se la regola e' stata esclusa perche' la feature mancava. */
  skipped: boolean;
}

export interface FruitingScore {
  /** Giorno valutato. Mai nel futuro: si giudicano condizioni gia' avvenute. */
  date: Date;
  /** Punteggio finale 0..100. */
  score: number;
  class: FruitingClass;
  confidence: ScoreConfidence;
  /** Perche' quel punteggio: una voce per regola, piu' gli inibitori attivi. */
  contributions: RuleContribution[];
  activeInhibitors: string[];
  /** Punteggio dell'innesco: quanto siamo dentro la finestra di incubazione. */
  triggerScore: number;
  /** Giorni trascorsi dall'evento di bagnatura che governa questa data. */
  daysSinceWetEvent: number | null;
  /** Punteggio fenologico: 1 dentro la finestra stagionale della quota, 0 fuori. */
  phenologyScore: number;
  /** `true` se il bilancio idrico non ha ancora dimenticato la condizione iniziale. */
  warmup: boolean;
}

/** Lettura tipizzata di una feature: `undefined` se assente o non finita. */
export function readFeature(features: DailyFeatures, key: FeatureKey): number | undefined {
  const value = features[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Scrittura tipizzata: i valori assenti o non finiti non vengono scritti. */
export function writeFeature(
  features: DailyFeatures,
  key: FeatureKey,
  value: number | null | undefined,
): void {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  features[key] = value;
}
