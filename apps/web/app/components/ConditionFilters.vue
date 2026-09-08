<script setup lang="ts">
import { ALTITUDE_RANGE } from '~/composables/useConditionFilters';
import type { Prediction, SpeciesOption } from '~/composables/useConditions';

const props = defineProps<{
  rows: Prediction[];
  speciesOptions: SpeciesOption[];
}>();

const { altitudeRange, minScore, species, stationIds, reset, isDefault } = useConditionFilters();
const { regions } = await useRegions();
const { selected: selectedRegions, setRegions, toggleRegion } = useRegionFilter();

/**
 * Il filtro di regione non fa parte di `useConditionFilters`.
 *
 * Sta in un composable suo perche' lo usano anche le due viste del bosco, che
 * non condividono nient'altro con questi filtri: metterlo qui avrebbe voluto
 * dire duplicarlo tre volte o legare le viste del bosco allo stato della
 * tabella. L'azzeramento invece va tenuto insieme, altrimenti "azzera" ne
 * lascerebbe uno acceso.
 */
function resetAll(): void {
  reset();
  setRegions([]);
}

const nothingSelected = computed(() => isDefault.value && selectedRegions.value.length === 0);

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

type StationItem = { label: string; suffix: string; value: string };

const selectedStations = computed<StationItem[]>({
  get: () => stationItems.value.filter((i) => stationIds.value.includes(i.value)),
  set: (items) => {
    stationIds.value = items.map((i) => i.value);
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
  () => stationIds.value.filter((id) => !stationItems.value.some((i) => i.value === id)).length,
);
</script>

<template>
  <UCard class="mb-6">
    <div class="mb-5">
      <RegionFilter
        :regions="regions"
        :selected="selectedRegions"
        scope="stations"
        @toggle="toggleRegion"
        @clear="setRegions([])"
      />
    </div>

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
          selectedButFiltered > 0
            ? `${selectedButFiltered} stazione/i scelta/e è fuori dai filtri attuali: allargali per rivederla.`
            : 'Selezionane una o più: la tabella mostra solo quelle, la mappa le evidenzia.'
        "
        :ui="selectedButFiltered > 0 ? { help: 'text-warning' } : undefined"
      >
        <UInputMenu
          v-model="selectedStations"
          multiple
          :items="stationItems"
          placeholder="Corsicchie, Verghereto, Lagdei…"
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
          v-if="!nothingSelected"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="resetAll()"
        >
          Azzera
        </UButton>
      </div>
    </template>
  </UCard>
</template>
