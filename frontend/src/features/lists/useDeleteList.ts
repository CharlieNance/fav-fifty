/**
 * Calls `DELETE /api/v1/lists/:id` and tracks in-flight/error state for the
 * confirmation dialog. Kept separate from ConfirmDialog.vue itself so that
 * component stays a generic, list-agnostic overlay (see docs/ARCHITECTURE.md
 * §Frontend patterns) — this composable is where the list-specific request lives.
 */
import { useListAction } from './useListAction'

export function useDeleteList() {
  const { pending, error, reset, run } = useListAction({
    fallback: 'Could not delete the list. Try again.',
  })

  /** Deletes list `id`. Returns whether it succeeded; sets `error` on failure. */
  async function deleteList(id: string): Promise<boolean> {
    const done = await run(async (repo) => {
      await repo.deleteList(id)
      return true
    })
    return done ?? false
  }

  return { pending, error, deleteList, reset }
}
