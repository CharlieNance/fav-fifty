/**
 * Calls `DELETE /api/lists/:id` and tracks in-flight/error state for the
 * confirmation dialog. Kept separate from ConfirmDialog.vue itself so that
 * component stays a generic, list-agnostic overlay (see docs/LISTS_CRUD_PLAN.md
 * Interaction 4) — this composable is where the list-specific request lives.
 */
import { ref } from 'vue'

import { apiFetch } from '@/api/client'

export function useDeleteList() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  function reset(): void {
    error.value = null
  }

  /** Deletes list `id`. Returns whether it succeeded; sets `error` on failure. */
  async function deleteList(id: string): Promise<boolean> {
    pending.value = true
    error.value = null
    try {
      await apiFetch<void>(`/lists/${id}`, { method: 'DELETE' })
      return true
    } catch {
      error.value = 'Could not delete the list. Try again.'
      return false
    } finally {
      pending.value = false
    }
  }

  return { pending, error, deleteList, reset }
}
