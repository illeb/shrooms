<script setup lang="ts">
import {
  ALTITUDE_BOUNDS,
  useForestPatches,
  useForestPatchFilters,
} from '~/composables/useForestPatches';
import { FOREST_STYLE_ORDER, markerHtml, styleOf } from '~/utils/forestStyle';

const { patches, shownByType, totals, pending, error, refresh } = await useForestPatches();
const { types, altitude, minForestPct, update } = useForestPatchFilters();

/** Solo i tipi che esistono davvero a database: gli altri non meritano un pulsante. */
const present = computed(() => {
  const known = new Set(totals.value.map((t) => t.forestType));
  return FOREST_STYLE_ORDER.filter((t) => known.has(t));
});

const totalByType = computed(
  () => new Map(totals.value.map((t) => [t.forestType, t] as const)),
);

function toggleType(t: string) {
  update({ types: types.value.includes(t) ? types.value.filter((x) => x !== t) : [...types.value, t] });
}

const altitudeLabel = computed(() => {
  const [from, to] = altitude.value;
  if (from === ALTITUDE_BOUNDS[0] && to === ALTITUDE_BOUNDS[1]) return 'tutte le quote';
  return `${from}–${to} m`;
});

const filtersActive = computed(
  () => types.value.length > 0 || minForestPct.value > 0 || altitudeLabel.value !== 'tutte le quote',
);

function reset() {
  update({ types: [], altitude: [...ALTITUDE_BOUNDS], minForestPct: 0 });
}
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold">Tipi di bosco</h1>
      <p class="mt-1 max-w-3xl text-sm text-muted">
        Che bosco c'è, non se stia buttando. Qui non entra nessuna previsione: sono le stesse celle
        della vista Bosco, ma colorate e marcate per <strong>tipo forestale</strong>, come li
        distingue la Carta forestale regionale 2025.
      </p>
    </div>

    <UCard class="mb-6">
      <div class="space-y-5">
        <UFormField label="Tipo di bosco" help="Nessuno selezionato = tutti">
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="t in present"
              :key="t"
              :color="types.includes(t) ? 'primary' : 'neutral'"
              :variant="types.includes(t) ? 'solid' : 'outline'"
              size="sm"
              @click="toggleType(t)"
            >
              <span
                class="inline-flex size-4 items-center justify-center"
                v-html="markerHtml(t, 16)"
              />
              {{ styleOf(t).label }}
              <UBadge
                :color="types.includes(t) ? 'neutral' : 'primary'"
                variant="subtle"
                size="sm"
              >
                {{ shownByType.get(t) ?? 0 }}
              </UBadge>
            </UButton>
          </div>
        </UFormField>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField label="Quota" :hint="altitudeLabel">
            <USlider
              :model-value="altitude"
              :min="ALTITUDE_BOUNDS[0]"
              :max="ALTITUDE_BOUNDS[1]"
              :step="50"
              class="mt-2"
              @update:model-value="
                (v?: number | number[]) =>
                  Array.isArray(v) && v.length === 2
                    ? update({ altitude: [v[0] as number, v[1] as number] })
                    : undefined
              "
            />
          </UFormField>

          <UFormField
            label="Bosco nella cella"
            :hint="minForestPct > 0 ? `almeno ${minForestPct}%` : 'qualsiasi'"
            help="Alzalo per lasciare solo il bosco pieno e togliere le celle a mosaico con prati e coltivi"
          >
            <USlider
              :model-value="minForestPct"
              :min="0"
              :max="90"
              :step="5"
              class="mt-2"
              @update:model-value="(v?: number) => update({ minForestPct: v ?? 0 })"
            />
          </UFormField>
        </div>

        <div v-if="filtersActive" class="flex justify-end">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="reset()">
            Azzera i filtri
          </UButton>
        </div>
      </div>
    </UCard>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Backend non raggiungibile"
      :description="error.message"
      class="mb-6"
    >
      <template #actions>
        <UButton color="error" variant="outline" size="sm" @click="refresh()">Riprova</UButton>
      </template>
    </UAlert>

    <div class="mb-3 flex items-center gap-2 text-sm text-muted">
      <UIcon v-if="pending" name="i-lucide-loader-circle" class="size-4 animate-spin" />
      <span>
        <strong class="text-default">{{ patches.length }}</strong> celle mostrate su
        {{ totals.reduce((n, t) => n + t.cells, 0) }}
      </span>
    </div>

    <div class="mb-6 h-[68vh] overflow-hidden rounded-lg border border-default">
      <ClientOnly>
        <ForestTypeMap :patches="patches" />
        <template #fallback>
          <div class="flex h-full items-center justify-center text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
        </template>
      </ClientOnly>
    </div>

    <UCard>
      <template #header>
        <div>
          <h2 class="text-sm font-semibold">Legenda</h2>
          <p class="mt-0.5 text-xs text-muted">
            Il riempimento dice quanta parte della cella è davvero bosco: pieno vuol dire coperta,
            appena accennato vuol dire bosco a mosaico.
          </p>
        </div>
      </template>

      <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div v-for="t in present" :key="t" class="flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0" v-html="markerHtml(t, 24)" />
          <div class="min-w-0">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="text-sm font-medium">{{ styleOf(t).label }}</span>
              <span class="text-xs tabular-nums text-muted">
                {{ totalByType.get(t)?.cells ?? 0 }} celle ·
                {{ Math.round(totalByType.get(t)?.minAltitudeM ?? 0) }}–{{
                  Math.round(totalByType.get(t)?.maxAltitudeM ?? 0)
                }}
                m
              </span>
            </div>
            <p class="text-xs text-muted">{{ styleOf(t).note }}</p>
          </div>
        </div>
      </div>
    </UCard>

    <div class="mt-6 space-y-2 text-xs text-muted">
      <p>
        <strong class="text-default">Le icone distinguono la fisionomia, il colore il tipo.</strong>
        Nessun set di icone ha un simbolo per il faggio e uno diverso per il cerro — sono due
        latifoglie e si somigliano. Le icone separano latifoglia d'alto fusto, conifera, bosco magro
        di versante e castagneto; il colore fa il resto, e la legenda tiene insieme le due cose.
      </p>
      <p>
        Ogni cella prende il tipo forestale <em>più esteso al suo interno</em>, non quello del suo
        centro. Sotto l'unità minima di mappatura le presenze piccole scompaiono: un castagneto di
        tre ettari dentro una faggeta non si vede qui.
      </p>
      <p>
        Fonte: Carta forestale regionale 2025 dell'Emilia-Romagna — tipo forestale, specie
        prevalente e governo del bosco. Quota dal modello digitale del terreno.
      </p>
    </div>
  </UContainer>
</template>
