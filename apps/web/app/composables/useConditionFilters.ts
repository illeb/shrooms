/**
 * Filtri delle condizioni, con la query string come fonte di verita'.
 *
 * Non e' un vezzo: significa che un link porta con se' cio' che stavi
 * guardando. "Guarda Verghereto sopra i 60 punti" diventa un URL da mandare,
 * e il tasto indietro del browser torna alla vista precedente invece che a
 * un'altra pagina.
 *
 * I filtri sono condivisi fra tabella e mappa: cambiarli in una si vede
 * nell'altra, perche' entrambe leggono la stessa rotta.
 */

export interface ConditionFilters {
  species: string;
  minScore: number;
  minAltitudeM: number;
  maxAltitudeM: number;
  /**
   * Stazioni selezionate, per id. Vuoto = nessuna selezione, si vedono tutte.
   *
   * Piu' di una perche' il confronto fra due o tre posti e' la domanda
   * successiva a "dov'e' Corsicchie".
   */
  stationIds: string[];
}

export const FILTER_DEFAULTS: ConditionFilters = {
  species: 'boletus-edulis',
  minScore: 0,
  minAltitudeM: 300,
  maxAltitudeM: 1500,
  stationIds: [],
};

/** Estremi dello slider di quota: dal livello del mare alla vetta piu' alta della rete. */
export const ALTITUDE_RANGE = { min: 0, max: 2000, step: 50 } as const;

function readNumber(value: unknown, fallback: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) ? n : fallback;
}

function readString(value: unknown, fallback: string): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Gli id viaggiano separati da virgola: `?stazione=abc,def`. */
function readIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw.split(',').filter((id) => id.length > 0);
}

export function useConditionFilters() {
  const route = useRoute();
  const router = useRouter();

  const filters = computed<ConditionFilters>(() => ({
    species: readString(route.query['specie'], FILTER_DEFAULTS.species),
    minScore: readNumber(route.query['punteggio'], FILTER_DEFAULTS.minScore),
    minAltitudeM: readNumber(route.query['quotaMin'], FILTER_DEFAULTS.minAltitudeM),
    maxAltitudeM: readNumber(route.query['quotaMax'], FILTER_DEFAULTS.maxAltitudeM),
    stationIds: readIds(route.query['stazione']),
  }));

  /**
   * Scrive nella rotta solo cio' che si discosta dai default.
   *
   * Tiene l'URL leggibile: senza, ogni pagina porterebbe dietro cinque
   * parametri anche quando non si e' toccato nulla.
   */
  function update(patch: Partial<ConditionFilters>): void {
    const next = { ...filters.value, ...patch };

    const query: Record<string, string> = { ...(route.query as Record<string, string>) };
    const set = (key: string, value: string | number, fallback: string | number) => {
      if (value === fallback || value === '') delete query[key];
      else query[key] = String(value);
    };

    set('specie', next.species, FILTER_DEFAULTS.species);
    set('punteggio', next.minScore, FILTER_DEFAULTS.minScore);
    set('quotaMin', next.minAltitudeM, FILTER_DEFAULTS.minAltitudeM);
    set('quotaMax', next.maxAltitudeM, FILTER_DEFAULTS.maxAltitudeM);
    set('stazione', next.stationIds.join(','), '');

    // `replace` e non `push`: trascinare uno slider non deve riempire la
    // cronologia di venti voci.
    void router.replace({ query });
  }

  /** Intervallo di quota come coppia, per lo slider a due maniglie. */
  const altitudeRange = computed<[number, number]>({
    get: (): [number, number] => [filters.value.minAltitudeM, filters.value.maxAltitudeM],
    // Il parametro va annotato: con la destrutturazione TypeScript non riesce
    // a dedurne il tipo dall'overload di `computed`.
    set: (value: [number, number]) => update({ minAltitudeM: value[0], maxAltitudeM: value[1] }),
  });

  const minScore = computed<number>({
    get: () => filters.value.minScore,
    set: (v) => update({ minScore: v }),
  });

  const species = computed<string>({
    get: () => filters.value.species,
    set: (v) => update({ species: v }),
  });

  const stationIds = computed<string[]>({
    get: () => filters.value.stationIds,
    set: (v) => update({ stationIds: v }),
  });

  const isDefault = computed(
    () =>
      filters.value.species === FILTER_DEFAULTS.species &&
      filters.value.minScore === FILTER_DEFAULTS.minScore &&
      filters.value.minAltitudeM === FILTER_DEFAULTS.minAltitudeM &&
      filters.value.maxAltitudeM === FILTER_DEFAULTS.maxAltitudeM &&
      filters.value.stationIds.length === 0,
  );

  function reset(): void {
    update(FILTER_DEFAULTS);
  }

  return { filters, update, reset, isDefault, altitudeRange, minScore, species, stationIds };
}
