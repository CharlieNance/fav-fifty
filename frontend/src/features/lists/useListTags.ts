/**
 * Calls `PUT /api/v1/lists/:id/tags` and tracks in-flight/error state for the tag
 * management modal (docs/ARCHITECTURE.md §Tags and search). Mirrors
 * `useDeleteList.ts`'s pending/error shape. A 422 means the submitted set (after
 * de-dupe) exceeds the backend's per-list tag cap — its `detail` copy is shown
 * verbatim instead of a generic error.
 */
import type { ListSummary } from './types'
import { useListAction } from './useListAction'

export function useListTags() {
  const { pending, error, reset, run } = useListAction({
    fallback: 'Could not save the tags. Check them and try again.',
    showDetailFor: ['invalid'],
  })

  /** Replaces list `listId`'s full tag set. Returns the updated list on success; sets `error` and returns null otherwise. */
  function setTags(listId: string, tags: string[]): Promise<ListSummary | null> {
    return run((repo) => repo.setTags(listId, tags))
  }

  return { pending, error, setTags, reset }
}
