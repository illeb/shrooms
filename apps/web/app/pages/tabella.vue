<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { CLASS_BADGE, type Prediction } from '~/composables/useConditions';

const { rows, species, model, latestDate, pending, error, refresh } = await useConditions();
const { stationIds } = useConditionFilters();

/**
 * Con una selezione attiva la tabella mostra solo quelle stazioni.
 *
 * E' il senso della ricerca: chi cerca "Corsicchie" vuole vedere Corsicchie,
 * non trovarla evidenziata in mezzo ad altre centottanta righe.
 */
const visibleRows = computed(() =>
  stationIds.value.length === 0
    ? rows.value
    : rows.value.filter((r) => stationIds.value.includes(r.station.id)),
);

const positives = computed(() => visibleRows.value.filter((r) => r.score > 0).length);

/**
 * Intestazione cliccabile per riordinare.
 *
 * L'icona mostra lo stato: freccia doppia se la colonna non ordina, su o giu'
 * se ordina. Senza, non si capisce che le intestazioni si cliccano.
 */
function sortable(label: string) {
  return ({ column }: { column: any }) => {
    const dir = column.getIsSorted();
    return h(resolveComponent('UButton'), {
      color: 'neutral',
      variant: 'ghost',
      size: 'sm',
      label,
      icon: dir
        ? dir === 'asc'
          ? 'i-lucide-arrow-up-narrow-wide'
          : 'i-lucide-arrow-down-wide-narrow'
        : 'i-lucide-arrow-up-down',
      trailing: true,
      class: '-mx-2 font-medium',
      onClick: () => column.toggleSorting(dir === 'asc'),
    });
  };
}

const columns: TableColumn<Prediction>[] = [
  {
    accessorKey: 'score',
    header: sortable('Punteggio'),
    cell: ({ row }) =>
      h('span', { class: 'font-semibold tabular-nums' }, row.original.score.toFixed(1)),
  },
  {
    accessorKey: 'class',
    header: sortable('Buttata'),
    cell: ({ row }) =>
      h(
        resolveComponent('UBadge'),
        { color: CLASS_BADGE[row.original.class], variant: 'subtle', size: 'sm' },
        () => row.original.class,
      ),
  },
  {
    id: 'station',
    accessorFn: (row) => row.station.name,
    header: sortable('Stazione'),
    cell: ({ row }) => h('span', { class: 'font-medium' }, row.original.station.name),
  },
  {
    id: 'province',
    accessorFn: (row) => row.station.province ?? '',
    header: sortable('Provincia'),
    cell: ({ row }) =>
      row.original.station.province
        ? h('div', { class: 'flex items-baseline gap-1.5' }, [
            h('span', { class: 'font-medium' }, row.original.station.province),
            h('span', { class: 'text-xs text-muted' }, row.original.station.provinceName ?? ''),
          ])
        : h('span', { class: 'text-muted' }, '—'),
  },
  {
    id: 'altitude',
    accessorFn: (row) => row.station.altitudeM ?? -1,
    header: sortable('Quota'),
    cell: ({ row }) =>
      h(
        'span',
        { class: 'tabular-nums' },
        row.original.station.altitudeM === null
          ? '—'
          : `${Math.round(row.original.station.altitudeM)} m`,
      ),
  },
  {
    accessorKey: 'daysSinceWetEvent',
    header: sortable('Giorni dalla pioggia'),
    cell: ({ row }) =>
      h(
        'span',
        { class: 'tabular-nums' },
        row.original.daysSinceWetEvent === null ? '—' : String(row.original.daysSinceWetEvent),
      ),
  },
  {
    accessorKey: 'soilWaterMm',
    header: sortable('Acqua nel suolo'),
    cell: ({ row }) =>
      h(
        'span',
        { class: 'tabular-nums' },
        row.original.soilWaterMm === null ? '—' : `${Math.round(row.original.soilWaterMm)} mm`,
      ),
  },
  {
    accessorKey: 'triggerScore',
    header: sortable('Maturazione'),
    cell: ({ row }) =>
      h('span', { class: 'tabular-nums text-muted' }, row.original.triggerScore.toFixed(2)),
  },
];

// Ordinamento iniziale: il punteggio, che e' la domanda che si fa chi guarda.
const sorting = ref([{ id: 'score', desc: true }]);
</script>

<template>
  <UContainer class="py-10">
    <ConditionsHeader
      title="Condizioni di fruttificazione"
      subtitle="Dove ci sono adesso le condizioni perché i porcini stiano buttando. Nessuna previsione meteo: il giudizio guarda alla pioggia caduta e alle temperature che l'hanno seguita."
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

    <div class="mb-3 flex items-center justify-between text-sm text-muted">
      <span>
        <template v-if="stationIds.length > 0">
          {{ visibleRows.length }} selezionate su {{ rows.length }} ·
        </template>
        <template v-else> {{ rows.length }} stazioni · </template>
        <strong class="text-default">{{ positives }}</strong> con condizioni in corso
      </span>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="pending"
        @click="refresh()"
      >
        Aggiorna
      </UButton>
    </div>

    <UTable
      v-model:sorting="sorting"
      :data="visibleRows"
      :columns="columns"
      :loading="pending"
      sticky
      class="max-h-[70vh]"
    >
      <template #empty>
        <div class="py-10 text-center text-muted">
          Nessuna stazione nei filtri scelti. In questo momento, lì, non ci sono condizioni.
        </div>
      </template>
    </UTable>

    <div class="mt-6 space-y-2 text-xs text-muted">
      <p>
        <strong class="text-default">Maturazione</strong> — se c'è stata una pioggia abbastanza
        grossa e sono passati i giorni giusti perché adesso stia producendo. Vale 1 nel cuore della
        finestra (12–18 giorni dopo la pioggia), 0 se non è piovuto, se è piovuto ieri o se è
        piovuto un mese fa.
      </p>
      <p>
        <strong class="text-default">Acqua nel suolo</strong> — quanta pioggia il terreno sta ancora
        trattenendo, non quanta ne è caduta. È la differenza fra 150 mm d'agosto, che evaporano, e
        80 mm d'ottobre, che restano.
      </p>
      <p>
        Il punteggio dice che le condizioni meteo ci sono, non che i funghi ci siano: dove manca il
        micelio non nasce nulla. Le stazioni sono punti di misura, non boschi.
      </p>
    </div>
  </UContainer>
</template>
