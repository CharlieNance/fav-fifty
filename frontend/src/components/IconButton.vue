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

withDefaults(
  defineProps<{
    /** A heroicons (or any `currentColor`-based) icon component. */
    icon: FunctionalComponent
    /** Accessible name — required since there's no visible text. */
    label: string
    /** Disabled but still visible/announced (e.g. "move up" on the top item). */
    disabled?: boolean
  }>(),
  { disabled: false },
)
</script>

<template>
  <!-- Press feedback mirrors BaseButton's (docs/DESIGN.md §Motion): a squash on
       press, transform-gated behind motion-safe. `enabled:` scopes the hover/
       press styles so a disabled button stays visibly inert. -->
  <button
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    class="inline-flex cursor-pointer items-center justify-center rounded-full p-1.5 text-muted transition-all duration-150 ease-out enabled:hover:bg-elevated enabled:hover:text-ink motion-safe:enabled:active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
  >
    <component :is="icon" class="size-5" aria-hidden="true" />
  </button>
</template>
