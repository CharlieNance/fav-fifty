<script setup lang="ts">
/**
 * Create-a-list overlay (docs/ARCHITECTURE.md §Frontend patterns). Hosted once,
 * globally (App.vue), and opened via the shared `useListModalsStore` so "Start a
 * list" (header, homepage) and the index's "New list" button all reach the same
 * modal without a dedicated route. Save is the one deliberate navigation in this
 * flow — on success we go to the new list's details page; Cancel never navigates.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import { useClientConfigStore } from '@/stores/clientConfig'
import { useListModalsStore } from './useListModals'
import { useListAction } from './useListAction'

const modals = useListModalsStore()
const router = useRouter()
const config = useClientConfigStore()

const title = ref('')
const {
  pending: saving,
  error,
  run,
} = useListAction({
  fallback: 'Could not create the list. Check the title and try again.',
  // The lists-per-user quota ("Delete one to make room").
  showDetailFor: ['conflict'],
})
const inputRef = ref<HTMLInputElement | null>(null)

const canSave = computed(() => title.value.trim().length > 0 && !saving.value)

function reset(): void {
  title.value = ''
  error.value = null
}

function cancel(): void {
  modals.closeCreate()
  reset()
}

async function save(): Promise<void> {
  const trimmed = title.value.trim()
  if (!trimmed) {
    error.value = 'Title is required.'
    return
  }

  const created = await run((repo) => repo.createList(trimmed))
  if (!created) return
  modals.closeCreate()
  reset()
  await router.push({ name: 'list-detail', params: { id: created.id } })
}

// Focus the input each time the modal opens.
watch(
  () => modals.isCreateOpen,
  async (open) => {
    if (open) {
      await nextTick()
      inputRef.value?.focus()
    }
  },
)
</script>

<template>
  <BaseDialog v-if="modals.isCreateOpen" labelledby="create-list-heading" @close="cancel">
    <h2 id="create-list-heading" class="font-display text-xl font-bold text-ink">New list</h2>

    <form class="mt-4" @submit.prevent="save">
      <label for="create-list-title" class="sr-only">Title</label>
      <input
        id="create-list-title"
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
