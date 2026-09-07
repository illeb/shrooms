import { z } from 'zod';

/**
 * Validazione delle variabili d'ambiente allo startup.
 *
 * Fallire subito e con un messaggio esplicito è preferibile a scoprire alle
 * 5:30 del mattino che il cron di ingestione girava con un URL sbagliato.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL è obbligatoria'),

  GRAPHQL_PLAYGROUND: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .pipe(z.boolean()),

  // Nessuna configurazione di scheduling qui: l'ingestione giornaliera gira
  // nel container `scheduler`, che legge `INGESTION_AT` dall'ambiente del
  // container. Prima c'erano `INGESTION_CRON_ENABLED` e `INGESTION_CRON`, che
  // passavano la validazione e non erano lette da nessuno: chi apriva il
  // progetto concludeva che il job esistesse.

  OPEN_METEO_BASE_URL: z.url().default('https://api.open-meteo.com'),
  OPEN_METEO_ARCHIVE_URL: z.url().default('https://archive-api.open-meteo.com'),
  ARPAE_OPENDATA_BASE_URL: z.url().default('https://dati-simc.arpae.it/opendata/osservati/meteo'),
  MARCHE_API_BASE_URL: z.url().default('https://apimeteo.regione.marche.it'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configurazione non valida:\n${issues}`);
  }

  return parsed.data;
}
