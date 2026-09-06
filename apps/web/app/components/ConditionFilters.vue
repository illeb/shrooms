<script setup lang="ts">
import { ALTITUDE_RANGE } from '~/composables/useConditionFilters';
import type { Prediction, SpeciesOption } from '~/composables/useConditions';

const props = defineProps<{
  rows: Prediction[];
  speciesOptions: SpeciesOption[];
}>();

const { altitudeRange, minScore, species, stationId, reset, isDefault } = useConditionFilters();

/**
 * Voci dell'autocomplete.
 *
 * Costruite dalle stazioni gia' caricate, non da una query dedicata: la lista
 * e' di duecento voci e cercarci dentro sul client e' istantaneo. La provincia
 * sta nella label perche' i toponimi italiani si ripetono.
 */
const stationItems = computed(() =>
  [...props.rows]
    .sort((a, b) => a.station.name.localeCompare(b.station.name, 'it'))
    .map((r) => ({
      label: r.station.name,
      suffix: [
        r.station.province,
        r.station.altitudeM ? `${Math.round(r.station.altitudeM)} m` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      value: r.station.id,
    })),
);

const selectedStation = computed({
  get: () => stationItems.value.find((i) => i.value === stationId.value) ?? undefined,
  set: (item) => {
    stationId.value = item?.value ?? '';
  },
});

const speciesItems = computed(() =>
  props.speciesOptions.map((s) => ({ label: s.label, value: s.species })),
);

/**
 * Stazione scelta ma esclusa dai filtri di quota o punteggio.
 *
 * Senza avviso il campo resterebbe vuoto mentre l'indirizzo indica una
 * stazione: sembrerebbe un errore invece che una conseguenza dei filtri.
 */
const selectedButFiltered = computed(
  () => stationId.value !== '' && !stationItems.value.some((i) => i.value === stationId.value),
);
</script>

<template>
  <UCard class="mb-6">
    <div class="grid gap-5 lg:grid-cols-2">
      <UFormField label="Fungo">
        <USelectMenu
          v-model="species"
          :items="speciesItems"
          value-key="value"
          :disabled="speciesItems.length < 2"
          class="w-full"
        />
        <template v-if="speciesItems.length < 2" #help>
          Per ora c'è solo il porcino: la lista si popola dai profili attivi.
        </template>
      </UFormField>

      <UFormField
        label="Cerca una stazione"
        :help="
          selectedButFiltered
            ? 'La stazione scelta è fuori dai filtri attuali: allargali per rivederla.'
            : 'Selezionala per evidenziarla sulla mappa'
        "
        :ui="selectedButFiltered ? { help: 'text-warning' } : undefined"
      >
        <UInputMenu
          v-model="selectedStation"
          :items="stationItems"
          placeholder="Verghereto, Lagdei, Pievepelago…"
          icon="i-lucide-search"
          :search-input="{ placeholder: 'Scrivi il nome…' }"
          class="w-full"
        >
          <template #item-trailing="{ item }">
            <span class="text-xs text-muted">{{ item.suffix }}</span>
          </template>
        </UInputMenu>
      </UFormField>

      <UFormField label="Quota" :hint="`${altitudeRange[0]} – ${altitudeRange[1]} m`">
        <USlider
          v-model="altitudeRange"
          :min="ALTITUDE_RANGE.min"
          :max="ALTITUDE_RANGE.max"
          :step="ALTITUDE_RANGE.step"
          :min-steps-between-thumbs="1"
          class="mt-2"
        />
      </UFormField>

      <UFormField label="Punteggio minimo" :hint="String(minScore)">
        <USlider v-model="minScore" :min="0" :max="100" :step="5" class="mt-2" />
      </UFormField>
    </div>

    <template #footer>
      <div class="flex items-center justify-between text-xs text-muted">
        <span
          >I filtri restano nell'indirizzo: la pagina si può salvare o condividere così com'è.</span
        >
        <UButton
          v-if="!isDefault"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="reset()"
        >
          Azzera
        </UButton>
      </div>
    </template>
  </UCard>
</template>
