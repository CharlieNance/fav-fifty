/**
 * Fetches the signed-in user's lists. Kept separate from `ListsView.vue` so the
 * fetch/state logic is unit-testable on its own and reusable once other actions
 * (create/edit/delete) need to refresh the same data.
 */
import { ref } from 'vue'

import { apiFetch } from '@/api/client'
import type { ListSummary } from './types'

export type ListsStatus = 'idle' | 'loading' | 'success' | 'error'

export function useLists() {
  const status = ref<ListsStatus>('idle')
  const lists = ref<ListSummary[]>([])

  async function load(): Promise<void> {
    status.value = 'loading'
    try {
      lists.value = await apiFetch<ListSummary[]>('/lists')
      status.value = 'success'
    } catch {
      status.value = 'error'
    }
  }

  return { status, lists, load }
}
