/**
 * @mushrooms/mycology-core
 *
 * Motore di previsione micologica. Puro TypeScript: nessuna dipendenza da
 * NestJS, da Prisma o dalla rete, cosi' e' testabile e riutilizzabile ovunque.
 *
 * Il flusso e' in tre stadi, ognuno una funzione pura:
 *
 *   osservazioni giornaliere
 *     -> buildDailyFeatures()   finestre mobili, ETo, bilancio idrico
 *     -> scoreSeries()          regole, innesco, inibitori, fenologia
 *     -> FruitingScore[]        punteggio e classe, giorno per giorno
 *
 * A parte, come secondo parere indipendente, il modello di resa stagionale di
 * Martinez-Pena et al. (2012).
 */

// Primitive numeriche
export * from './math/membership.js';
export * from './water/eto.js';
export * from './water/balance.js';

// Feature store
export * from './features/windows.js';
export * from './features/build.js';

// Motore
export * from './scoring/trigger.js';
export * from './scoring/engine.js';
export * from './scoring/yield-model.js';

// Profili di specie
export * from './profiles/boletus-edulis.js';

// Contratti
export * from './types.js';
