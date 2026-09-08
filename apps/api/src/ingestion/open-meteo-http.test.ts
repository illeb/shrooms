import type { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenMeteo } from './adapters/open-meteo/open-meteo-http';

/**
 * Il backoff verso Open-Meteo.
 *
 * Con i timer finti: le attese vere sono di secondi e crescono a ogni
 * tentativo, e una suite che le aspettasse davvero verrebbe disattivata dal
 * primo che perde la pazienza.
 */

const logger = { warn: vi.fn() } as unknown as Logger;

/** Lancia la lettura, fa scorrere le attese, restituisce la promessa. */
async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const promise = run();
    // Le attese vanno consumate mentre la promessa e' in volo, altrimenti
    // `sleep` non si risolve mai e il test si blocca invece di fallire.
    const settled = promise.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await settled;
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchOpenMeteo', () => {
  it('ritenta un guasto di rete e va a buon fine', async () => {
    // Il caso che prima scavalcava il ciclo: `fetch` che solleva invece di
    // rispondere. Una lettura di dieci ore non deve morire per un pacchetto
    // perso.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(withFakeTimers(() => fetchOpenMeteo('http://x', 'archive', logger))).resolves.toEqual({
      ok: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si arrende dopo i tentativi, e dice che era la rete', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      withFakeTimers(() => fetchOpenMeteo('http://x', 'recent', logger)),
    ).rejects.toThrow(/rete: fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('ritenta il limite al minuto, che passa aspettando', async () => {
    const limite = {
      ok: false,
      status: 429,
      text: async () => '{"reason":"Minutely API request limit exceeded."}',
      headers: { get: () => null },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limite)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(withFakeTimers(() => fetchOpenMeteo('http://x', 'archive', logger))).resolves.toEqual({
      ok: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('non ritenta il limite giornaliero: aspettare non lo sblocca', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"reason":"Daily API request limit exceeded. Try tomorrow."}',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      withFakeTimers(() => fetchOpenMeteo('http://x', 'archive', logger)),
    ).rejects.toThrow(/Daily/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
