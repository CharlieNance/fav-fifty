<script setup lang="ts">
// The details page for one list. On top of the list-level Edit/Delete, this
// hosts the whole items feature (docs/ARCHITECTURE.md §Items): ranked rows, add/edit via ItemFormModal,
// delete via the shared ConfirmDialog, and reorder via drag (vue-draggable-plus
// / SortableJS) or the rows' up/down buttons — both paths call the same
// move-one-item endpoint. Item modal state is component-local (plain refs)
// rather than in useListModalsStore: unlike the list modals, these are only
// ever reachable from this page, so a shared store would be indirection with
// no second consumer.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { ArrowLeftIcon } from '@heroicons/vue/20/solid'

import BaseButton from '@/components/BaseButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { setPageTitle } from '@/router/pageTitle'
import { useClientConfigStore } from '@/stores/clientConfig'
import BackupReminder from './BackupReminder.vue'
import EditListModal from './EditListModal.vue'
import ItemFormModal from './ItemFormModal.vue'
import ListItemRow from './ListItemRow.vue'
import ManageTagsModal from './ManageTagsModal.vue'
import TagChip from './TagChip.vue'
import type { ListItem, ListSummary } from './types'
import { useDeleteItem } from './useDeleteItem'
import { useDeleteList } from './useDeleteList'
import { useListDetail } from './useListDetail'
import { useListItems } from './useListItems'
import { useListModalsStore } from './useListModals'
import { useListsRefresh } from './useListsRefresh'
import { useReorderItem } from './useReorderItem'

const route = useRoute()
const router = useRouter()

const {
  status,
  list,
  error: loadError,
  errorKind: loadErrorKind,
  load,
  updateList,
} = useListDetail()
const {
  status: itemsStatus,
  items,
  load: loadItems,
  addItem,
  replaceItem,
  removeItem,
  setItems,
  restoreServerOrder,
} = useListItems()
const {
  pending: deletePending,
  error: deleteError,
  deleteList,
  reset: resetDeleteError,
} = useDeleteList()
const {
  pending: deleteItemPending,
  error: deleteItemError,
  deleteItem,
  reset: resetDeleteItemError,
} = useDeleteItem()
const {
  pending: reorderPending,
  error: reorderError,
  reorderItem,
  reset: resetReorderError,
} = useReorderItem()
const modals = useListModalsStore()

// Item modal state — see the header comment for why these aren't in the store.
const isAddOpen = ref(false)
const editingItem = ref<ListItem | null>(null)
const deletingItem = ref<ListItem | null>(null)

const listId = computed(() => route.params.id as string)
const config = useClientConfigStore()
const maxItems = computed(() => config.limits.max_items_per_list)
const isFull = computed(() => items.value.length >= maxItems.value)

async function loadAll(id: string): Promise<void> {
  // Items only after the list resolves: if the list 404s, the page shows
  // not-found and an items request would just 404 noisily for nothing.
  await load(id)
  if (status.value === 'success') {
    void loadItems(id)
  }
}

onMounted(() => {
  void loadAll(route.params.id as string)
})

onBeforeRouteUpdate((to) => {
  void loadAll(to.params.id as string)
})

// Sign-in/out switches storage (a device list's id then shows "not found", as a
// stale bookmark would), and another tab can change or delete this list.
useListsRefresh(() => void loadAll(listId.value))

// The tab title (and what a screen reader announces) is the list's own name.
watch(
  () => list.value?.title,
  (title) => {
    if (title) setPageTitle(title)
  },
)

function handleRenamed(updated: ListSummary): void {
  updateList(updated)
  modals.closeEdit()
}

function handleTagsSaved(updated: ListSummary): void {
  updateList(updated)
  modals.closeManageTags()
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

// ——— Items: add / edit ———

function handleItemSaved(saved: ListItem): void {
  if (editingItem.value) {
    replaceItem(saved)
    editingItem.value = null
  } else {
    addItem(saved)
    isAddOpen.value = false
  }
}

function closeItemForm(): void {
  isAddOpen.value = false
  editingItem.value = null
}

// ——— Items: delete ———

function openDeleteItem(item: ListItem): void {
  resetDeleteItemError()
  deletingItem.value = item
}

async function confirmDeleteItem(): Promise<void> {
  if (!deletingItem.value) return
  const deleted = await deleteItem(listId.value, deletingItem.value.id)
  if (deleted) {
    removeItem(deletingItem.value.id)
    deletingItem.value = null
  }
}

// ——— Items: reorder (shared by drag and the up/down buttons) ———

// What a screen reader hears after a move. A drag or an arrow click changes the
// ranks silently otherwise (WCAG 4.1.3 Status Messages).
const moveAnnouncement = ref('')

async function applyMove(item: ListItem, position: number): Promise<void> {
  const result = await reorderItem(listId.value, item.id, position)
  if (result) {
    setItems(result)
    moveAnnouncement.value = `${item.text} moved to number ${position} of ${result.length}.`
  } else {
    // The server refused (or the request died): resnap to the order the
    // server still has, so the UI never silently disagrees with it.
    restoreServerOrder()
  }
}

// The array VueDraggable mutates through v-model when a drag lands.
const itemsModel = computed({
  get: () => items.value,
  set: (next: ListItem[]) => setItems(next),
})

/**
 * A finished drag (SortableJS `update` event) — the v-model array is already
 * visually reordered. The moved item is identified by the row's `data-id`
 * (set in the template) rather than by index math, so this stays correct
 * regardless of when the model write lands relative to this event.
 */
function onSortUpdate(event: { item: HTMLElement; newIndex?: number }): void {
  resetReorderError()
  const moved = items.value.find((candidate) => candidate.id === event.item.dataset.id)
  if (moved && typeof event.newIndex === 'number') {
    void applyMove(moved, event.newIndex + 1)
  }
}

/** Keyboard-friendly move — same endpoint, one rank at a time. */
async function nudge(item: ListItem, direction: -1 | 1): Promise<void> {
  resetReorderError()
  const target = item.position + direction
  if (target < 1 || target > items.value.length || reorderPending.value) return
  await applyMove(item, target)
  await keepFocusOnRow(item.id, direction === -1 ? 'move-up' : 'move-down')
}

/**
 * Keep keyboard focus on the moved row, so pressing the same arrow again keeps
 * moving it. The buttons are disabled while the move is in flight (which drops
 * focus), and the one just used is disabled for good once the row reaches the
 * top or bottom, so fall back to its opposite.
 */
async function keepFocusOnRow(itemId: string, action: 'move-up' | 'move-down'): Promise<void> {
  await nextTick()
  const row = Array.from(document.querySelectorAll<HTMLElement>('[data-id]')).find(
    (candidate) => candidate.dataset.id === itemId,
  )
  const opposite = action === 'move-up' ? 'move-down' : 'move-up'
  const target =
    row?.querySelector<HTMLButtonElement>(`[data-action="${action}"]:not(:disabled)`) ??
    row?.querySelector<HTMLButtonElement>(`[data-action="${opposite}"]:not(:disabled)`)
  target?.focus()
}
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12 sm:my-10 sm:px-10 sm:py-10 sm:page-panel">
    <!-- The way back up, always there (even when the list failed to load). -->
    <RouterLink
      :to="{ name: 'lists' }"
      class="-ml-1 mb-4 inline-flex items-center gap-1 rounded px-1 text-sm font-medium text-muted transition-colors hover:text-ink"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      <span><span class="sr-only">Back to </span>My lists</span>
    </RouterLink>

    <p v-if="status === 'loading'" class="text-muted" role="status">Loading…</p>

    <p v-else-if="status === 'not-found'" class="text-muted">
      This list doesn't exist, or you don't have access to it.
      <RouterLink :to="{ name: 'lists' }" class="text-ink underline">Back to my lists</RouterLink>
    </p>

    <p v-else-if="status === 'error' && loadErrorKind === 'storage'" class="text-muted">
      {{ loadError }}
    </p>

    <p v-else-if="status === 'error'" class="text-muted">
      Something went wrong loading this list. Try refreshing the page.
    </p>

    <template v-else-if="status === 'success' && list">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 class="min-w-0 font-display text-3xl font-extrabold break-words text-ink">
          {{ list.title }}
        </h1>
        <div class="flex items-center gap-2">
          <BaseButton variant="secondary" size="sm" @click="modals.openManageTags(list.id)">
            Tags
          </BaseButton>
          <BaseButton variant="secondary" size="sm" @click="modals.openEdit(list.id)">
            Edit
          </BaseButton>
          <BaseButton variant="secondary" size="sm" @click="openDeleteConfirm">Delete</BaseButton>
        </div>
      </div>

      <ul v-if="list.tags.length > 0" class="mt-3 flex flex-wrap gap-2">
        <li v-for="tag in list.tags" :key="tag">
          <TagChip :label="tag" />
        </li>
      </ul>

      <!-- Anonymous, with enough on this device to be worth keeping. -->
      <BackupReminder />

      <!-- ——— Items ——— -->

      <p v-if="itemsStatus === 'loading'" class="mt-6 text-muted" role="status">Loading items…</p>

      <p v-else-if="itemsStatus === 'error'" class="mt-6 text-muted">
        Something went wrong loading the items. Try refreshing the page.
      </p>

      <template v-else-if="itemsStatus === 'success'">
        <!-- Empty state: the first thing every new list shows — make it an
             invitation, not a shrug. -->
        <div v-if="items.length === 0" class="mt-10 text-center">
          <p class="font-display text-xl font-bold text-ink">Nothing ranked yet.</p>
          <p class="mt-1 text-muted">Every all-timer list starts with a #1 — what's yours?</p>
          <BaseButton class="mt-6" @click="isAddOpen = true">Add your first favorite</BaseButton>
        </div>

        <template v-else>
          <div class="mt-6 flex items-center justify-between gap-4">
            <p class="text-sm text-muted">
              <span class="font-semibold text-ink tabular-nums">{{ items.length }}</span>
              of {{ maxItems }} ranked
              <span v-if="isFull"> — a full fifty! 🎉</span>
            </p>
            <BaseButton size="sm" :disabled="isFull" @click="isAddOpen = true">Add item</BaseButton>
          </div>

          <p v-if="reorderError" role="alert" class="mt-3 text-sm text-accent">
            {{ reorderError }}
          </p>

          <!-- force-fallback: use SortableJS's own drag rendering instead of the
               browser's native HTML5 drag — the picked-up row is a real styled
               clone (.drag-dragging) rather than the OS's washed-out drag image,
               identical in every browser, and drivable by Playwright.
               fallback-on-body keeps that clone OUT of the <ul>, where it would
               confuse both the wrapper's child bookkeeping and :empty/nth CSS. -->
          <!-- Announced, not shown: see moveAnnouncement. -->
          <p class="sr-only" role="status" aria-live="polite">{{ moveAnnouncement }}</p>

          <!-- An <ol>: it's a ranking, so the order is the content. -->
          <VueDraggable
            v-model="itemsModel"
            tag="ol"
            aria-label="Ranked items"
            handle=".drag-handle"
            :animation="200"
            ghost-class="drag-ghost"
            chosen-class="drag-chosen"
            :force-fallback="true"
            fallback-class="drag-dragging"
            :fallback-on-body="true"
            :fallback-tolerance="3"
            :disabled="reorderPending"
            class="mt-4 divide-y divide-border/70 rounded-xl border border-border/70 bg-canvas/50"
            @update="onSortUpdate"
          >
            <ListItemRow
              v-for="element in items"
              :key="element.id"
              :data-id="element.id"
              :item="element"
              :item-count="items.length"
              :move-pending="reorderPending"
              @move-up="nudge(element, -1)"
              @move-down="nudge(element, 1)"
              @edit="editingItem = element"
              @delete="openDeleteItem(element)"
            />
          </VueDraggable>
        </template>
      </template>

      <!-- ——— Overlays ——— -->

      <ItemFormModal
        v-if="isAddOpen || editingItem"
        :list-id="listId"
        :item="editingItem"
        @saved="handleItemSaved"
        @cancel="closeItemForm"
      />

      <ConfirmDialog
        v-if="deletingItem"
        :title="`Delete '${deletingItem.text}'?`"
        message="The items below it move up a rank. This can't be undone."
        confirm-label="Delete"
        pending-label="Deleting…"
        :pending="deleteItemPending"
        :error="deleteItemError"
        @confirm="confirmDeleteItem"
        @cancel="deletingItem = null"
      />

      <EditListModal
        v-if="modals.editingListId === list.id"
        :list="list"
        @saved="handleRenamed"
        @cancel="modals.closeEdit()"
      />

      <ManageTagsModal
        v-if="modals.managingTagsListId === list.id"
        :list="list"
        @saved="handleTagsSaved"
        @cancel="modals.closeManageTags()"
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
