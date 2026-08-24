<script setup lang="ts">
/**
 * One tag, rendered as a small pill — read-only on its own (details page
 * header, later the list index), or with a remove control inside the tag
 * management modal. Deliberately styled unlike anything else in the app (a
 * tinted accent outline, not a solid button or a list row) so a tag never
 * reads as a ranked item or a clickable action (docs/TAGS_SEARCH_PLAN.md open
 * question 5).
 */
import { XMarkIcon } from '@heroicons/vue/24/outline'

withDefaults(defineProps<{ label: string; removable?: boolean }>(), { removable: false })

const emit = defineEmits<{ remove: [] }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
  >
    {{ label }}
    <button
      v-if="removable"
      type="button"
      :aria-label="`Remove tag ${label}`"
      class="-mr-1 inline-flex items-center justify-center rounded-full p-0.5 text-accent/70 transition-colors hover:bg-accent/20 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      @click="emit('remove')"
    >
      <XMarkIcon class="size-3" aria-hidden="true" />
    </button>
  </span>
</template>
