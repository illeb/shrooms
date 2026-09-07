<script setup lang="ts">
import type { RegionCount, RegionScope } from '~/composables/useRegions';

/**
 * Il filtro di regione, uguale in tutte le viste.
 *
 * Pulsanti e non un menu a tendina: le regioni sono poche e i conteggi
 * accanto al nome dicono subito dov'e' il grosso del dato. Vuoto = tutte, la
 * stessa convenzione degli altri filtri a pulsanti.
 *
 * Le regioni di confine restano in elenco con i loro numeri minuscoli - nove
 * celle in Liguria, quattro in Umbria - perche' la griglia esagonale non si
 * ferma sul confine amministrativo, e nasconderle vorrebbe dire non poterle
 * piu' togliere di mezzo.
 */

const props = defineProps<{
  regions: RegionCount[];
  selected: string[];
  /** Se contare stazioni o celle: la vista sa cosa sta elencando. */
  scope: RegionScope;
}>();

const emit = defineEmits<{ toggle: [region: string]; clear: [] }>();

function count(r: RegionCount): number {
  return props.scope === 'all' ? r.stations + r.cells : r[props.scope];
}

/** Solo le regioni che hanno qualcosa da mostrare in questa vista. */
const visible = computed(() => props.regions.filter((r) => count(r) > 0));
</script>

<template>
  <UFormField label="Regione" help="Nessuna selezionata = tutte">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-for="r in visible"
        :key="r.region"
        :color="selected.includes(r.region) ? 'primary' : 'neutral'"
        :variant="selected.includes(r.region) ? 'solid' : 'outline'"
        size="sm"
        @click="emit('toggle', r.region)"
      >
        {{ r.region }}
        <UBadge
          :color="selected.includes(r.region) ? 'neutral' : 'primary'"
          variant="subtle"
          size="sm"
        >
          {{ count(r) }}
        </UBadge>
      </UButton>

      <UButton
        v-if="selected.length > 0"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        @click="emit('clear')"
      >
        tutte
      </UButton>
    </div>
  </UFormField>
</template>
