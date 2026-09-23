<script setup lang="ts">
// Homepage hero. Mobile-first: sized for a phone, scaled up at sm:/md:. The
// public-lists discovery grid from the mock is intentionally deferred until the
// sharing feature exists (Phase 3, see docs/NEXT_STEPS.md) so we don't ship
// placeholder data. The single CTA routes through the shared "start a list"
// action, which gates on auth (see useStartList).
import { computed, onMounted } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import { useLists } from '@/features/lists/useLists'
import { useStartList } from '@/features/lists/useStartList'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { startList } = useStartList()
const { status, lists, load } = useLists()

// "Your first list" is a promise we can only keep for someone who hasn't made
// one, so ask — but only for a signed-in visitor, since `GET /lists` is theirs
// and would just 401 for anyone else. Cheap enough at this scale, and the whole
// CTA is provisional: the discovery grid may replace it before launch.
onMounted(() => {
  if (auth.isAuthenticated) {
    void load()
  }
})

// Signed out, the visitor is a first-timer as far as we know. Signed in, we only
// say "first" once the fetch actually confirms they have none — while it's in
// flight (or if it failed) the neutral wording is the safer guess, since telling
// someone with fifty lists to make their first one is the worse mistake.
const ctaLabel = computed(() =>
  !auth.isAuthenticated || (status.value === 'success' && lists.value.length === 0)
    ? 'Make your first list'
    : 'Start a new list',
)
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
      <BaseButton @click="startList">{{ ctaLabel }}</BaseButton>
    </div>
  </section>
</template>
