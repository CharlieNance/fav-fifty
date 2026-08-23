/**
 * Shared open/closed state for the create/edit list modals (docs/LISTS_CRUD_PLAN.md
 * "Modals, not pages"). A Pinia store rather than component-local state because the
 * same modal has to be reachable from wherever "Start a list" or "New list" lives
 * (the header, the homepage hero, the index) without route gymnastics.
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useListModalsStore = defineStore('listModals', () => {
  const isCreateOpen = ref(false)
  // Which list is being renamed, if any. Just an id — EditListModal.vue is
  // rendered by whichever page has the list's data in hand (index row, or
  // the details page's own fetch), keyed off this id, rather than living
  // globally like CreateListModal (which needs no existing list to open).
  const editingListId = ref<string | null>(null)
  // Same shape as editingListId, for the delete confirmation (Interaction 4):
  // whichever page has the list in hand mounts ConfirmDialog, keyed off this id.
  const deletingListId = ref<string | null>(null)
  // Same shape again, for the tag management modal (docs/TAGS_SEARCH_PLAN.md
  // Interaction 1) — only ever opened from the details page today, but kept
  // here rather than component-local so it follows the same pattern as the
  // other two per-list overlays.
  const managingTagsListId = ref<string | null>(null)

  function openCreate(): void {
    isCreateOpen.value = true
  }

  function closeCreate(): void {
    isCreateOpen.value = false
  }

  function openEdit(listId: string): void {
    editingListId.value = listId
  }

  function closeEdit(): void {
    editingListId.value = null
  }

  function openDelete(listId: string): void {
    deletingListId.value = listId
  }

  function closeDelete(): void {
    deletingListId.value = null
  }

  function openManageTags(listId: string): void {
    managingTagsListId.value = listId
  }

  function closeManageTags(): void {
    managingTagsListId.value = null
  }

  return {
    isCreateOpen,
    openCreate,
    closeCreate,
    editingListId,
    openEdit,
    closeEdit,
    deletingListId,
    openDelete,
    closeDelete,
    managingTagsListId,
    openManageTags,
    closeManageTags,
  }
})
