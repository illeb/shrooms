import { useApolloClient } from '@vue/apollo-composable';
import gql from 'graphql-tag';

/**
 * Le celle di bosco, senza previsioni.
 *
 * Separato da `useForestCells` di proposito, anche se le celle sono le stesse:
 * qui non entra nulla che riguardi i funghi, quindi la vista non dipende dal
 * modello attivo e non si rompe se un giorno il punteggio cambia forma.
 */

export interface ForestPatch {
  id: string;
  code: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  forestType: string;
  forestLabel: string;
  forestCode: string;
  forestFraction: number | null;
  management: string | null;
  province: string | null;
  provinceName: string | null;
  region: string | null;
  geoJson: string;
}

export interface ForestTypeCount {
  forestType: string;
  cells: number;
  meanAltitudeM: number;
  minAltitudeM: number;
  maxAltitudeM: number;
}

const FOREST_PATCHES = gql`
  query ForestPatches($input: ForestPatchesInput, $regions: [String!]) {
    forestPatches(input: $input) {
      id
      code
      latitude
      longitude
      altitudeM
      forestType
      forestLabel
      forestCode
      forestFraction
      management
      province
      provinceName
      region
      geoJson
    }
    forestTypeCounts(regions: $regions) {
      forestType
      cells
      meanAltitudeM
      minAltitudeM
      maxAltitudeM
    }
  }
`;

/** Estremi dello slider di quota: la fascia in cui le celle esistono. */
export const ALTITUDE_BOUNDS: [number, number] = [500, 1900];

/**
 * Filtri della carta dei boschi, in query string come le altre viste.
 *
 * `tipo` e `quota` e non `bosco` e `altitudine`: sono chiavi diverse da quelle
 * della vista condizioni proprio perche' le due mappe rispondono a domande
 * diverse, e un link a una non deve trascinare i filtri dell'altra.
 */
export function useForestPatchFilters() {
  const route = useRoute();
  const router = useRouter();

  const types = computed<string[]>(() => {
    const raw = route.query['tipo'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.length === 0) return [];
    return value.split(',').filter((t) => t in FOREST_STYLE);
  });

  const altitude = computed<[number, number]>(() => {
    const raw = route.query['quota'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const match = typeof value === 'string' ? /^(\d{3,4})-(\d{3,4})$/.exec(value) : null;
    if (!match) return [...ALTITUDE_BOUNDS];

    const clamp = (n: number) =>
      Math.min(Math.max(n, ALTITUDE_BOUNDS[0]), ALTITUDE_BOUNDS[1]);
    const from = clamp(Number(match[1]));
    const to = clamp(Number(match[2]));
    return from <= to ? [from, to] : [to, from];
  });

  /** Frazione boscata minima, in percento nella URL perche' `35` legge meglio di `0.35`. */
  const minForestPct = computed(() => {
    const raw = route.query['boscato'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n) : 0;
  });

  function update(patch: {
    types?: string[];
    altitude?: [number, number];
    minForestPct?: number;
  }): void {
    const query: Record<string, string> = { ...(route.query as Record<string, string>) };

    if (patch.types !== undefined) {
      if (patch.types.length === 0) delete query['tipo'];
      else query['tipo'] = patch.types.join(',');
    }
    if (patch.altitude !== undefined) {
      const [from, to] = patch.altitude;
      if (from === ALTITUDE_BOUNDS[0] && to === ALTITUDE_BOUNDS[1]) delete query['quota'];
      else query['quota'] = `${from}-${to}`;
    }
    if (patch.minForestPct !== undefined) {
      if (patch.minForestPct <= 0) delete query['boscato'];
      else query['boscato'] = String(patch.minForestPct);
    }

    void router.replace({ query });
  }

  return { types, altitude, minForestPct, update };
}

export async function useForestPatches() {
  const { client } = useApolloClient();
  const { types, altitude, minForestPct } = useForestPatchFilters();
  const { selected: selectedRegions } = useRegionFilter();

  const { data, pending, error, refresh } = await useAsyncData(
    'forest-patches',
    async () => {
      const { data } = await client.query<{
        forestPatches: ForestPatch[];
        forestTypeCounts: ForestTypeCount[];
      }>({
        query: FOREST_PATCHES,
        variables: {
          regions: selectedRegions.value.length > 0 ? selectedRegions.value : null,
          input: {
            forestTypes: types.value.length > 0 ? types.value : null,
            regions: selectedRegions.value.length > 0 ? selectedRegions.value : null,
            minAltitudeM: altitude.value[0],
            maxAltitudeM: altitude.value[1],
            minForestFraction: minForestPct.value / 100,
          },
        },
        fetchPolicy: 'network-only',
      });
      return data;
    },
    {
      watch: [
        () =>
          [
            types.value.join(','),
            altitude.value.join('-'),
            minForestPct.value,
            selectedRegions.value.join(','),
          ].join('|'),
      ],
    },
  );

  const patches = computed<ForestPatch[]>(() => data.value?.forestPatches ?? []);

  return {
    patches,
    /**
     * Conteggi per tipo entro la regione scelta, ciechi agli altri filtri.
     *
     * Deliberato: un contatore che scende a zero appena selezioni un tipo non
     * ti dice piu' quanti sono gli altri, e non puoi aggiungerne un secondo
     * sapendo cosa stai aggiungendo.
     */
    totals: computed<ForestTypeCount[]>(() => data.value?.forestTypeCounts ?? []),
    pending,
    error,
    refresh,
  };
}
