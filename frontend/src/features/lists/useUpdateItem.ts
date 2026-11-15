/**
 * Calls `PATCH /api/v1/lists/:listId/items/:itemId` (full replace of text/note/
 * image_url — docs/ARCHITECTURE.md §Items) and tracks in-flight/
 * error state for the edit-item modal. Like `useCreateItem`, a 409 (text
 * collides with a DIFFERENT item) surfaces the backend's own copy.
 */
import type { ListItem, ListItemDraft } from './types'
import { useListAction } from './useListAction'

export function useUpdateItem() {
  const { pending, error, reset, run } = useListAction({
    fallback: 'Could not save the item. Check it and try again.',
    showDetailFor: ['conflict'],
  })

  /** Saves `draft` over item `itemId`. Returns the updated item, or null (with `error` set). */
  function updateItem(
    listId: string,
    itemId: string,
    draft: ListItemDraft,
  ): Promise<ListItem | null> {
    return run((repo) => repo.updateItem(listId, itemId, draft))
  }

  return { pending, error, updateItem, reset }
}
