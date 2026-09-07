<script setup lang="ts">
const links = [
  { label: 'Tabella', icon: 'i-lucide-table', to: '/tabella' },
  { label: 'Mappa', icon: 'i-lucide-map', to: '/mappa' },
  { label: 'Bosco', icon: 'i-lucide-trees', to: '/bosco' },
  { label: 'Tipi di bosco', icon: 'i-lucide-tree-deciduous', to: '/tipi-di-bosco' },
];
</script>

<template>
  <div class="flex min-h-screen">
    <aside class="w-56 shrink-0 border-r border-default bg-elevated/40">
      <div class="p-4">
        <NuxtLink to="/tabella" class="block">
          <div class="text-sm font-semibold tracking-tight">Porcini</div>
          <div class="text-xs text-muted">condizioni di fruttificazione</div>
        </NuxtLink>
      </div>
      <UNavigationMenu orientation="vertical" :items="links" class="px-2" />
    </aside>

    <main class="min-w-0 flex-1">
      <slot />
    </main>
  </div>
</template>
