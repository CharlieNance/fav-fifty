/**
 * Calls `PATCH /api/lists/:listId/items/:itemId/position` (Interaction 4,
 * docs/ITEMS_CRUD_PLAN.md). One move per call — the endpoint matches a single
 * drag-drop or up/down-button move directly, and its response is the FULL
 * re-ranked item list, so the caller swaps its whole array in one shot and can
 * never drift from the server's order on success. On failure the caller is
 * responsible for restoring the server's order (see
 * `useListItems.restoreServerOrder`), so the UI never silently shows an order
 * the server doesn't have.
 */
import { ref } from 'vue'

import { apiFetch } from '@/api/client'
import type { ListItem } from './types'

export function useReorderItem() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  function reset(): void {
    error.value = null
  }

  /**
   * Moves `itemId` to 1-based rank `position`. Returns the full re-ranked item
   * list on success; null (with `error` set) on failure.
   */
  async function reorderItem(
    listId: string,
    itemId: string,
    position: number,
  ): Promise<ListItem[] | null> {
    pending.value = true
    error.value = null
    try {
      return await apiFetch<ListItem[]>(`/lists/${listId}/items/${itemId}/position`, {
        method: 'PATCH',
        body: JSON.stringify({ position }),
      })
    } catch {
      error.value = 'Could not move the item. The order was restored.'
      return null
    } finally {
      pending.value = false
    }
  }

  return { pending, error, reorderItem, reset }
}
