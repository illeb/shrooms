import { useApolloClient } from '@vue/apollo-composable';
import gql from 'graphql-tag';

/**
 * L'elenco delle regioni coperte, dal server e non da una costante.
 *
 * Scritto a mano sarebbe invecchiato al primo ampliamento: fino a stamattina
 * c'era solo l'Emilia-Romagna, e la Toscana e' comparsa importando una carta
 * forestale. Cosi' una regione appare nei filtri appena arrivano i suoi dati.
 *
 * Sta in cache condivisa fra le viste: e' la stessa lista per tabella, mappa,
 * bosco e tipi di bosco, e non ha senso richiederla quattro volte.
 */

export interface RegionCount {
  region: string;
  stations: number;
  cells: number;
}

const REGIONS = gql`
  query Regions {
    regions {
      region
      stations
      cells
    }
  }
`;

/**
 * Quale conteggio mostrare accanto al nome, secondo cosa elenca la vista.
 *
 * `all` esiste per tabella e mappa, che elencano stazioni **e** celle nella
 * stessa lista: mostrarci solo le stazioni farebbe dire al badge "Toscana 12"
 * accanto a una mappa che disegna milletrecento punti.
 */
export type RegionScope = 'stations' | 'cells' | 'all';

export async function useRegions() {
  const { client } = useApolloClient();

  const { data } = await useAsyncData('regions', async () => {
    const { data } = await client.query<{ regions: RegionCount[] }>({
      query: REGIONS,
      fetchPolicy: 'cache-first',
    });
    return data;
  });

  const regions = computed<RegionCount[]>(() => data.value?.regions ?? []);

  return { regions };
}

/**
 * Le regioni scelte, nella query string come `?regione=Toscana,Liguria`.
 *
 * Per nome e non per codice: il nome e' quello che il dato ha in colonna, ed
 * e' anche quello che si legge nell'URL da condividere. Le regioni con uno
 * spazio o un trattino - "Emilia-Romagna" - passano tali e quali, che
 * `router.replace` codifica da solo.
 */
export function useRegionFilter() {
  const route = useRoute();
  const router = useRouter();

  const selected = computed<string[]>(() => {
    const raw = route.query['regione'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.length === 0) return [];
    return value
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  });

  function setRegions(next: string[]): void {
    const query: Record<string, string> = { ...(route.query as Record<string, string>) };
    if (next.length === 0) delete query['regione'];
    else query['regione'] = next.join(',');
    void router.replace({ query });
  }

  function toggleRegion(region: string): void {
    setRegions(
      selected.value.includes(region)
        ? selected.value.filter((r) => r !== region)
        : [...selected.value, region],
    );
  }

  return { selected, setRegions, toggleRegion };
}
