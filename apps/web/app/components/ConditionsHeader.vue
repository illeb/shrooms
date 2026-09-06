<script setup lang="ts">
defineProps<{
  title: string;
  subtitle: string;
  model: { label: string; version: number } | null;
  latestDate: string | null;
}>();
</script>

<template>
  <header class="mb-8">
    <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
    <p class="mt-1 text-muted">{{ subtitle }}</p>

    <div v-if="model" class="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <UBadge color="primary" variant="subtle">{{ model.label }}</UBadge>
      <UBadge color="neutral" variant="outline">profilo v{{ model.version }}</UBadge>
      <UBadge v-if="latestDate" color="neutral" variant="outline">
        ultimo giorno calcolato: {{ latestDate }}
      </UBadge>
    </div>
  </header>
</template>
