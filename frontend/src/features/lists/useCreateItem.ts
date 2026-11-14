/**
 * Calls `POST /api/v1/lists/:id/items` and tracks in-flight/error state for the
 * add-item modal (Interaction 1, docs/ITEMS_CRUD_PLAN.md). A 409 means the
 * backend refused for a reason the user can fix (duplicate text, or the list
 * is at 50) — its `detail` copy is shown verbatim instead of a generic error.
 */
import type { ListItem, ListItemDraft } from './types'
import { useListAction } from './useListAction'

export function useCreateItem() {
  const { pending, error, reset, run } = useListAction({
    fallback: 'Could not add the item. Check it and try again.',
    showDetailFor: ['conflict'],
  })

  /** Creates an item on list `listId`. Returns it on success; sets `error` and returns null otherwise. */
  function createItem(listId: string, draft: ListItemDraft): Promise<ListItem | null> {
    return run((repo) => repo.createItem(listId, draft))
  }

  return { pending, error, createItem, reset }
}
