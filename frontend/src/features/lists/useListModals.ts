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

  return { isCreateOpen, openCreate, closeCreate, editingListId, openEdit, closeEdit }
})
