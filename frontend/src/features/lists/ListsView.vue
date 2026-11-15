<script setup lang="ts">
// The lists page (docs/ARCHITECTURE.md §Frontend patterns): the index of the
// visitor's own lists (their account's, or this device's when anonymous — see
// useListRepository), plus the entry points for creating, renaming, and
// deleting one. Create is a modal (CreateListModal, hosted globally in App.vue)
// opened via the shared useListModalsStore; rename (EditListModal) and delete
// (ConfirmDialog) are both mounted right here per-row, keyed off the same
// store's `editingListId`/`deletingListId` — none of the three ever navigates
// away from this page.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'

import BaseButton from '@/components/BaseButton.vue'
import { useAuthStore } from '@/stores/auth'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import IconButton from '@/components/IconButton.vue'
import BackupReminder from './BackupReminder.vue'
import EditListModal from './EditListModal.vue'
import ItemCountBadge from './ItemCountBadge.vue'
import TagChip from './TagChip.vue'
import type { ListSummary } from './types'
import { useDeleteList } from './useDeleteList'
import { useLists } from './useLists'
import { useListModalsStore } from './useListModals'
import { useListSearch } from './useListSearch'
import { useListsRefresh } from './useListsRefresh'
import { useListTransfer } from './useListTransfer'

const {
  status,
  lists,
  error: loadError,
  errorKind: loadErrorKind,
  load,
  updateList,
  removeList,
} = useLists()
const {
  pending: deletePending,
  error: deleteError,
  deleteList,
  reset: resetDeleteError,
} = useDeleteList()
const modals = useListModalsStore()
const auth = useAuthStore()
// Destructured to top-level bindings (not held as `search.query`) so Vue's
// template compiler auto-unwraps the ref — nested member access like
// `search.query` is not unwrapped automatically.
const {
  query: searchQuery,
  clear: clearSearch,
  dispose: disposeSearch,
} = useListSearch((q) => void load(q || undefined))
const isSearching = computed(() => searchQuery.value.trim().length > 0)

onUnmounted(disposeSearch)

/** Load (or reload) the lists, keeping whatever search is in the box. */
function reload(): void {
  void load(searchQuery.value.trim() || undefined)
}

onMounted(reload)
// Sign-in/out switches storage, and another tab can change this device's lists.
useListsRefresh(reload)

// Export/import a file (docs/ARCHITECTURE.md §Export and import a file): an
// anonymous visitor's only backup, and a way to move lists between browsers or
// send them to a friend. Both work for everyone: signed in, an import goes to the
// account in one all-or-nothing request (see useListTransfer).
const { exporting, importing, exportLists, importFile } = useListTransfer()
const importInput = ref<HTMLInputElement | null>(null)

async function handleImportPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared so picking the same file again (after fixing it) fires `change` again.
  input.value = ''
  if (file && (await importFile(file))) reload()
}

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
  <section class="mx-auto max-w-3xl px-6 py-12 sm:my-10 sm:px-10 sm:py-10 sm:page-panel">
    <div class="flex items-center justify-between gap-4">
      <h1 class="font-display text-3xl font-extrabold text-ink">My lists</h1>
      <BaseButton size="sm" @click="modals.openCreate()">New list</BaseButton>
    </div>

    <!-- Anonymous lists live only in this browser (Safari can even clear them
         after a week without a visit), so say so plainly, and offer the way to
         keep them: signing in, after which the claim dialog brings them along.
         Plain /login or /signup (the same Google flow), which lands on /lists,
         where that dialog opens. -->
    <div class="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p v-if="!auth.isAuthenticated" class="text-sm text-muted">
        Saved on this device only. Clearing your browser data deletes them.
        <RouterLink to="/login" class="font-medium text-ink underline hover:text-accent"
          >Sign in</RouterLink
        >
        or
        <RouterLink to="/signup" class="font-medium text-ink underline hover:text-accent"
          >create a FREE account</RouterLink
        >
        to keep them safe.
      </p>
      <div class="ml-auto flex gap-2">
        <BaseButton variant="secondary" size="sm" :disabled="exporting" @click="exportLists()">
          <ArrowDownTrayIcon class="mr-1.5 size-4" aria-hidden="true" />
          {{ exporting ? 'Exporting…' : 'Export' }}
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="importing"
          @click="importInput?.click()"
        >
          <ArrowUpTrayIcon class="mr-1.5 size-4" aria-hidden="true" />
          {{ importing ? 'Importing…' : 'Import' }}
        </BaseButton>
        <input
          ref="importInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          data-testid="import-file"
          @change="handleImportPicked"
        />
      </div>
    </div>

    <BackupReminder />

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

    <p v-else-if="status === 'error' && loadErrorKind === 'storage'" class="mt-6 text-muted">
      {{ loadError }}
    </p>

    <p v-else-if="status === 'error'" class="mt-6 text-muted">
      Something went wrong loading your lists. Try refreshing the page.
    </p>

    <p v-else-if="lists.length === 0 && isSearching" class="mt-6 text-muted">
      No lists match “{{ searchQuery }}”.
    </p>

    <p v-else-if="lists.length === 0" class="mt-6 text-muted">
      You haven't started a list yet — create your first one above.
    </p>

    <!-- Rows sit in a bordered, hairline-divided container with a faint zebra
         stripe (same treatment as the ranked items on ListDetailView), and
         light up under the pointer (hover surface + title shifts to the accent)
         so "this whole row is a place to go" reads at a glance. -->
    <ul
      v-else
      class="mt-6 divide-y divide-border/70 rounded-xl border border-border/70 bg-canvas/50"
    >
      <li
        v-for="list in lists"
        :key="list.id"
        class="flex items-center justify-between gap-4 px-3 py-3 transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl even:bg-surface/40 hover:bg-elevated/60"
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
          <ItemCountBadge :count="list.item_count" class="mr-2" />
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
