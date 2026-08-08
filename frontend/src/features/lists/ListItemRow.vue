<script setup lang="ts">
/**
 * One ranked row on the list detail page (docs/ITEMS_CRUD_PLAN.md): big rank
 * numeral, optional image thumbnail, text + optional note, and the row's
 * actions (move up/down, edit, delete, drag handle). Purely presentational —
 * every action is an emit; the page owns all state and API calls, keeping this
 * easy to test and reuse (e.g. a read-only shared-list view later can render
 * a variant without the action cluster).
 */
import {
  Bars3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'

import IconButton from '@/components/IconButton.vue'
import type { ListItem } from './types'

const props = defineProps<{
  item: ListItem
  /** True while any reorder request is in flight — parks the move buttons. */
  movePending?: boolean
  /** Total items in the list, to pin the move buttons at the ends. */
  itemCount: number
}>()

const emit = defineEmits<{ edit: []; delete: []; 'move-up': []; 'move-down': [] }>()

const isFirst = (): boolean => props.item.position <= 1
const isLast = (): boolean => props.item.position >= props.itemCount
</script>

<template>
  <!-- `group` lets the action cluster brighten when the row is hovered (see
       below); the row itself gets a gentle surface lift so it reads as a thing
       you can grab, not static text. -->
  <li
    class="group flex items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-surface sm:gap-4"
  >
    <!-- Rank numeral — display face, accent color, wide enough for "50" -->
    <span
      class="w-8 shrink-0 text-right font-display text-2xl font-extrabold text-accent tabular-nums"
      aria-hidden="true"
    >
      {{ item.position }}
    </span>

    <img
      v-if="item.image_url"
      :src="item.image_url"
      alt=""
      loading="lazy"
      class="size-12 shrink-0 rounded-lg border border-border object-cover"
    />

    <div class="min-w-0 flex-1">
      <p class="font-medium break-words text-ink">{{ item.text }}</p>
      <p v-if="item.note" class="mt-0.5 text-sm break-words text-muted">{{ item.note }}</p>
    </div>

    <!-- Actions: slightly dimmed until the row is hovered or focused, so the
         list reads calm but lights up under the pointer. Never hidden — on
         touch there's no hover, and hidden affordances help no one. -->
    <div
      class="flex shrink-0 items-center gap-0.5 transition-opacity duration-150 sm:gap-1 sm:opacity-60 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
    >
      <IconButton
        :icon="ChevronUpIcon"
        :label="`Move ${item.text} up`"
        :disabled="movePending || isFirst()"
        @click="emit('move-up')"
      />
      <IconButton
        :icon="ChevronDownIcon"
        :label="`Move ${item.text} down`"
        :disabled="movePending || isLast()"
        @click="emit('move-down')"
      />
      <IconButton :icon="PencilSquareIcon" :label="`Edit ${item.text}`" @click="emit('edit')" />
      <IconButton :icon="TrashIcon" :label="`Delete ${item.text}`" @click="emit('delete')" />
      <!-- Drag affordance for pointer/touch users; keyboard users have the
           arrow buttons, so this stays out of the tab order. -->
      <span
        class="drag-handle cursor-grab touch-none rounded-full p-1.5 text-muted transition-colors hover:text-ink active:cursor-grabbing"
        title="Drag to reorder"
        aria-hidden="true"
      >
        <Bars3Icon class="size-5" />
      </span>
    </div>
  </li>
</template>
