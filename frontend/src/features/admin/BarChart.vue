<script setup lang="ts">
/**
 * A small, single-series bar chart in plain SVG (no chart library: the admin
 * dashboard needs a handful of these, docs/ARCHITECTURE.md
 * §Dashboards).
 *
 * - One series, so no legend: the heading names it. Bars wear the accent token;
 *   text stays in ink/muted tokens.
 * - Thin bars with rounded tops anchored to the baseline, a 2px gap between them,
 *   and a recessive baseline plus a single max label (no grid).
 * - Hover a bar for its exact value; the hit target is the full column, not just
 *   the bar, so short bars are easy to reach.
 * - Every value is also in a table (behind "Show as table"): that's the keyboard
 *   and screen-reader view, so nothing is chart-only.
 */
import { computed, ref } from 'vue'

export interface Bar {
  /** Shown in the tooltip and the table, e.g. "Nov 17". */
  label: string
  value: number
}

const props = withDefaults(
  defineProps<{
    bars: Bar[]
    /** What's counted, e.g. "Lists created": the table's column heading. */
    title: string
    height?: number
  }>(),
  { height: 64 },
)

const BAR = 8
const GAP = 2
const RADIUS = 2

const max = computed(() => Math.max(1, ...props.bars.map((bar) => bar.value)))
const width = computed(() => props.bars.length * (BAR + GAP) - GAP)

function barPath(index: number, value: number): string {
  const h = (value / max.value) * props.height
  if (h <= 0) return ''
  const x = index * (BAR + GAP)
  const y = props.height - h
  const r = Math.min(RADIUS, h)
  // Rounded top corners, square at the baseline.
  return `M${x},${props.height} V${y + r} Q${x},${y} ${x + r},${y} H${x + BAR - r} Q${x + BAR},${y} ${x + BAR},${y + r} V${props.height} Z`
}

const active = ref<number | null>(null)
const activeBar = computed(() => (active.value === null ? null : props.bars[active.value]))
const total = computed(() => props.bars.reduce((sum, bar) => sum + bar.value, 0))
</script>

<template>
  <div>
    <div class="relative">
      <svg
        :viewBox="`0 0 ${width} ${height + 1}`"
        preserveAspectRatio="none"
        class="block w-full text-accent"
        :style="{ height: `${height}px` }"
        role="img"
        :aria-label="`${title}: ${total.toLocaleString()} in total, up to ${max.toLocaleString()} a bar`"
        @mouseleave="active = null"
      >
        <g v-for="(bar, index) in bars" :key="bar.label">
          <path
            :d="barPath(index, bar.value)"
            fill="currentColor"
            :opacity="active === null || active === index ? 1 : 0.5"
          />
          <!-- The column-sized hit target. -->
          <rect
            :x="index * (BAR + GAP) - GAP / 2"
            y="0"
            :width="BAR + GAP"
            :height="height"
            fill="transparent"
            @mouseenter="active = index"
          />
        </g>
        <line
          x1="0"
          :x2="width"
          :y1="height + 0.5"
          :y2="height + 0.5"
          class="text-border"
          stroke="currentColor"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <p
        v-if="activeBar"
        class="pointer-events-none absolute -top-7 right-0 rounded bg-elevated px-2 py-0.5 text-xs text-ink shadow"
        aria-hidden="true"
      >
        {{ activeBar.label }}: <strong>{{ activeBar.value.toLocaleString() }}</strong>
      </p>
    </div>
    <div class="mt-1 flex justify-between text-xs text-muted">
      <span>{{ bars[0]?.label }}</span>
      <span>max {{ max.toLocaleString() }}</span>
      <span>{{ bars[bars.length - 1]?.label }}</span>
    </div>
    <details class="mt-1 text-xs">
      <summary class="cursor-pointer text-muted hover:text-ink">Show as table</summary>
      <table class="mt-2 w-full">
        <thead>
          <tr class="text-left text-muted">
            <th scope="col" class="font-medium">When</th>
            <th scope="col" class="text-right font-medium">{{ title }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bar in bars" :key="bar.label" class="text-ink">
            <td>{{ bar.label }}</td>
            <td class="text-right tabular-nums">{{ bar.value.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>
