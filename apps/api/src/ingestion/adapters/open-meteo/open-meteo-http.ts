import type { Logger } from '@nestjs/common';

/**
 * GET verso Open-Meteo con backoff sui 429.
 *
 * Open-Meteo non conta le chiamate ma il loro peso, e impone tre limiti
 * sovrapposti: al minuto, all'ora, al giorno. Solo il primo passa aspettando;
 * gli altri due vanno riconosciuti e lasciati perdere subito, perche' restare
 * in attesa un'ora non e' un backoff, e' un blocco.
 *
 * Sta qui e non dentro l'adapter perche' lo usano in due: l'adapter meteo e
 * la generazione delle celle, che interroga l'API elevation. Sono lo stesso
 * servizio dietro lo stesso contatore, e sbagliare il backoff in uno dei due
 * brucia la quota di entrambi.
 */

/** Tentativi su 429 e errori temporanei, con attesa crescente. */
export const OPEN_METEO_MAX_RETRIES = 5;

export async function fetchOpenMeteo<T>(
  url: string,
  endpoint: string,
  logger: Logger,
): Promise<T> {
  let lastError = '';

  for (let attempt = 1; attempt <= OPEN_METEO_MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      // Un guasto di rete - DNS che non risolve, socket chiuso, connessione
      // rifiutata - non produce una risposta, quindi `fetch` solleva. Prima
      // questa riga stava fuori dal try e l'eccezione scavalcava l'intero
      // ciclo di ritentativi: la funzione esisteva per resistere ai guasti
      // transitori e si arrendeva davanti al piu' comune. Visto succedere
      // alla prima ingestione non presidiata, con un `fetch failed` nudo che
      // ha chiuso in PARTIAL una lettura per il resto sana.
      lastError = `rete: ${error instanceof Error ? error.message : String(error)}`;
      if (attempt === OPEN_METEO_MAX_RETRIES) break;

      const waitMs = 2_000 * attempt;
      logger.warn(
        `Open-Meteo ${endpoint} ${lastError} — attendo ${Math.round(waitMs / 1000)}s ` +
          `(tentativo ${attempt}/${OPEN_METEO_MAX_RETRIES})`,
      );
      await sleep(waitMs);
      continue;
    }

    if (response.ok) return (await response.json()) as T;

    const body = await response.text().catch(() => '');
    lastError = `${response.status}: ${body.slice(0, 200)}`;

    // Il limite al minuto passa aspettando; quello orario o giornaliero no:
    // meglio fermarsi subito e riprendere piu' tardi che bruciare tentativi.
    const hardLimit = /hourly|daily/i.test(body);
    const retryable = (response.status === 429 && !hardLimit) || response.status >= 500;
    if (!retryable || attempt === OPEN_METEO_MAX_RETRIES) break;

    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    const waitMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : response.status === 429
        ? 60_000 * attempt
        : 2_000 * attempt;

    logger.warn(
      `Open-Meteo ${endpoint} ${lastError} — attendo ${Math.round(waitMs / 1000)}s ` +
        `(tentativo ${attempt}/${OPEN_METEO_MAX_RETRIES})`,
    );
    await sleep(waitMs);
  }

  throw new Error(`Open-Meteo ${endpoint} ha risposto ${lastError}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
