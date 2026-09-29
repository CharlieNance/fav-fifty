<script setup lang="ts">
/**
 * A list's item count as an at-a-glance progress marker on the list index: a
 * colored disc (red → amber → green as the list fills up) holding the current
 * count, and a gold star once it hits the full fifty. A shape + color badge
 * rather than a bare numeral, so it never reads as the list's position in the
 * index. The color is never the only signal — the count is always printed and
 * the accessible name spells it out ("12 of 50 items").
 */
import { computed } from 'vue'

import { itemCountTier, MAX_ITEMS, type ItemCountTier } from './itemCountTier'

const props = defineProps<{ count: number }>()

const tier = computed(() => itemCountTier(props.count))
const label = computed(() => `${props.count} of ${MAX_ITEMS} items`)

// Filled chips reuse the status tokens: each fill already has a contrasting
// `-ink` color and a darker `-border` edge (see main.css §Status).
const discClasses: Record<Exclude<ItemCountTier, 'full'>, string> = {
  low: 'bg-error text-error-ink border-error-border',
  mid: 'bg-warning text-warning-ink border-warning-border',
  high: 'bg-success text-success-ink border-success-border',
}
</script>

<template>
  <!-- One fixed-size box for every tier, with the shape centered inside, so the
       bigger star and the smaller discs share a center line down the index. -->
  <span
    role="img"
    :aria-label="label"
    :title="label"
    class="inline-grid size-10 shrink-0 place-items-center"
  >
    <span v-if="tier === 'full'" class="relative grid size-full place-items-center">
      <svg viewBox="0 0 24 24" class="absolute inset-0 size-full drop-shadow" aria-hidden="true">
        <defs>
          <linearGradient id="item-count-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-gold-light)" />
            <stop offset="100%" stop-color="var(--color-gold)" />
          </linearGradient>
        </defs>
        <polygon
          points="12.00,1.30 15.88,7.56 23.03,9.32 18.28,14.94 18.82,22.28 12.00,19.50 5.18,22.28 5.72,14.94 0.97,9.32 8.12,7.56"
          fill="url(#item-count-gold)"
          stroke="var(--color-gold-border)"
          stroke-width="1"
          stroke-linejoin="round"
        />
      </svg>
      <span
        class="relative mt-0.5 font-display text-[0.7rem] leading-none font-extrabold text-gold-ink tabular-nums"
        aria-hidden="true"
      >
        {{ count }}
      </span>
    </span>

    <span
      v-else
      :class="discClasses[tier]"
      class="grid size-7 place-items-center rounded-full border font-display text-xs leading-none font-extrabold tabular-nums"
      aria-hidden="true"
    >
      {{ count }}
    </span>
  </span>
</template>
