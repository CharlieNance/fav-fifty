<script setup lang="ts">
// Homepage hero. Mobile-first: sized for a phone, scaled up at sm:/md:. The
// public-lists discovery grid from the mock is intentionally deferred until the
// sharing feature exists (Phase 3, see docs/NEXT_STEPS.md) so we don't ship
// placeholder data. The single CTA routes through the shared "start a list"
// action, which gates on auth (see useStartList).
import BaseButton from '@/components/BaseButton.vue'
import { useStartList } from '@/features/lists/useStartList'

const { startList } = useStartList()
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-16 text-center sm:py-24">
    <h1
      class="font-display text-4xl font-extrabold tracking-tight text-balance text-ink sm:text-5xl md:text-6xl"
    >
      Stop stopping at your top 10.
    </h1>
    <p class="mx-auto mt-5 max-w-xl text-lg text-pretty text-muted sm:text-xl">
      Fifty forces you past the obvious picks. Rank your fifty favorite anything — games, recipes,
      albums, sandwiches — and finally justify entry #43.
    </p>
    <div class="mt-8 flex justify-center sm:mt-10">
      <BaseButton @click="startList">Make your first list</BaseButton>
    </div>
  </section>
</template>
