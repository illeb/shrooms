import { FEATURE_KEYS } from '@mushrooms/mycology-core';
import { z } from 'zod';

/**
 * Validazione di un profilo di specie caricato da YAML.
 *
 * Serve soprattutto a intercettare i refusi nelle chiavi di feature: una
 * `soilTMean7` scritta `soilTmean7` non farebbe fallire nulla, produrrebbe una
 * regola sempre saltata. Il modello girerebbe, darebbe numeri plausibili, e
 * ignorerebbe in silenzio un criterio.
 */

const featureKey = z.enum(FEATURE_KEYS);

const membership = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('trapezoid'),
    a: z.number(),
    b: z.number(),
    c: z.number(),
    d: z.number(),
  }),
  z.object({ type: z.literal('gaussian'), mu: z.number(), sigma: z.number().positive() }),
  z.object({ type: z.literal('saturating'), ref: z.number().positive() }),
  z.object({ type: z.literal('linear'), from: z.number(), to: z.number() }),
]);

const comparison = z.object({
  feature: featureKey,
  op: z.enum(['lt', 'lte', 'gt', 'gte']),
  value: z.number(),
});

// La condizione e' ricorsiva: zod ha bisogno di un lazy esplicito.
type ConditionInput =
  | z.infer<typeof comparison>
  | { all: ConditionInput[] }
  | { any: ConditionInput[] }
  | { not: ConditionInput };

const condition: z.ZodType<ConditionInput> = z.lazy(() =>
  z.union([
    comparison,
    z.object({ all: z.array(condition).min(1) }),
    z.object({ any: z.array(condition).min(1) }),
    z.object({ not: condition }),
  ]),
);

const rule = z
  .object({
    id: z.string().min(1),
    feature: featureKey,
    membership,
    weight: z.number().min(0),
    mode: z.enum(['limiting', 'bonus']).optional(),
    onMissing: z.enum(['skip', 'zero']).optional(),
  })
  .refine(
    (r) =>
      r.membership.type !== 'trapezoid' ||
      (r.membership.a <= r.membership.b &&
        r.membership.b <= r.membership.c &&
        r.membership.c <= r.membership.d),
    { message: 'trapezio: servono a <= b <= c <= d' },
  );

const altitudeBand = z
  .object({
    fromM: z.number(),
    toM: z.number(),
    doyFrom: z.number().int().min(1).max(366),
    doyTo: z.number().int().min(1).max(366),
  })
  .refine((b) => b.fromM <= b.toM, { message: 'fromM deve essere <= toM' })
  .refine((b) => b.doyFrom <= b.doyTo, { message: 'doyFrom deve essere <= doyTo' });

export const speciesProfileSchema = z.object({
  species: z.string().min(1),
  version: z.number().int().positive(),
  label: z.string().min(1),

  water: z.object({
    awcMm: z.number().positive(),
    kc: z.number().positive(),
  }),

  trigger: z.object({
    windowDays: z.number().int().positive(),
    minPrecipMm: z.number().nonnegative(),
    minSwi: z.number().min(0).max(1),
    magnitudeRefMm: z.number().positive(),
  }),

  incubation: z
    .object({
      minDays: z.number().int().nonnegative(),
      optDaysFrom: z.number().int().nonnegative(),
      optDaysTo: z.number().int().nonnegative(),
      maxDays: z.number().int().positive(),
    })
    .refine(
      (i) => i.minDays <= i.optDaysFrom && i.optDaysFrom <= i.optDaysTo && i.optDaysTo <= i.maxDays,
      { message: 'incubazione: servono minDays <= optDaysFrom <= optDaysTo <= maxDays' },
    ),

  rules: z.array(rule).min(1),

  inhibitors: z.array(
    z.object({
      id: z.string().min(1),
      when: condition,
      factor: z.number().min(0).max(1),
      persistDays: z.number().int().nonnegative().optional(),
    }),
  ),

  phenology: z.object({
    altitudeBands: z.array(altitudeBand).refine(
      (bands) => {
        // Le fasce non possono sovrapporsi in quota: il punteggio fenologico
        // vale 1 se una qualsiasi fascia copre il giorno, quindi due fasce
        // sovrapposte fanno vincere sempre la piu' permissiva e rendono
        // l'altra inerte. E' un errore silenzioso, quindi lo blocchiamo qui.
        const sorted = [...bands].sort((a, b) => a.fromM - b.fromM);
        return sorted.every((b, i) => i === 0 || sorted[i - 1]!.toM < b.fromM);
      },
      { message: 'le fasce di quota non devono sovrapporsi' },
    ),
  }),

  yieldModel: z
    .object({
      enabled: z.boolean(),
      basalArea: z.number().positive(),
      coefficients: z.object({
        intercept: z.number(),
        pAutumn: z.number(),
        tAutumn: z.number(),
        lnG: z.number(),
        g: z.number(),
      }),
    })
    .optional(),

  classThresholds: z
    .object({
      scarsa: z.number().min(0).max(100),
      discreta: z.number().min(0).max(100),
      buona: z.number().min(0).max(100),
      eccezionale: z.number().min(0).max(100),
    })
    .refine((t) => t.scarsa < t.discreta && t.discreta < t.buona && t.buona < t.eccezionale, {
      message: 'le soglie di classe devono essere crescenti',
    }),
});

export type ValidatedSpeciesProfile = z.infer<typeof speciesProfileSchema>;
