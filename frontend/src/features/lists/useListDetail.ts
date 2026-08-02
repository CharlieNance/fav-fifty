/**
 * Fetches a single list by id for the details page (Interaction 5,
 * docs/LISTS_CRUD_PLAN.md). Kept separate from `ListDetailView.vue` so the
 * fetch/state logic is unit-testable on its own — mirrors `useLists.ts`'s shape,
 * with an extra `not-found` status so the view can render a friendly message
 * instead of a generic error for a 404 (deleted list, someone else's id, or a
 * stale bookmark — all indistinguishable by design, see §Ownership & security).
 */
import { ref } from 'vue'

import { apiFetch, ApiError } from '@/api/client'
import type { ListSummary } from './types'

export type ListDetailStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'error'

export function useListDetail() {
  const status = ref<ListDetailStatus>('idle')
  const list = ref<ListSummary | null>(null)

  async function load(id: string): Promise<void> {
    status.value = 'loading'
    try {
      list.value = await apiFetch<ListSummary>(`/lists/${id}`)
      status.value = 'success'
    } catch (error) {
      list.value = null
      status.value = error instanceof ApiError && error.status === 404 ? 'not-found' : 'error'
    }
  }

  /** Replace the loaded list with a fresher copy (e.g. after a rename). */
  function updateList(updated: ListSummary): void {
    if (list.value?.id === updated.id) {
      list.value = updated
    }
  }

  return { status, list, load, updateList }
}
