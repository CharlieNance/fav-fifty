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

  function openCreate(): void {
    isCreateOpen.value = true
  }

  function closeCreate(): void {
    isCreateOpen.value = false
  }

  return { isCreateOpen, openCreate, closeCreate }
})
