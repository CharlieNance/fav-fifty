<script setup lang="ts">
/**
 * A round, icon-only action button (row actions like edit/delete). Pairs with
 * BaseButton rather than replacing it — BaseButton is for labeled actions
 * (Save, New list), this is for a compact icon with no visible label. Icons
 * come from @heroicons/vue, which draw with `currentColor`, so `text-*`
 * classes here are all that's needed to theme them (dark/light both, once a
 * light theme exists).
 */
import type { FunctionalComponent } from 'vue'

defineProps<{
  /** A heroicons (or any `currentColor`-based) icon component. */
  icon: FunctionalComponent
  /** Accessible name — required since there's no visible text. */
  label: string
}>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    class="inline-flex cursor-pointer items-center justify-center rounded-full p-1.5 text-muted transition-colors hover:bg-elevated hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
  >
    <component :is="icon" class="size-5" aria-hidden="true" />
  </button>
</template>
