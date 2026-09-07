<script setup lang="ts">
import { CLASS_COLOR } from '~/composables/useConditions';
import type { ForestCell } from '~/composables/useForestCells';

/**
 * Profilo punteggio x quota.
 *
 * Risponde a una domanda che la mappa non risponde: **a che altezza si sta
 * buttando adesso**. E' il comportamento tipico dei porcini - la fascia
 * produttiva sale in estate e scende in autunno - e vederla muoversi di
 * settimana in settimana vale piu' di qualsiasi classifica.
 *
 * Barre e non una curva: i dati sono raggruppati per fascia di 200 m, e una
 * linea continua suggerirebbe un'interpolazione che non abbiamo.
 */

const props = defineProps<{ cells: ForestCell[] }>();

const BAND_M = 200;

interface Band {
  from: number;
  to: number;
  count: number;
  meanScore: number;
  best: number;
}

const bands = computed<Band[]>(() => {
  const scored = props.cells.filter((c) => typeof c.score === 'number');
  if (scored.length === 0) return [];

  const buckets = new Map<number, number[]>();
  for (const c of scored) {
    const key = Math.floor(c.altitudeM / BAND_M) * BAND_M;
    const list = buckets.get(key) ?? [];
    list.push(c.score as number);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .map(([from, scores]) => ({
      from,
      to: from + BAND_M,
      count: scores.length,
      meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      best: Math.max(...scores),
    }))
    .sort((a, b) => b.from - a.from);
});

const maxMean = computed(() => Math.max(10, ...bands.value.map((b) => b.meanScore)));

/** Il colore della barra segue la classe che il punteggio medio raggiungerebbe. */
function barColor(score: number): string {
  if (score >= 80) return CLASS_COLOR.eccezionale;
  if (score >= 60) return CLASS_COLOR.buona;
  if (score >= 35) return CLASS_COLOR.discreta;
  if (score >= 15) return CLASS_COLOR.scarsa;
  return CLASS_COLOR.nulla;
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="text-sm font-semibold">A che quota si sta buttando</h2>
        <p class="mt-0.5 text-xs text-muted">
          Punteggio medio per fascia di 200 m. La fascia produttiva sale in estate e scende in
          autunno.
        </p>
      </div>
    </template>

    <div v-if="bands.length === 0" class="py-6 text-center text-sm text-muted">
      Nessuna cella con punteggio nei filtri scelti.
    </div>

    <div v-else class="space-y-1.5">
      <div v-for="b in bands" :key="b.from" class="flex items-center gap-3 text-xs">
        <span class="w-24 shrink-0 text-right tabular-nums text-muted">
          {{ b.from }}–{{ b.to }} m
        </span>
        <div class="h-4 flex-1 overflow-hidden rounded-sm bg-elevated">
          <div
            class="h-full rounded-sm transition-all"
            :style="{
              width: `${Math.max(2, (b.meanScore / maxMean) * 100)}%`,
              backgroundColor: barColor(b.meanScore),
            }"
          />
        </div>
        <span class="w-10 shrink-0 tabular-nums font-medium">{{ b.meanScore.toFixed(0) }}</span>
        <span class="w-20 shrink-0 tabular-nums text-muted">
          {{ b.count }} cell{{ b.count === 1 ? 'a' : 'e' }}
        </span>
      </div>
    </div>
  </UCard>
</template>
