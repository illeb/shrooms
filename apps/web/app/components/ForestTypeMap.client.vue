<script setup lang="ts">
import {
  DivIcon,
  GeoJSON,
  Map as LeafletMap,
  Marker,
  TileLayer,
  latLngBounds,
  type LatLngTuple,
  type Layer,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ForestPatch } from '~/composables/useForestPatches';
import { markerHtml, styleOf } from '~/utils/forestStyle';

/**
 * La carta dei tipi di bosco.
 *
 * Rovescia la regola della mappa delle condizioni. Là il colore è il punteggio
 * e il tipo di bosco può essere solo un filtro, perché una mappa non regge due
 * dimensioni cromatiche. Qui il punteggio non esiste, quindi il colore torna
 * libero e va al soggetto: **il tipo di bosco è il colore**, e l'icona lo
 * ripete in forma leggibile anche a chi il colore non lo distingue.
 *
 * L'opacità del riempimento è la frazione boscata: un esagono coperto all'80 %
 * da faggeta si vede pieno, uno al 20 % appena accennato. È la stessa
 * informazione che sulla mappa dei funghi finisce nel popup, e qui può stare
 * in vista perché nessun altro canale la occupa.
 *
 * Le icone compaiono solo da un certo zoom: milletrecento pallini su tutta la
 * regione sarebbero una macchia, e a scala regionale il colore basta.
 */

const props = defineProps<{ patches: ForestPatch[] }>();

const container = ref<HTMLElement | null>(null);
const { element: shell, isFullscreen, toggle } = useFullscreen();
const initError = ref<string | null>(null);

let map: LeafletMap | null = null;
let polygons: Layer | null = null;
/**
 * I marker con la loro posizione, piu' l'insieme di quelli davvero nel DOM.
 *
 * Tenerli separati serve al ritaglio sul riquadro visibile: la posizione si
 * confronta senza toccare il DOM, e si aggiunge o rimuove solo la differenza.
 */
let markers: Array<{ marker: Marker; at: LatLngTuple }> = [];
const shown = new Set<Marker>();

/**
 * Inquadratura automatica finche' l'utente non prende il comando.
 *
 * Al primo `render()` il contenitore puo' non avere ancora la sua altezza
 * definitiva: `fitBounds` calcola lo zoom sulla finestra di quel momento, poi
 * il `ResizeObserver` la ingrandisce e la mappa resta larga il doppio del
 * necessario. Reinquadrare a ogni resize risolve, ma ruberebbe la vista a chi
 * ha appena zoomato su una valle. Quindi: si reinquadra ai resize solo se
 * nessuno ha ancora toccato la mappa - e cosi' anche entrare a schermo intero
 * usa lo spazio nuovo invece di ingrandire il vuoto.
 */
let userMoved = false;
let fitting = false;

/** Sotto questo zoom si mostrano solo i poligoni: le icone si accavallerebbero. */
const ICON_MIN_ZOOM = 10;
const iconsVisible = ref(false);
const iconsDrawn = ref(0);

function popupHtml(p: ForestPatch): string {
  const s = styleOf(p.forestType);
  const row = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;gap:1.5rem;margin-top:.15rem">
       <span style="color:#78716c">${label}</span><strong>${value}</strong>
     </div>`;

  return `
    <div style="font:13px/1.5 ui-sans-serif,system-ui,sans-serif;min-width:16rem">
      <div style="display:flex;align-items:center;gap:.5rem">
        ${markerHtml(p.forestType, 26)}
        <div>
          <div style="font-weight:600;font-size:14px">${s.label}</div>
          <div style="color:#78716c;font-size:11.5px">${s.note}</div>
        </div>
      </div>
      <div style="margin:.5rem 0 .4rem;font-size:12.5px">${p.forestLabel}</div>
      ${row('Quota', `${Math.round(p.altitudeM)} m`)}
      ${row(
        'Bosco nella cella',
        p.forestFraction === null ? '—' : `${Math.round(p.forestFraction * 100)}%`,
      )}
      ${p.management ? row('Governo', p.management) : ''}
      ${row('Provincia', p.provinceName ?? p.province ?? '—')}
      ${row('Codice carta', p.forestCode || '—')}
    </div>`;
}

function toFeatureCollection(patches: ForestPatch[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: patches.map((p) => ({
      type: 'Feature',
      geometry: JSON.parse(p.geoJson) as GeoJSON.Polygon,
      properties: { id: p.id },
    })),
  };
}

function clear() {
  if (polygons && map) map.removeLayer(polygons);
  polygons = null;
  for (const { marker } of markers) marker.remove();
  markers = [];
  shown.clear();
  iconsDrawn.value = 0;
}

function render(patches: ForestPatch[]) {
  if (!map) return;
  clear();
  if (patches.length === 0) return;

  const byId = new Map(patches.map((p) => [p.id, p]));

  polygons = new GeoJSON(toFeatureCollection(patches), {
    style: (feature) => {
      const patch = byId.get(feature?.properties?.id as string);
      if (!patch) return {};
      const s = styleOf(patch.forestType);
      // Da 0.25 a 0.85: anche una cella boscata al 10% deve restare visibile,
      // altrimenti sparirebbe e sembrerebbe che li' non ci sia niente.
      const fraction = patch.forestFraction ?? 0.5;
      return {
        color: s.color,
        weight: 1,
        opacity: 0.9,
        fillColor: s.color,
        fillOpacity: 0.25 + Math.min(fraction, 1) * 0.6,
      };
    },
    onEachFeature: (feature, layer) => {
      const patch = byId.get(feature.properties?.id as string);
      if (patch) layer.bindPopup(popupHtml(patch), { maxWidth: 340 });
    },
  }).addTo(map);

  // I marker restano in memoria anche quando sono fuori dal DOM: ricostruirli
  // a ogni spostamento costerebbe piu' che tenerli.
  markers = patches.map((p) => ({
    at: [p.latitude, p.longitude] as LatLngTuple,
    marker: new Marker([p.latitude, p.longitude], {
      icon: new DivIcon({
        html: markerHtml(p.forestType),
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      interactive: true,
      keyboard: false,
    }).bindPopup(popupHtml(p), { maxWidth: 340 }),
  }));

  syncMarkers();

  // Reinquadra se nessuno ha ancora toccato la mappa, o se dopo il filtro non
  // e' rimasto niente dentro la vista corrente: chi si e' zoomato su una valle
  // non vuole essere riportato in Pianura Padana perche' ha spuntato un tipo
  // di bosco, ma non vuole nemmeno restare a fissare un riquadro vuoto.
  if (!userMoved || !anyInView(patches)) fit(patches);
}

function anyInView(patches: ForestPatch[]): boolean {
  if (!map) return false;
  const view = map.getBounds();
  return patches.some((p) => view.contains([p.latitude, p.longitude]));
}

/**
 * Icone dentro o fuori dalla mappa, secondo lo zoom **e il riquadro visibile**.
 *
 * Il solo filtro di zoom non bastava piu'. Leaflet tiene nel DOM tutti i
 * marker che gli aggiungi, visibili o no: con 1.296 celle passava inosservato,
 * a 4.474 sono altrettanti nodi con un SVG dentro e lo scorrimento diventa
 * legnoso. Qui si aggiungono solo quelli dentro la vista, con un margine del
 * 20% perche' trascinando non compaiano dal nulla sul bordo.
 *
 * Si tocca solo la differenza: chi era dentro e resta dentro non viene
 * ricreato, quindi il costo e' proporzionale a quanto ti sei spostato.
 */
function syncMarkers() {
  if (!map) return;
  const show = map.getZoom() >= ICON_MIN_ZOOM;
  iconsVisible.value = show;

  if (!show) {
    for (const marker of shown) marker.remove();
    shown.clear();
    iconsDrawn.value = 0;
    return;
  }

  const view = map.getBounds().pad(0.2);
  for (const { marker, at } of markers) {
    const inside = view.contains(at);
    if (inside && !shown.has(marker)) {
      marker.addTo(map);
      shown.add(marker);
    } else if (!inside && shown.has(marker)) {
      marker.remove();
      shown.delete(marker);
    }
  }
  iconsDrawn.value = shown.size;
}

function fit(patches: ForestPatch[]) {
  if (!map) return;
  const bounds = latLngBounds([]);
  for (const p of patches) bounds.extend([p.latitude, p.longitude]);
  if (!bounds.isValid()) return;

  fitting = true;
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
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
    map = new LeafletMap(container.value, { center: [44.4, 10.6], zoom: 9 });
    new TileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; contributori <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · bosco: Carta forestale 2025 RER',
    }).addTo(map);

    map.on('zoomend', syncMarkers);
    map.on('moveend', () => {
      fitting = false;
      // Anche lo spostamento, non solo lo zoom: il ritaglio segue la vista.
      syncMarkers();
    });
    // Un trascinamento o una rotella sono l'utente; uno zoom che parte mentre
    // stiamo inquadrando noi non lo e'.
    map.on('dragstart', () => {
      userMoved = true;
    });
    map.on('zoomstart', () => {
      if (!fitting) userMoved = true;
    });

    render(props.patches);

    const observer = new ResizeObserver(() => {
      if (!map) return;
      map.invalidateSize();
      if (!userMoved) fit(props.patches);
    });
    observer.observe(container.value);
    onBeforeUnmount(() => observer.disconnect());
  } catch (error) {
    initError.value = error instanceof Error ? error.message : String(error);
  }
});

watch(() => props.patches, render, { deep: true });

onBeforeUnmount(() => {
  clear();
  map?.remove();
  map = null;
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
      {{ patches.length }} celle<span v-if="!iconsVisible"> · ingrandisci per le icone</span>
      <span v-else-if="iconsDrawn < patches.length"> · {{ iconsDrawn }} icone in vista</span>
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
