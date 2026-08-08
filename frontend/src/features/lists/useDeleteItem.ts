/**
 * Calls `DELETE /api/lists/:listId/items/:itemId` and tracks in-flight/error
 * state for the confirmation dialog (Interaction 3, docs/ITEMS_CRUD_PLAN.md).
 * Same shape as `useDeleteList`, one level down — ConfirmDialog.vue stays a
 * generic shell; this composable is where the item-specific request lives.
 */
import { ref } from 'vue'

import { apiFetch } from '@/api/client'

export function useDeleteItem() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  function reset(): void {
    error.value = null
  }

  /** Deletes item `itemId` from list `listId`. Returns whether it succeeded; sets `error` on failure. */
  async function deleteItem(listId: string, itemId: string): Promise<boolean> {
    pending.value = true
    error.value = null
    try {
      await apiFetch<void>(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
      return true
    } catch {
      error.value = 'Could not delete the item. Try again.'
      return false
    } finally {
      pending.value = false
    }
  }

  return { pending, error, deleteItem, reset }
}
