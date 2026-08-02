<script setup lang="ts">
// Interaction 1 + 2 + 3 + 4 (docs/LISTS_CRUD_PLAN.md): the index of the
// signed-in user's own lists, plus the entry points for creating, renaming, and
// deleting one. Create is a modal (CreateListModal, hosted globally in App.vue)
// opened via the shared useListModalsStore; rename (EditListModal) and delete
// (ConfirmDialog) are both mounted right here per-row, keyed off the same
// store's `editingListId`/`deletingListId` — none of the three ever navigates
// away from this page.
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PencilSquareIcon, TrashIcon } from '@heroicons/vue/24/outline'

import BaseButton from '@/components/BaseButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import IconButton from '@/components/IconButton.vue'
import EditListModal from './EditListModal.vue'
import type { ListSummary } from './types'
import { useDeleteList } from './useDeleteList'
import { useLists } from './useLists'
import { useListModalsStore } from './useListModals'

const { status, lists, load, updateList, removeList } = useLists()
const {
  pending: deletePending,
  error: deleteError,
  deleteList,
  reset: resetDeleteError,
} = useDeleteList()
const modals = useListModalsStore()
const route = useRoute()
const router = useRouter()

onMounted(() => {
  void load()

  // Resuming a "Start a list" click that sent an anonymous visitor through
  // login (see useStartList) — open the modal, then drop the flag from the URL.
  if (route.query.openCreate) {
    modals.openCreate()
    void router.replace({ path: route.path, query: { ...route.query, openCreate: undefined } })
  }
})

function handleRenamed(updated: ListSummary): void {
  updateList(updated)
  modals.closeEdit()
}

function openDeleteConfirm(list: ListSummary): void {
  resetDeleteError()
  modals.openDelete(list.id)
}

function cancelDelete(): void {
  modals.closeDelete()
}

async function confirmDelete(list: ListSummary): Promise<void> {
  const deleted = await deleteList(list.id)
  if (deleted) {
    removeList(list.id)
    modals.closeDelete()
  }
}
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <div class="flex items-center justify-between gap-4">
      <h1 class="font-display text-3xl font-extrabold text-ink">My lists</h1>
      <BaseButton size="sm" @click="modals.openCreate()">New list</BaseButton>
    </div>

    <p v-if="status === 'loading'" class="mt-6 text-muted">Loading your lists…</p>

    <p v-else-if="status === 'error'" class="mt-6 text-muted">
      Something went wrong loading your lists. Try refreshing the page.
    </p>

    <p v-else-if="lists.length === 0" class="mt-6 text-muted">
      You haven't started a list yet — create your first one above.
    </p>

    <ul v-else class="mt-6 divide-y divide-border">
      <li v-for="list in lists" :key="list.id" class="flex items-center justify-between gap-4 py-3">
        <RouterLink :to="{ name: 'list-detail', params: { id: list.id } }" class="text-ink">
          {{ list.title }}
        </RouterLink>
        <div class="flex items-center gap-2">
          <IconButton
            :icon="PencilSquareIcon"
            :label="`Rename ${list.title}`"
            @click="modals.openEdit(list.id)"
          />
          <IconButton
            :icon="TrashIcon"
            :label="`Delete ${list.title}`"
            @click="openDeleteConfirm(list)"
          />
        </div>

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
          @confirm="confirmDelete(list)"
          @cancel="cancelDelete"
        />
      </li>
    </ul>
  </section>
</template>
