import { useApolloClient } from '@vue/apollo-composable';
import gql from 'graphql-tag';

export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  province: string | null;
  provinceName: string | null;
  region: string | null;
}

export interface Prediction {
  id: string;
  date: string;
  score: number;
  class: FruitingClass;
  triggerScore: number;
  phenologyScore: number;
  daysSinceWetEvent: number | null;
  soilWaterMm: number | null;
  swi: number | null;
  precip21dMm: number | null;
  warmup: boolean;
  station: Station;
}

export type FruitingClass = 'nulla' | 'scarsa' | 'discreta' | 'buona' | 'eccezionale';

export interface SpeciesOption {
  species: string;
  label: string;
}

interface QueryResult {
  latestPredictionDate: string | null;
  activeSpeciesModel: { species: string; version: number; label: string } | null;
  availableSpecies: SpeciesOption[];
  predictions: Prediction[];
}

const CONDITIONS = gql`
  query Conditions($input: PredictionsInput, $species: String) {
    latestPredictionDate(species: $species)
    activeSpeciesModel(species: $species) {
      species
      version
      label
    }
    availableSpecies {
      species
      label
    }
    predictions(input: $input) {
      id
      date
      score
      class
      triggerScore
      phenologyScore
      daysSinceWetEvent
      soilWaterMm
      swi
      precip21dMm
      warmup
      station {
        id
        name
        latitude
        longitude
        altitudeM
        province
        provinceName
        region
      }
    }
  }
`;

/**
 * Colori delle classi di buttata.
 *
 * La scala non e' un gradiente: il rosso segnala "qui non c'e' niente", non
 * "attenzione". E' la convenzione chiesta, e va tenuta identica fra mappa e
 * tabella perche' chi passa da una all'altra non debba reimpararla.
 */
export const CLASS_COLOR: Record<FruitingClass, string> = {
  eccezionale: '#16a34a', // verde
  buona: '#16a34a', // verde
  discreta: '#eab308', // giallo
  scarsa: '#2563eb', // blu
  nulla: '#dc2626', // rosso
};

/** Colori Nuxt UI corrispondenti, per i badge. */
export const CLASS_BADGE: Record<FruitingClass, string> = {
  eccezionale: 'success',
  buona: 'success',
  discreta: 'warning',
  scarsa: 'info',
  nulla: 'error',
};

/**
 * Dati delle condizioni, condivisi fra tabella e mappa.
 *
 * `useAsyncData` invece di `useQuery` di @vue/apollo-composable: quest'ultimo
 * non trasferisce il risultato dal server al client in Nuxt, causando una
 * seconda fetch e un lampo di stato vuoto in idratazione. La libreria resta
 * Apollo, cambia solo chi tiene lo stato.
 */
export async function useConditions() {
  const { client } = useApolloClient();
  const { filters } = useConditionFilters();
  const { selected: selectedRegions } = useRegionFilter();

  const { data, pending, error, refresh } = await useAsyncData(
    'conditions',
    async () => {
      const { data } = await client.query<QueryResult>({
        query: CONDITIONS,
        variables: {
          species: filters.value.species,
          input: {
            species: filters.value.species,
            minScore: filters.value.minScore,
            minAltitudeM: filters.value.minAltitudeM,
            maxAltitudeM: filters.value.maxAltitudeM,
            regions: selectedRegions.value.length > 0 ? selectedRegions.value : null,
            limit: 1000,
          },
        },
        fetchPolicy: 'network-only',
      });
      return data;
    },
    // La stazione evidenziata non tocca la query: e' solo una selezione visiva.
    {
      watch: [
        () =>
          [
            filters.value.species,
            filters.value.minScore,
            filters.value.minAltitudeM,
            filters.value.maxAltitudeM,
            selectedRegions.value.join(','),
          ].join('|'),
      ],
    },
  );

  return {
    filters,
    pending,
    error,
    refresh,
    rows: computed<Prediction[]>(() => data.value?.predictions ?? []),
    species: computed<SpeciesOption[]>(() => data.value?.availableSpecies ?? []),
    model: computed(() => data.value?.activeSpeciesModel ?? null),
    latestDate: computed(() => data.value?.latestPredictionDate ?? null),
    positives: computed(() => (data.value?.predictions ?? []).filter((r) => r.score > 0).length),
  };
}
