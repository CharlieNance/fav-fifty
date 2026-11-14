/**
 * The service layer for the lists feature: runs one repository call and owns the
 * pending/error bookkeeping every list composable and modal needs, so none of
 * them repeat a try/catch/finally or know which storage (or error type) is in use.
 *
 * Each call creates independent state, so every dialog on a page gets its own
 * `pending`/`error`.
 *
 *     const { pending, error, reset, run } = useListAction({
 *       fallback: 'Could not add the item. Check it and try again.',
 *       showDetailFor: ['conflict'],
 *     })
 *     const created = await run((repo) => repo.createItem(listId, draft)) // null on failure
 *
 * On failure `error` is the storage layer's own copy when the error's kind is
 * listed in `showDetailFor` (and it wrote some), otherwise `fallback`. `errorKind`
 * lets callers branch on the reason (e.g. a "not found" page).
 */
import { ref } from 'vue'

import type { ListRepository } from './listRepository'
import { type ListErrorKind, toListError } from './listErrors'
import { useListRepository } from './useListRepository'

export interface ListActionOptions {
  /** Message shown when there's no more specific copy to show. */
  fallback: string
  /** Error kinds whose `detail` is user-facing and should be shown verbatim. */
  showDetailFor?: ListErrorKind[]
}

export function useListAction(options: ListActionOptions) {
  const pending = ref(false)
  const error = ref<string | null>(null)
  const errorKind = ref<ListErrorKind | null>(null)

  function reset(): void {
    error.value = null
    errorKind.value = null
  }

  /** Runs `action` against the active repository. Resolves to its result, or null on failure. */
  async function run<T>(action: (repo: ListRepository) => Promise<T>): Promise<T | null> {
    pending.value = true
    reset()
    try {
      // Resolved per call, so a sign-in/out switch of storage applies to the next request.
      return await action(useListRepository())
    } catch (caught) {
      const listError = toListError(caught)
      errorKind.value = listError.kind
      error.value =
        listError.detail && options.showDetailFor?.includes(listError.kind)
          ? listError.detail
          : options.fallback
      return null
    } finally {
      pending.value = false
    }
  }

  return { pending, error, errorKind, reset, run }
}
