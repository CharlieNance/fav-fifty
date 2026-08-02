<script setup lang="ts">
/**
 * Rename-a-list overlay (Interaction 3, docs/LISTS_CRUD_PLAN.md). Unlike
 * CreateListModal, this isn't hosted globally — it needs an existing list's data
 * to prefill, so whichever page has that list in hand (the index row today,
 * the details page in Interaction 5) mounts it directly, keyed off the shared
 * `useListModalsStore.editingListId`. Save/Cancel report back via emits, not the
 * store, so the page stays the single source of truth for "what does this list's
 * title look like right now."
 */
import { computed, nextTick, ref, onMounted } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import { apiFetch } from '@/api/client'
import type { ListSummary } from './types'

const props = defineProps<{ list: ListSummary }>()
const emit = defineEmits<{ saved: [list: ListSummary]; cancel: [] }>()

const title = ref(props.list.title)
const error = ref<string | null>(null)
const saving = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

const canSave = computed(() => title.value.trim().length > 0 && !saving.value)

function cancel(): void {
  emit('cancel')
}

async function save(): Promise<void> {
  const trimmed = title.value.trim()
  if (!trimmed) {
    error.value = 'Title is required.'
    return
  }

  saving.value = true
  error.value = null
  try {
    const updated = await apiFetch<ListSummary>(`/lists/${props.list.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: trimmed }),
    })
    emit('saved', updated)
  } catch {
    error.value = 'Could not save the title. Check it and try again.'
    saving.value = false
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
      aria-labelledby="edit-list-heading"
      class="w-full max-w-sm rounded-2xl border border-border bg-elevated p-6 shadow-xl"
    >
      <h2 id="edit-list-heading" class="font-display text-xl font-bold text-ink">Rename list</h2>

      <form class="mt-4" @submit.prevent="save">
        <label for="edit-list-title" class="sr-only">Title</label>
        <input
          id="edit-list-title"
          ref="inputRef"
          v-model="title"
          type="text"
          placeholder="e.g. Favorite albums"
          maxlength="200"
          class="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
        />

        <p v-if="error" role="alert" class="mt-2 text-sm text-accent">{{ error }}</p>

        <div class="mt-6 flex justify-end gap-3">
          <BaseButton variant="secondary" size="sm" type="button" @click="cancel">
            Cancel
          </BaseButton>
          <BaseButton size="sm" type="submit" :disabled="!canSave">
            {{ saving ? 'Saving…' : 'Save' }}
          </BaseButton>
        </div>
      </form>
    </div>
  </div>
</template>
