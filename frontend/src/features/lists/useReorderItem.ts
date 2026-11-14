/**
 * Calls `PATCH /api/v1/lists/:listId/items/:itemId/position` (Interaction 4,
 * docs/ITEMS_CRUD_PLAN.md). One move per call — the endpoint matches a single
 * drag-drop or up/down-button move directly, and its response is the FULL
 * re-ranked item list, so the caller swaps its whole array in one shot and can
 * never drift from the server's order on success. On failure the caller is
 * responsible for restoring the server's order (see
 * `useListItems.restoreServerOrder`), so the UI never silently shows an order
 * the server doesn't have.
 */
import type { ListItem } from './types'
import { useListAction } from './useListAction'

export function useReorderItem() {
  const { pending, error, reset, run } = useListAction({
    fallback: 'Could not move the item. The order was restored.',
  })

  /**
   * Moves `itemId` to 1-based rank `position`. Returns the full re-ranked item
   * list on success; null (with `error` set) on failure.
   */
  function reorderItem(
    listId: string,
    itemId: string,
    position: number,
  ): Promise<ListItem[] | null> {
    return run((repo) => repo.moveItem(listId, itemId, position))
  }

  return { pending, error, reorderItem, reset }
}
