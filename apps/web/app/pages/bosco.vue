<script setup lang="ts">
import { CLASS_COLOR } from '~/composables/useConditions';
import {
  FOREST_LABELS,
  FOREST_ORDER,
  MAX_DAYS_SINCE_RAIN,
  OPTIMAL_DAYS_SINCE_RAIN,
  useForestCells,
  useForestFilters,
  type ForestType,
} from '~/composables/useForestCells';

const { cells, countByType, model, latestDate, pending, error, refresh } = await useForestCells();
const { types, minScore, onlyNearStations, daysSinceRain, rainFilterOff, update } =
  useForestFilters();
const { regions } = await useRegions();
const { selected: selectedRegions, setRegions, toggleRegion } = useRegionFilter();

/** Etichetta dello slider: dice cosa stai guardando, non due numeri nudi. */
const rainLabel = computed(() => {
  if (rainFilterOff.value) return 'tutte';
  const [from, to] = daysSinceRain.value;
  const suffix = from === to ? `${from} giorni` : `${from}–${to} giorni`;
  return `${suffix} fa`;
});

function setOptimalRain() {
  update({ daysSinceRain: [...OPTIMAL_DAYS_SINCE_RAIN] as [number, number] });
}

function toggleType(t: ForestType) {
  const next = types.value.includes(t) ? types.value.filter((x) => x !== t) : [...types.value, t];
  update({ types: next });
}

const legend = [
  { label: 'buona / eccezionale', color: CLASS_COLOR.buona },
  { label: 'discreta', color: CLASS_COLOR.discreta },
  { label: 'scarsa', color: CLASS_COLOR.scarsa },
  { label: 'nulla', color: CLASS_COLOR.nulla },
];

const scored = computed(() => cells.value.filter((c) => (c.score ?? 0) >= 35).length);
</script>

<template>
  <UContainer class="py-10">
    <ConditionsHeader
      title="Bosco"
      subtitle="Non stazioni meteo, ma celle di bosco: dove i funghi crescono davvero. Ogni esagono è ~3 km, con la sua specie dominante e la sua quota."
      :model="model"
      :latest-date="latestDate"
    />

    <UCard class="mb-6">
      <div class="space-y-5">
        <RegionFilter
          :regions="regions"
          :selected="selectedRegions"
          scope="cells"
          @toggle="toggleRegion"
          @clear="setRegions([])"
        />

        <UFormField label="Tipo di bosco" help="Nessuno selezionato = tutti">
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="t in FOREST_ORDER"
              :key="t"
              :color="types.includes(t) ? 'primary' : 'neutral'"
              :variant="types.includes(t) ? 'solid' : 'outline'"
              size="sm"
              :disabled="!countByType.get(t)"
              @click="toggleType(t)"
            >
              {{ FOREST_LABELS[t] }}
              <UBadge
                v-if="countByType.get(t)"
                :color="types.includes(t) ? 'neutral' : 'primary'"
                variant="subtle"
                size="sm"
              >
                {{ countByType.get(t) }}
              </UBadge>
            </UButton>
          </div>
        </UFormField>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            class="sm:col-span-2"
            label="Giorni dall'innesco"
            :hint="rainLabel"
            help="Dalla pioggia che conta — almeno 20 mm in cinque giorni — non dall'ultima pioggia qualsiasi. Sotto gli 8 giorni il micelio non ha ancora avuto tempo; oltre i 28 il terreno si è riasciugato"
          >
            <div class="mt-2 flex items-center gap-3">
              <USlider
                :model-value="daysSinceRain"
                :min="0"
                :max="MAX_DAYS_SINCE_RAIN"
                :step="1"
                :min-steps-between-thumbs="0"
                class="flex-1"
                @update:model-value="
                  (v?: number | number[]) =>
                    Array.isArray(v) && v.length === 2
                      ? update({ daysSinceRain: [v[0] as number, v[1] as number] })
                      : undefined
                "
              />
              <UButton
                size="xs"
                color="neutral"
                variant="subtle"
                :disabled="
                  daysSinceRain[0] === OPTIMAL_DAYS_SINCE_RAIN[0] &&
                  daysSinceRain[1] === OPTIMAL_DAYS_SINCE_RAIN[1]
                "
                @click="setOptimalRain()"
              >
                Finestra ottima
              </UButton>
            </div>
          </UFormField>

          <UFormField label="Punteggio minimo" :hint="String(minScore)">
            <USlider
              :model-value="minScore"
              :min="0"
              :max="100"
              :step="5"
              class="mt-2"
              @update:model-value="(v?: number) => update({ minScore: v ?? 0 })"
            />
          </UFormField>

          <UFormField
            label="Affidabilità"
            help="Le celle lontane da ogni stazione sono disegnate più trasparenti"
          >
            <UCheckbox
              :model-value="onlyNearStations"
              label="Solo celle con una stazione entro 5 km"
              @update:model-value="
                (v: boolean | 'indeterminate') => update({ onlyNearStations: v === true })
              "
            />
          </UFormField>
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

    <div class="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>
        {{ cells.length }} celle di bosco ·
        <strong class="text-default">{{ scored }}</strong> almeno discrete
      </span>
      <div class="flex flex-wrap items-center gap-3">
        <span v-for="l in legend" :key="l.label" class="flex items-center gap-1.5 text-xs">
          <span
            class="inline-block size-3 rounded-sm ring-1 ring-white"
            :style="{ backgroundColor: l.color }"
          />
          {{ l.label }}
        </span>
      </div>
    </div>

    <div class="mb-6 h-[62vh] overflow-hidden rounded-lg border border-default">
      <ClientOnly>
        <ForestMap :cells="cells" />
        <template #fallback>
          <div class="flex h-full items-center justify-center text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
        </template>
      </ClientOnly>
    </div>

    <AltitudeProfile :cells="cells" />

    <div class="mt-6 space-y-2 text-xs text-muted">
      <p>
        <strong class="text-default">Il colore è il punteggio, il bosco è un filtro.</strong>
        Una mappa non regge due dimensioni cromatiche: la specie si sceglie coi pulsanti sopra, non
        si legge in legenda.
      </p>
      <p>
        La carta regionale dice la <em>specie dominante</em>, non dove c'è il micelio. Un castagneto
        di tre ettari dentro una faggeta sparisce sotto l'unità minima di mappatura, e dove il
        micelio non c'è non nasce nulla per quanto il meteo sia perfetto.
      </p>
      <p>
        Ogni cella prende il tipo forestale <em>più esteso al suo interno</em>, non quello del suo
        centro: il popup dice anche quanta parte della cella è davvero bosco, perché un esagono
        coperto all'80&nbsp;% e uno a mosaico coi prati non sono la stessa scommessa.
      </p>
      <p>
        Fonte del bosco: Carta forestale regionale 2025 dell'Emilia-Romagna — tipo forestale, specie
        prevalente e governo del bosco. Quota dal modello digitale del terreno.
      </p>
    </div>
  </UContainer>
</template>
