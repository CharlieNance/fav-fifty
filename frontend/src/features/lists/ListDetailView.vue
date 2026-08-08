<script setup lang="ts">
// The details page for one list. On top of the list-level Edit/Delete from
// Interaction 5 of docs/LISTS_CRUD_PLAN.md, this now hosts the whole items
// feature (docs/ITEMS_CRUD_PLAN.md): ranked rows, add/edit via ItemFormModal,
// delete via the shared ConfirmDialog, and reorder via drag (vue-draggable-plus
// / SortableJS) or the rows' up/down buttons — both paths call the same
// move-one-item endpoint. Item modal state is component-local (plain refs)
// rather than in useListModalsStore: unlike the list modals, these are only
// ever reachable from this page, so a shared store would be indirection with
// no second consumer.
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'

import BaseButton from '@/components/BaseButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EditListModal from './EditListModal.vue'
import ItemFormModal from './ItemFormModal.vue'
import ListItemRow from './ListItemRow.vue'
import type { ListItem, ListSummary } from './types'
import { useDeleteItem } from './useDeleteItem'
import { useDeleteList } from './useDeleteList'
import { useListDetail } from './useListDetail'
import { useListItems } from './useListItems'
import { useListModalsStore } from './useListModals'
import { useReorderItem } from './useReorderItem'

/** The product's namesake cap — mirrors the backend's ListFullError threshold. */
const MAX_ITEMS = 50

const route = useRoute()
const router = useRouter()

const { status, list, load, updateList } = useListDetail()
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
const isFull = computed(() => items.value.length >= MAX_ITEMS)

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

async function applyMove(item: ListItem, position: number): Promise<void> {
  const result = await reorderItem(listId.value, item.id, position)
  if (result) {
    setItems(result)
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
function nudge(item: ListItem, direction: -1 | 1): void {
  resetReorderError()
  const target = item.position + direction
  if (target < 1 || target > items.value.length || reorderPending.value) return
  void applyMove(item, target)
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

      <!-- ——— Items ——— -->

      <p v-if="itemsStatus === 'loading'" class="mt-6 text-muted">Loading items…</p>

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
              of {{ MAX_ITEMS }} ranked
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
          <VueDraggable
            v-model="itemsModel"
            tag="ul"
            handle=".drag-handle"
            :animation="200"
            ghost-class="drag-ghost"
            chosen-class="drag-chosen"
            :force-fallback="true"
            fallback-class="drag-dragging"
            :fallback-on-body="true"
            :fallback-tolerance="3"
            :disabled="reorderPending"
            class="mt-4 space-y-1"
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
