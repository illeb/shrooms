<script setup lang="ts">
import { CircleMarker, Map as LeafletMap, TileLayer, layerGroup, type LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CLASS_COLOR, type Prediction } from '~/composables/useConditions';

/**
 * Mappa delle stazioni, con Leaflet.
 *
 * Scelto al posto di MapLibre dopo che le sue sorgenti GeoJSON si sono
 * rivelate mute sotto il bundler di Nuxt: il web worker che le elabora non
 * finiva fra gli asset, e il risultato era una mappa perfetta con zero punti,
 * senza un solo errore in console. Per duecento marker cliccabili il WebGL non
 * serviva comunque: qui i punti sono elementi SVG nel DOM, e cio' che si vede
 * e' cio' che c'e'.
 *
 * `CircleMarker` invece di `Marker`: niente PNG delle icone, quindi nessun
 * problema di percorsi degli asset, e il colore si imposta direttamente.
 */

const props = defineProps<{ rows: Prediction[]; highlightId?: string }>();

const container = ref<HTMLElement | null>(null);
const initError = ref<string | null>(null);
const plotted = ref(0);

let map: LeafletMap | null = null;
let markers: LayerGroup | null = null;
/** Marker per id, per poter evidenziare senza ridisegnare tutto. */
const byStation = new Map<string, CircleMarker>();

/** Appennino tosco-emiliano: e' dove stanno i dati. */
const CENTER: [number, number] = [44.3, 11.0];
const ZOOM = 8;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function popupHtml(p: Prediction): string {
  const num = (v: number | null, unit = '', digits = 0) =>
    typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '—';

  const row = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;gap:1.5rem;margin-top:.15rem">
       <span style="color:#78716c">${label}</span><strong>${value}</strong>
     </div>`;

  const province = p.station.province ? ` &middot; ${p.station.province}` : '';

  return `
    <div style="font:13px/1.5 ui-sans-serif,system-ui,sans-serif;min-width:15rem">
      <div style="font-weight:600;font-size:14px">${escapeHtml(p.station.name)}${province}</div>
      <div style="margin:.35rem 0 .5rem">
        <span style="display:inline-block;padding:.1rem .5rem;border-radius:99px;
                     background:${CLASS_COLOR[p.class]};color:#fff;font-size:11px">${p.class}</span>
        <span style="margin-left:.4rem;font-weight:700">${p.score.toFixed(1)}</span>
        <span style="color:#78716c">/100</span>
      </div>
      ${row('Quota', num(p.station.altitudeM, ' m'))}
      ${row('Giorni dalla pioggia', p.daysSinceWetEvent === null ? '—' : String(p.daysSinceWetEvent))}
      ${row('Acqua nel suolo', num(p.soilWaterMm, ' mm'))}
      ${row('Pioggia 21 giorni', num(p.precip21dMm, ' mm'))}
      ${row('Maturazione', num(p.triggerScore, '', 2))}
    </div>`;
}

function render(rows: readonly Prediction[]) {
  if (!map || !markers) return;
  markers.clearLayers();
  byStation.clear();

  // I punteggi bassi si disegnano prima, cosi' quelli che contano restano
  // sopra: sono la minoranza e non devono finire coperti.
  const ordered = [...rows].sort((a, b) => a.score - b.score);

  for (const row of ordered) {
    const marker = new CircleMarker([row.station.latitude, row.station.longitude], {
      radius: 5 + (row.score / 100) * 7,
      color: '#ffffff',
      weight: 1.5,
      fillColor: CLASS_COLOR[row.class],
      fillOpacity: 0.85,
    });
    marker.bindPopup(popupHtml(row), { maxWidth: 320 });
    marker.addTo(markers);
    byStation.set(row.station.id, marker);
  }

  plotted.value = rows.length;
  applyHighlight();
}

/**
 * Evidenzia la stazione scelta: la porta al centro, le mette un anello scuro
 * e le apre il popup.
 *
 * E' il caso d'uso di partenza: "cerco Verghereto ma non ricordo dove sta".
 * Cambiare solo il colore non basterebbe fra duecento punti - va portata
 * nell'inquadratura.
 */
function applyHighlight() {
  for (const [id, marker] of byStation) {
    const on = id === props.highlightId;
    marker.setStyle({
      color: on ? '#1c1917' : '#ffffff',
      weight: on ? 3 : 1.5,
      fillOpacity: on ? 1 : 0.85,
    });
    if (on) marker.bringToFront();
  }

  if (!props.highlightId || !map) return;
  const target = byStation.get(props.highlightId);
  if (!target) return;

  map.flyTo(target.getLatLng(), Math.max(map.getZoom(), 10), { duration: 0.8 });
  target.openPopup();
}

onMounted(async () => {
  // Al primo caricamento il contenitore puo' essere ancora senza dimensioni
  // quando onMounted scatta: una mappa costruita su un box 0x0 resta storta.
  await nextTick();
  if (!container.value) {
    initError.value = 'Contenitore della mappa non disponibile.';
    return;
  }
  if (container.value.clientHeight === 0) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  try {
    map = new LeafletMap(container.value, { center: CENTER, zoom: ZOOM });

    new TileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Obbligatoria per la licenza dei dati.
      attribution:
        '&copy; contributori <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    markers = layerGroup().addTo(map);
    render(props.rows);

    // Se il contenitore cambia dimensione, Leaflet va avvisato o continua a
    // disegnare sulle misure vecchie.
    const observer = new ResizeObserver(() => map?.invalidateSize());
    observer.observe(container.value);
    onBeforeUnmount(() => observer.disconnect());
  } catch (error) {
    initError.value = error instanceof Error ? error.message : String(error);
  }
});

watch(() => props.rows, render, { deep: true });
watch(() => props.highlightId, applyHighlight);

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  markers = null;
});
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="container" class="h-full w-full" />
    <div
      v-if="!initError"
      class="pointer-events-none absolute bottom-2 right-2 z-[1000] rounded bg-default/85 px-2 py-1 text-xs text-muted"
    >
      {{ plotted }} punti
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
