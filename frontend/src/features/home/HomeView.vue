<script setup lang="ts">
// Homepage hero. Mobile-first: sized for a phone, scaled up at sm:/md:. The
// public-lists discovery grid from the mock is intentionally deferred until the
// sharing feature exists (Phase 3, see docs/NEXT_STEPS.md) so we don't ship
// placeholder data. The "start a list" CTA routes through the shared action,
// which opens the create modal for everyone (see useStartList); a returning
// visitor also gets a way back to the lists they already have.
import { computed, onMounted } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import { useLists } from '@/features/lists/useLists'
import { useListsRefresh } from '@/features/lists/useListsRefresh'
import { useStartList } from '@/features/lists/useStartList'

const { startList } = useStartList()
const { status, lists, load } = useLists()

// "Your first list" is a promise we can only keep for someone who hasn't made
// one, so ask: the account's lists when signed in, this device's otherwise. Cheap
// enough at this scale, and the whole CTA is provisional: the discovery grid may
// replace it before launch.
function reload(): void {
  void load()
}
onMounted(reload)
useListsRefresh(reload)

// Only say "first" once the load confirms they have none. While it's in flight
// (or if it failed) the neutral wording is the safer guess, since telling someone
// with fifty lists to make their first one is the worse mistake.
const ctaLabel = computed(() =>
  status.value === 'success' && lists.value.length === 0
    ? 'Make your first list'
    : 'Start a new list',
)

// Someone coming back to a list they've started most likely wants that, not a
// new one: offer the way there first, and demote "new list" to the second button.
const hasLists = computed(() => status.value === 'success' && lists.value.length > 0)
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
    <div class="mt-8 flex flex-wrap justify-center gap-3 sm:mt-10">
      <BaseButton v-if="hasLists" :to="{ name: 'lists' }">View my lists</BaseButton>
      <BaseButton :variant="hasLists ? 'secondary' : 'primary'" @click="startList">
        {{ ctaLabel }}
      </BaseButton>
    </div>
  </section>
</template>
