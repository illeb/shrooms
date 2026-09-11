<script setup lang="ts">
import { GeoJSON, Map as LeafletMap, TileLayer, latLngBounds, type Layer } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cellColor, type ForestCell } from '~/composables/useForestCells';

/**
 * Mappa a celle di bosco.
 *
 * Regola che tiene in piedi la lettura: **il colore e' il punteggio, il tipo
 * di bosco e' un filtro**. Una mappa non regge due dimensioni cromatiche, e
 * "faggeta sopra i 1000 metri" e' una domanda da fare, non un'informazione da
 * decifrare in legenda.
 *
 * Le celle poco ancorate - lontane da ogni stazione osservata - si disegnano
 * piu' trasparenti: il punteggio c'e', ma viene da pura griglia.
 */

const props = defineProps<{ cells: ForestCell[] }>();

const container = ref<HTMLElement | null>(null);
const initError = ref<string | null>(null);

let map: LeafletMap | null = null;
let layer: Layer | null = null;

const { element: shell, isFullscreen, toggle } = useFullscreen();

/** Oltre questa distanza da una stazione la cella e' solo modello. */
const WEAK_ANCHOR_KM = 6;

function popupHtml(c: ForestCell): string {
  const num = (v: number | null, unit = '', digits = 0) =>
    typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '—';

  const row = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;gap:1.5rem;margin-top:.15rem">
       <span style="color:#78716c">${label}</span><strong>${value}</strong>
     </div>`;

  const anchor =
    c.nearestStationKm === null
      ? '—'
      : `${c.nearestStationKm.toFixed(1)} km` +
        (c.nearestStationKm > WEAK_ANCHOR_KM ? ' <em>(solo griglia)</em>' : '');

  return `
    <div style="font:13px/1.5 ui-sans-serif,system-ui,sans-serif;min-width:16rem">
      <div style="font-weight:600;font-size:14px">${c.forestLabel}</div>
      <div style="color:#78716c;font-size:12px">
        ${Math.round(c.altitudeM)} m${c.province ? ` &middot; ${c.province}` : ''}
      </div>
      <div style="margin:.4rem 0 .5rem">
        <span style="display:inline-block;padding:.1rem .5rem;border-radius:99px;
                     background:${cellColor(c)};color:#fff;font-size:11px">${c.class ?? (c.warmup ? 'storico corto' : 'senza dati')}</span>
        <span style="margin-left:.4rem;font-weight:700">${num(c.score, '', 1)}</span>
        <span style="color:#78716c">/100</span>
      </div>
      ${
        c.warmup
          ? `<div style="margin:-.2rem 0 .5rem;color:#78716c;font-size:11.5px">
               Cella nuova: servono due mesi di meteo prima che il bilancio
               idrico dica qualcosa di vero.
             </div>`
          : ''
      }
      ${row(
        "Giorni dall'innesco",
        c.daysSinceWetEvent === null ? 'nessun innesco' : String(c.daysSinceWetEvent),
      )}
      ${row('Pioggia 5 giorni', num(c.precip5dMm, ' mm'))}
      ${row('Pioggia 21 giorni', num(c.precip21dMm, ' mm'))}
      ${row('Acqua nel suolo', num(c.soilWaterMm, ' mm'))}
      ${row('Maturazione', num(c.triggerScore, '', 2))}
      <div style="margin-top:.45rem;color:#78716c;font-size:11px;line-height:1.35">
        I giorni contano dall'ultima <em>pioggia d'innesco</em> - almeno 20 mm in
        cinque giorni su suolo non arido - non dall'ultima pioggia qualsiasi.
        Dieci millimetri bagnano la superficie e se ne vanno.
      </div>
      ${row('Bosco nella cella', c.forestFraction === null ? '—' : `${Math.round(c.forestFraction * 100)}%`)}
      ${c.management ? row('Governo', c.management) : ''}
      ${row('Stazione più vicina', anchor)}
    </div>`;
}

function toFeatureCollection(cells: ForestCell[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: JSON.parse(c.geoJson) as GeoJSON.Polygon,
      properties: { id: c.id },
    })),
  };
}

function render(cells: ForestCell[]) {
  if (!map) return;
  if (layer) {
    map.removeLayer(layer);
    layer = null;
  }
  if (cells.length === 0) return;

  const byId = new Map(cells.map((c) => [c.id, c]));

  layer = new GeoJSON(toFeatureCollection(cells), {
    style: (feature) => {
      const cell = byId.get(feature?.properties?.id as string);
      if (!cell) return {};
      const weak = (cell.nearestStationKm ?? 99) > WEAK_ANCHOR_KM;
      return {
        color: '#ffffff',
        weight: 1,
        fillColor: cellColor(cell),
        // La trasparenza dice "questa e' modellata, non misurata".
        fillOpacity: weak ? 0.45 : 0.75,
      };
    },
    onEachFeature: (feature, l) => {
      const cell = byId.get(feature.properties?.id as string);
      if (cell) l.bindPopup(popupHtml(cell), { maxWidth: 340 });
    },
  }).addTo(map);

  const bounds = latLngBounds([]);
  for (const c of cells) bounds.extend([c.latitude, c.longitude]);
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
}

onMounted(async () => {
  await nextTick();
  if (!container.value) {
    initError.value = 'Contenitore della mappa non disponibile.';
    return;
  }
  if (container.value.clientHeight === 0) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  try {
    map = new LeafletMap(container.value, { center: [44.4, 10.1], zoom: 10 });
    new TileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; contributori <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · bosco: Carta forestale 2025 RER',
    }).addTo(map);

    render(props.cells);

    const observer = new ResizeObserver(() => map?.invalidateSize());
    observer.observe(container.value);
    onBeforeUnmount(() => observer.disconnect());
  } catch (error) {
    initError.value = error instanceof Error ? error.message : String(error);
  }
});

watch(() => props.cells, render, { deep: true });

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  layer = null;
});
</script>

<template>
  <div ref="shell" class="relative h-full w-full bg-default">
    <div ref="container" class="h-full w-full" />

    <UButton
      v-if="!initError"
      :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
      :aria-label="isFullscreen ? 'Esci da schermo intero' : 'Schermo intero'"
      color="neutral"
      variant="solid"
      size="sm"
      class="absolute right-2 top-2 z-[1000] shadow-md"
      @click="toggle()"
    />

    <div
      v-if="!initError"
      class="pointer-events-none absolute bottom-2 right-2 z-[1000] rounded bg-default/85 px-2 py-1 text-xs text-muted"
    >
      {{ cells.length }} celle
    </div>
    <div
      v-if="initError"
      class="absolute inset-0 z-[1000] flex items-center justify-center bg-default/90 p-6 text-center text-sm"
    >
      <div>
        <p class="font-medium">La mappa non si è caricata</p>
        <p class="mt-1 text-muted">{{ initError }}</p>
      </div>
    </div>
  </div>
</template>
