/**
 * Calls `PATCH /api/lists/:listId/items/:itemId` (full replace of text/note/
 * image_url — Interaction 2, docs/ITEMS_CRUD_PLAN.md) and tracks in-flight/
 * error state for the edit-item modal. Like `useCreateItem`, a 409 (text
 * collides with a DIFFERENT item) surfaces the backend's own copy.
 */
import { ref } from 'vue'

import { apiFetch, ApiError } from '@/api/client'
import type { ListItem, ListItemDraft } from './types'

export function useUpdateItem() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  function reset(): void {
    error.value = null
  }

  /** Saves `draft` over item `itemId`. Returns the updated item, or null (with `error` set). */
  async function updateItem(
    listId: string,
    itemId: string,
    draft: ListItemDraft,
  ): Promise<ListItem | null> {
    pending.value = true
    error.value = null
    try {
      return await apiFetch<ListItem>(`/lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      })
    } catch (caught) {
      error.value =
        caught instanceof ApiError && caught.status === 409 && caught.detail
          ? caught.detail
          : 'Could not save the item. Check it and try again.'
      return null
    } finally {
      pending.value = false
    }
  }

  return { pending, error, updateItem, reset }
}
