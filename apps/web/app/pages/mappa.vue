<script setup lang="ts">
import { CLASS_COLOR } from '~/composables/useConditions';

const { rows, total, species, model, latestDate, pending, error, refresh, positives } =
  await useConditions();
const { stationIds } = useConditionFilters();

const legend = [
  { label: 'buona / eccezionale', color: CLASS_COLOR.buona },
  { label: 'discreta', color: CLASS_COLOR.discreta },
  { label: 'scarsa', color: CLASS_COLOR.scarsa },
  { label: 'nulla', color: CLASS_COLOR.nulla },
];
</script>

<template>
  <UContainer class="py-10">
    <ConditionsHeader
      title="Mappa delle condizioni"
      subtitle="Ogni punto è una stazione meteo. Il colore è la classe di buttata, la dimensione il punteggio. Cliccalo per i dettagli."
      :model="model"
      :latest-date="latestDate"
    />

    <ConditionFilters :rows="rows" :species-options="species" />

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
        {{ rows.length }} stazioni
        <template v-if="total > rows.length">
          <strong class="text-warning">di {{ total }}</strong>: elenco troncato
        </template>
        · <strong class="text-default">{{ positives }}</strong> con condizioni in corso
      </span>
      <div class="flex flex-wrap items-center gap-3">
        <span v-for="l in legend" :key="l.label" class="flex items-center gap-1.5 text-xs">
          <span
            class="inline-block size-3 rounded-full ring-1 ring-white"
            :style="{ backgroundColor: l.color }"
          />
          {{ l.label }}
        </span>
      </div>
    </div>

    <div class="h-[70vh] overflow-hidden rounded-lg border border-default">
      <ClientOnly>
        <ConditionsMap :rows="rows" :highlight-ids="stationIds" />
        <template #fallback>
          <div class="flex h-full items-center justify-center text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
        </template>
      </ClientOnly>
    </div>

    <p class="mt-4 text-xs text-muted">
      I punti sono <strong class="text-default">solo stazioni meteo osservate</strong>: dicono dove
      le condizioni ci sono, non dove cercare. Le celle di bosco stanno nella vista Bosco — qui
      finivano nella stessa lista, e dei punti visibili appena il 7% erano termometri veri.
      Dove manca il micelio non nasce nulla per quanto il meteo sia perfetto.
    </p>
  </UContainer>
</template>
