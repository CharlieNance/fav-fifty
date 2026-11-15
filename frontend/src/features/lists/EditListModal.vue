<script setup lang="ts">
/**
 * Rename-a-list overlay (docs/ARCHITECTURE.md §Frontend patterns). Unlike
 * CreateListModal, this isn't hosted globally — it needs an existing list's data
 * to prefill, so whichever page has that list in hand (the index row today,
 * the details page) mounts it directly, keyed off the shared
 * `useListModalsStore.editingListId`. Save/Cancel report back via emits, not the
 * store, so the page stays the single source of truth for "what does this list's
 * title look like right now."
 */
import { computed, nextTick, ref, onMounted } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import { useClientConfigStore } from '@/stores/clientConfig'
import type { ListSummary } from './types'
import { useListAction } from './useListAction'

const props = defineProps<{ list: ListSummary }>()
const emit = defineEmits<{ saved: [list: ListSummary]; cancel: [] }>()
const config = useClientConfigStore()

const title = ref(props.list.title)
const {
  pending: saving,
  error,
  run,
} = useListAction({
  fallback: 'Could not save the title. Check it and try again.',
})
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

  const updated = await run((repo) => repo.renameList(props.list.id, trimmed))
  if (updated) emit('saved', updated)
}

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})
</script>

<template>
  <BaseDialog labelledby="edit-list-heading" @close="cancel">
    <h2 id="edit-list-heading" class="font-display text-xl font-bold text-ink">Rename list</h2>

    <form class="mt-4" @submit.prevent="save">
      <label for="edit-list-title" class="sr-only">Title</label>
      <input
        id="edit-list-title"
        ref="inputRef"
        v-model="title"
        type="text"
        placeholder="e.g. Favorite albums"
        :maxlength="config.limits.max_title_length"
        class="w-full rounded-lg border border-control bg-transparent px-4 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
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
  </BaseDialog>
</template>
