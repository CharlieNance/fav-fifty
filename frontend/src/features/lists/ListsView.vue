<script setup lang="ts">
// Interaction 1 + 2 + 3 + 4 (docs/LISTS_CRUD_PLAN.md): the index of the
// signed-in user's own lists, plus the entry points for creating, renaming, and
// deleting one. Create is a modal (CreateListModal, hosted globally in App.vue)
// opened via the shared useListModalsStore; rename (EditListModal) and delete
// (ConfirmDialog) are both mounted right here per-row, keyed off the same
// store's `editingListId`/`deletingListId` — none of the three ever navigates
// away from this page.
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  MagnifyingGlassIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'

import BaseButton from '@/components/BaseButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import IconButton from '@/components/IconButton.vue'
import EditListModal from './EditListModal.vue'
import TagChip from './TagChip.vue'
import type { ListSummary } from './types'
import { useDeleteList } from './useDeleteList'
import { useLists } from './useLists'
import { useListModalsStore } from './useListModals'
import { useListSearch } from './useListSearch'

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
// Destructured to top-level bindings (not held as `search.query`) so Vue's
// template compiler auto-unwraps the ref — nested member access like
// `search.query` is not unwrapped automatically.
const { query: searchQuery, clear: clearSearch } = useListSearch((q) => void load(q || undefined))
const isSearching = computed(() => searchQuery.value.trim().length > 0)

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

    <div class="relative mt-6">
      <label for="list-search" class="sr-only">Search your lists by title or tag</label>
      <MagnifyingGlassIcon
        class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        id="list-search"
        v-model="searchQuery"
        type="search"
        placeholder="Search by title or tag…"
        class="w-full rounded-lg border border-border bg-transparent py-2 pl-9 pr-9 text-ink focus-visible:outline-2 focus-visible:outline-accent"
      />
      <button
        v-if="isSearching"
        type="button"
        aria-label="Clear search"
        class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        @click="clearSearch()"
      >
        <XMarkIcon class="size-4" aria-hidden="true" />
      </button>
    </div>

    <p v-if="status === 'loading'" class="mt-6 text-muted">Loading your lists…</p>

    <p v-else-if="status === 'error'" class="mt-6 text-muted">
      Something went wrong loading your lists. Try refreshing the page.
    </p>

    <p v-else-if="lists.length === 0 && isSearching" class="mt-6 text-muted">
      No lists match “{{ searchQuery }}”.
    </p>

    <p v-else-if="lists.length === 0" class="mt-6 text-muted">
      You haven't started a list yet — create your first one above.
    </p>

    <!-- Rows light up under the pointer (hover surface + title shifts to the
         accent) so "this whole row is a place to go" reads at a glance. -->
    <ul v-else class="mt-6 space-y-1">
      <li
        v-for="list in lists"
        :key="list.id"
        class="flex items-center justify-between gap-4 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-surface"
      >
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <RouterLink
            :to="{ name: 'list-detail', params: { id: list.id } }"
            class="font-medium text-ink transition-colors duration-150 hover:text-accent"
          >
            {{ list.title }}
          </RouterLink>
          <ul v-if="list.tags.length > 0" class="flex flex-wrap gap-1">
            <li v-for="tag in list.tags" :key="tag">
              <TagChip :label="tag" />
            </li>
          </ul>
        </div>
        <div class="flex shrink-0 items-center gap-2">
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
