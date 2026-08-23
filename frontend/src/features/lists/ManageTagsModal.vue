<script setup lang="ts">
/**
 * Manage-tags overlay (Interaction 1, docs/TAGS_SEARCH_PLAN.md) — a small modal
 * with explicit Save/Cancel (open question 2's decision, for consistency with
 * EditListModal) rather than autosave-per-change. Tags are edited as chips
 * (open question 5's decision): type a name and press Enter (or Add) to turn
 * it into a chip, click a chip's × to drop it. The whole edited set is only
 * sent to the server once, on Save — Cancel discards every change made here.
 */
import { computed, nextTick, onMounted, ref } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import TagChip from './TagChip.vue'
import type { ListSummary } from './types'
import { useListTags } from './useListTags'

// Mirrors the backend's `settings.max_tags_per_list` (backend/app/core/config.py)
// — client-side check is just for a fast, friendly message; the server is the
// source of truth and re-checks this on save.
const MAX_TAGS = 100

const props = defineProps<{ list: ListSummary }>()
const emit = defineEmits<{ saved: [list: ListSummary]; cancel: [] }>()

const tags = ref<string[]>([...props.list.tags])
const draft = ref('')
const clientError = ref<string | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const { pending, error: serverError, setTags, reset: resetServerError } = useListTags()
const error = computed(() => clientError.value ?? serverError.value)

/** Same trim/collapse/lower-case rule as the backend's `normalize_tag_name`. */
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

function addTag(): void {
  clientError.value = null
  const name = normalize(draft.value)
  if (!name) return
  if (name.length > 50) {
    clientError.value = 'Tags must be 50 characters or fewer.'
    return
  }
  if (tags.value.includes(name)) {
    draft.value = ''
    return
  }
  if (tags.value.length >= MAX_TAGS) {
    clientError.value = `A list can have at most ${MAX_TAGS} tags.`
    return
  }
  tags.value.push(name)
  draft.value = ''
}

function removeTag(name: string): void {
  tags.value = tags.value.filter((tag) => tag !== name)
}

function cancel(): void {
  emit('cancel')
}

async function save(): Promise<void> {
  resetServerError()
  clientError.value = null
  const updated = await setTags(props.list.id, tags.value)
  if (updated) {
    emit('saved', updated)
  }
}

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-canvas/50 px-4"
    @click.self="cancel"
    @keydown.escape="cancel"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-tags-heading"
      class="w-full max-w-sm rounded-2xl border border-border bg-elevated p-6 shadow-xl motion-safe:animate-rise-in"
    >
      <h2 id="manage-tags-heading" class="font-display text-xl font-bold text-ink">Manage tags</h2>

      <ul v-if="tags.length > 0" class="mt-4 flex flex-wrap gap-2">
        <li v-for="tag in tags" :key="tag">
          <TagChip :label="tag" removable @remove="removeTag(tag)" />
        </li>
      </ul>
      <p v-else class="mt-4 text-sm text-muted">No tags yet.</p>

      <form class="mt-4 flex gap-2" @submit.prevent="addTag">
        <label for="new-tag" class="sr-only">Add a tag</label>
        <input
          id="new-tag"
          ref="inputRef"
          v-model="draft"
          type="text"
          placeholder="e.g. sci-fi"
          maxlength="50"
          class="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
        />
        <BaseButton variant="secondary" size="sm" type="submit">Add</BaseButton>
      </form>

      <p v-if="error" role="alert" class="mt-2 text-sm text-accent">{{ error }}</p>

      <div class="mt-6 flex justify-end gap-3">
        <BaseButton variant="secondary" size="sm" type="button" :disabled="pending" @click="cancel">
          Cancel
        </BaseButton>
        <BaseButton size="sm" type="button" :disabled="pending" @click="save">
          {{ pending ? 'Saving…' : 'Save' }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
