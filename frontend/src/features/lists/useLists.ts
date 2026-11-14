/**
 * Fetches the signed-in user's lists. Kept separate from `ListsView.vue` so the
 * fetch/state logic is unit-testable on its own and reusable once other actions
 * (create/edit/delete) need to refresh the same data.
 */
import { ref } from 'vue'

import type { ListSummary } from './types'
import { useListAction } from './useListAction'

export type ListsStatus = 'idle' | 'loading' | 'success' | 'error'

export function useLists() {
  const status = ref<ListsStatus>('idle')
  const lists = ref<ListSummary[]>([])
  const { run } = useListAction({ fallback: 'Could not load your lists.' })

  // Guards against a slower, earlier request (e.g. a stale search query)
  // resolving after a faster, later one and clobbering fresher results.
  let requestId = 0

  async function load(q?: string): Promise<void> {
    const thisRequest = ++requestId
    status.value = 'loading'
    const result = await run((repo) => repo.getLists(q))
    if (thisRequest !== requestId) return
    if (result) {
      lists.value = result
      status.value = 'success'
    } else {
      status.value = 'error'
    }
  }

  /** Replace one already-loaded list with a fresher copy (e.g. after a rename). */
  function updateList(updated: ListSummary): void {
    const index = lists.value.findIndex((list) => list.id === updated.id)
    if (index !== -1) {
      lists.value[index] = updated
    }
  }

  /** Drop one already-loaded list (e.g. after a confirmed delete). */
  function removeList(id: string): void {
    lists.value = lists.value.filter((list) => list.id !== id)
  }

  return { status, lists, load, updateList, removeList }
}
