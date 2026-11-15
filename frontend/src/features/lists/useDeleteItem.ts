/**
 * Calls `DELETE /api/v1/lists/:listId/items/:itemId` and tracks in-flight/error
 * state for the confirmation dialog (docs/ARCHITECTURE.md §Items).
 * Same shape as `useDeleteList`, one level down — ConfirmDialog.vue stays a
 * generic shell; this composable is where the item-specific request lives.
 */
import { useListAction } from './useListAction'

export function useDeleteItem() {
  const { pending, error, reset, run } = useListAction({
    fallback: 'Could not delete the item. Try again.',
  })

  /** Deletes item `itemId` from list `listId`. Returns whether it succeeded; sets `error` on failure. */
  async function deleteItem(listId: string, itemId: string): Promise<boolean> {
    const done = await run(async (repo) => {
      await repo.deleteItem(listId, itemId)
      return true
    })
    return done ?? false
  }

  return { pending, error, deleteItem, reset }
}
