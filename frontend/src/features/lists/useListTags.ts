/**
 * Calls `PUT /api/lists/:id/tags` and tracks in-flight/error state for the tag
 * management modal (Interaction 1, docs/TAGS_SEARCH_PLAN.md). Mirrors
 * `useDeleteList.ts`'s pending/error shape. A 422 means the submitted set (after
 * de-dupe) exceeds the backend's per-list tag cap — its `detail` copy is shown
 * verbatim instead of a generic error.
 */
import { ref } from 'vue'

import { apiFetch, ApiError } from '@/api/client'
import type { ListSummary } from './types'

export function useListTags() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  function reset(): void {
    error.value = null
  }

  /** Replaces list `listId`'s full tag set. Returns the updated list on success; sets `error` and returns null otherwise. */
  async function setTags(listId: string, tags: string[]): Promise<ListSummary | null> {
    pending.value = true
    error.value = null
    try {
      return await apiFetch<ListSummary>(`/lists/${listId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tags }),
      })
    } catch (caught) {
      error.value =
        caught instanceof ApiError && caught.status === 422 && caught.detail
          ? caught.detail
          : 'Could not save the tags. Check them and try again.'
      return null
    } finally {
      pending.value = false
    }
  }

  return { pending, error, setTags, reset }
}
