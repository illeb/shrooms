import { useApolloClient } from '@vue/apollo-composable';
import gql from 'graphql-tag';
import { CLASS_COLOR, type FruitingClass } from '~/composables/useConditions';

export type ForestType =
  | 'FAGGETA'
  | 'CASTAGNETO'
  | 'CERRETA'
  | 'QUERCETO'
  | 'ORNO_OSTRIETO'
  | 'CONIFERE'
  | 'MISTO'
  | 'ALTRO';

export interface ForestCell {
  id: string;
  code: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  forestType: ForestType;
  forestLabel: string;
  forestFraction: number | null;
  management: string | null;
  province: string | null;
  provinceName: string | null;
  nearestStationKm: number | null;
  score: number | null;
  class: FruitingClass | null;
  /** Storico troppo corto: il punteggio non c'e' ancora, e non e' uno zero. */
  warmup: boolean;
  triggerScore: number | null;
  daysSinceWetEvent: number | null;
  soilWaterMm: number | null;
  precip21dMm: number | null;
  geoJson: string;
}

const FOREST_CELLS = gql`
  query ForestCells($input: ForestCellsInput) {
    forestCells(input: $input) {
      id
      code
      latitude
      longitude
      altitudeM
      forestType
      forestLabel
      forestFraction
      management
      province
      provinceName
      nearestStationKm
      score
      class
      warmup
      triggerScore
      daysSinceWetEvent
      soilWaterMm
      precip21dMm
      geoJson
    }
    latestPredictionDate
    activeSpeciesModel {
      label
      version
    }
  }
`;

/**
 * Etichette dei tipi di bosco, in ordine di quota: si scende dal crinale al
 * fondovalle, che e' anche l'ordine in cui la stagione li attraversa.
 */
export const FOREST_LABELS: Record<ForestType, string> = {
  FAGGETA: 'Faggeta',
  CONIFERE: 'Conifere',
  MISTO: 'Bosco misto',
  CASTAGNETO: 'Castagneto',
  CERRETA: 'Cerreta',
  ORNO_OSTRIETO: 'Orno-ostrieto',
  QUERCETO: 'Querceto',
  ALTRO: 'Altro bosco',
};

/**
 * Fondo scala dello slider dei giorni dalla pioggia.
 *
 * E' `incubation.maxDays` del profilo: oltre, il contributo dell'innesco e'
 * zero comunque. La finestra ottima del modello e' 12-18 giorni.
 */
export const MAX_DAYS_SINCE_RAIN = 28;
export const OPTIMAL_DAYS_SINCE_RAIN: [number, number] = [12, 18];

export const FOREST_ORDER: ForestType[] = [
  'FAGGETA',
  'CONIFERE',
  'MISTO',
  'CASTAGNETO',
  'CERRETA',
  'ORNO_OSTRIETO',
  'QUERCETO',
  'ALTRO',
];

/** Colore di una cella: sempre e solo il punteggio, mai il tipo di bosco. */
export function cellColor(cell: ForestCell): string {
  return cell.class ? CLASS_COLOR[cell.class] : '#a8a29e';
}

/**
 * Filtri della vista bosco, anch'essi nella query string.
 *
 * Separati da quelli delle stazioni perche' le domande sono diverse: li' si
 * cerca una stazione, qui un tipo di bosco a una certa quota.
 */
export function useForestFilters() {
  const route = useRoute();
  const router = useRouter();

  const types = computed<ForestType[]>(() => {
    const raw = route.query['bosco'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.length === 0) return [];
    return value.split(',').filter((t): t is ForestType => t in FOREST_LABELS);
  });

  const minScore = computed(() => Number(route.query['punteggio'] ?? 0) || 0);
  const onlyNearStations = computed(() => route.query['vicine'] === '1');

  /**
   * Finestra di giorni dall'ultimo innesco, come `pioggia=12-18`.
   *
   * Un intervallo e non un massimo perche' la domanda ha due lati: piovuto
   * ieri vuol dire che il micelio non ha ancora avuto tempo, piovuto un mese
   * fa che si e' riasciugato tutto. Il valore che interessa sta in mezzo, e un
   * solo estremo non lo sa dire.
   */
  const daysSinceRain = computed<[number, number]>(() => {
    const raw = route.query['pioggia'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const match = typeof value === 'string' ? /^(\d{1,2})-(\d{1,2})$/.exec(value) : null;
    if (!match) return [0, MAX_DAYS_SINCE_RAIN];

    const from = Math.min(Number(match[1]), MAX_DAYS_SINCE_RAIN);
    const to = Math.min(Number(match[2]), MAX_DAYS_SINCE_RAIN);
    return from <= to ? [from, to] : [to, from];
  });

  /** Lo slider e' aperto tutto: nessun filtro da mandare al server. */
  const rainFilterOff = computed(
    () => daysSinceRain.value[0] === 0 && daysSinceRain.value[1] === MAX_DAYS_SINCE_RAIN,
  );

  function update(patch: {
    types?: ForestType[];
    minScore?: number;
    onlyNearStations?: boolean;
    daysSinceRain?: [number, number];
  }): void {
    const query: Record<string, string> = { ...(route.query as Record<string, string>) };

    if (patch.types !== undefined) {
      if (patch.types.length === 0) delete query['bosco'];
      else query['bosco'] = patch.types.join(',');
    }
    if (patch.minScore !== undefined) {
      if (patch.minScore === 0) delete query['punteggio'];
      else query['punteggio'] = String(patch.minScore);
    }
    if (patch.onlyNearStations !== undefined) {
      if (patch.onlyNearStations) query['vicine'] = '1';
      else delete query['vicine'];
    }
    if (patch.daysSinceRain !== undefined) {
      const [from, to] = patch.daysSinceRain;
      if (from === 0 && to === MAX_DAYS_SINCE_RAIN) delete query['pioggia'];
      else query['pioggia'] = `${from}-${to}`;
    }

    void router.replace({ query });
  }

  return { types, minScore, onlyNearStations, daysSinceRain, rainFilterOff, update };
}

export async function useForestCells() {
  const { client } = useApolloClient();
  const { types, minScore, onlyNearStations, daysSinceRain, rainFilterOff } = useForestFilters();

  const { data, pending, error, refresh } = await useAsyncData(
    'forest-cells',
    async () => {
      const { data } = await client.query<{
        forestCells: ForestCell[];
        latestPredictionDate: string | null;
        activeSpeciesModel: { label: string; version: number } | null;
      }>({
        query: FOREST_CELLS,
        variables: {
          input: {
            forestTypes: types.value.length > 0 ? types.value : null,
            minScore: minScore.value,
            onlyNearStations: onlyNearStations.value,
            minDaysSinceRain: rainFilterOff.value ? null : daysSinceRain.value[0],
            maxDaysSinceRain: rainFilterOff.value ? null : daysSinceRain.value[1],
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
            minScore.value,
            onlyNearStations.value,
            daysSinceRain.value.join('-'),
          ].join('|'),
      ],
    },
  );

  const cells = computed<ForestCell[]>(() => data.value?.forestCells ?? []);

  return {
    cells,
    pending,
    error,
    refresh,
    latestDate: computed(() => data.value?.latestPredictionDate ?? null),
    model: computed(() => data.value?.activeSpeciesModel ?? null),
  };
}
