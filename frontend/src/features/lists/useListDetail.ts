/**
 * Fetches a single list by id for the details page (docs/ARCHITECTURE.md
 * §Lists). Kept separate from `ListDetailView.vue` so the
 * fetch/state logic is unit-testable on its own — mirrors `useLists.ts`'s shape,
 * with an extra `not-found` status so the view can render a friendly message
 * instead of a generic error for a 404 (deleted list, someone else's id, or a
 * stale bookmark — all indistinguishable by design).
 */
import { ref } from 'vue'

import type { ListSummary } from './types'
import { useListAction } from './useListAction'

export type ListDetailStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'error'

export function useListDetail() {
  const status = ref<ListDetailStatus>('idle')
  const list = ref<ListSummary | null>(null)
  const { error, errorKind, run } = useListAction({ fallback: 'Could not load the list.' })

  async function load(id: string): Promise<void> {
    status.value = 'loading'
    list.value = await run((repo) => repo.getList(id))
    if (list.value) {
      status.value = 'success'
    } else {
      status.value = errorKind.value === 'not-found' ? 'not-found' : 'error'
    }
  }

  /** Replace the loaded list with a fresher copy (e.g. after a rename). */
  function updateList(updated: ListSummary): void {
    if (list.value?.id === updated.id) {
      list.value = updated
    }
  }

  /** Why the load failed. Only a `storage` failure's copy is worth showing (see useLists). */
  return { status, list, error, errorKind, load, updateList }
}
