<script setup lang="ts">
// Interaction 5 (docs/LISTS_CRUD_PLAN.md): the details page a list's title in
// the index links to. Reuses GET /api/lists/:id (no new endpoint) via
// useListDetail; hosts the same EditListModal/ConfirmDialog pattern ListsView
// uses, keyed off the shared useListModalsStore, so Edit/Delete here behave
// identically to their index-row counterparts. Item management is out of scope
// for this feature — the body is just the title plus an empty-state message.
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EditListModal from './EditListModal.vue'
import type { ListSummary } from './types'
import { useDeleteList } from './useDeleteList'
import { useListDetail } from './useListDetail'
import { useListModalsStore } from './useListModals'

const route = useRoute()
const router = useRouter()

const { status, list, load, updateList } = useListDetail()
const {
  pending: deletePending,
  error: deleteError,
  deleteList,
  reset: resetDeleteError,
} = useDeleteList()
const modals = useListModalsStore()

onMounted(() => {
  void load(route.params.id as string)
})

function handleRenamed(updated: ListSummary): void {
  updateList(updated)
  modals.closeEdit()
}

function openDeleteConfirm(): void {
  resetDeleteError()
  modals.openDelete(route.params.id as string)
}

function cancelDelete(): void {
  modals.closeDelete()
}

async function confirmDelete(): Promise<void> {
  const deleted = await deleteList(route.params.id as string)
  if (deleted) {
    modals.closeDelete()
    void router.push({ name: 'lists' })
  }
}
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <p v-if="status === 'loading'" class="text-muted">Loading…</p>

    <p v-else-if="status === 'not-found'" class="text-muted">
      This list doesn't exist, or you don't have access to it.
      <RouterLink :to="{ name: 'lists' }" class="text-ink underline">Back to my lists</RouterLink>
    </p>

    <p v-else-if="status === 'error'" class="text-muted">
      Something went wrong loading this list. Try refreshing the page.
    </p>

    <template v-else-if="status === 'success' && list">
      <div class="flex items-center justify-between gap-4">
        <h1 class="font-display text-3xl font-extrabold text-ink">{{ list.title }}</h1>
        <div class="flex items-center gap-2">
          <BaseButton variant="secondary" size="sm" @click="modals.openEdit(list.id)">
            Edit
          </BaseButton>
          <BaseButton variant="secondary" size="sm" @click="openDeleteConfirm">Delete</BaseButton>
        </div>
      </div>

      <p class="mt-6 text-muted">🚧 Items are coming soon — this list is empty for now.</p>

      <EditListModal
        v-if="modals.editingListId === list.id"
        :list="list"
        @saved="handleRenamed"
        @cancel="modals.closeEdit()"
      />

      <ConfirmDialog
        v-if="modals.deletingListId === list.id"
        :title="`Delete '${list.title}'?`"
        message="This can't be undone."
        confirm-label="Delete"
        pending-label="Deleting…"
        :pending="deletePending"
        :error="deleteError"
        @confirm="confirmDelete"
        @cancel="cancelDelete"
      />
    </template>
  </section>
</template>
