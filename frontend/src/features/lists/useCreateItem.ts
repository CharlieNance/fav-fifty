/**
 * Calls `POST /api/lists/:id/items` and tracks in-flight/error state for the
 * add-item modal (Interaction 1, docs/ITEMS_CRUD_PLAN.md). A 409 means the
 * backend refused for a reason the user can fix (duplicate text, or the list
 * is at 50) — its `detail` copy is shown verbatim instead of a generic error.
 */
import { ref } from 'vue'

import { apiFetch, ApiError } from '@/api/client'
import type { ListItem, ListItemDraft } from './types'

export function useCreateItem() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  function reset(): void {
    error.value = null
  }

  /** Creates an item on list `listId`. Returns it on success; sets `error` and returns null otherwise. */
  async function createItem(listId: string, draft: ListItemDraft): Promise<ListItem | null> {
    pending.value = true
    error.value = null
    try {
      return await apiFetch<ListItem>(`/lists/${listId}/items`, {
        method: 'POST',
        body: JSON.stringify(draft),
      })
    } catch (caught) {
      error.value =
        caught instanceof ApiError && caught.status === 409 && caught.detail
          ? caught.detail
          : 'Could not add the item. Check it and try again.'
      return null
    } finally {
      pending.value = false
    }
  }

  return { pending, error, createItem, reset }
}
