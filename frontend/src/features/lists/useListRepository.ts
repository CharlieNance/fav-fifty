/**
 * Returns the `ListRepository` the lists feature should use right now.
 *
 * Today that's always the API. When on-device storage lands
 * (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md, PR 4), this is the one place that
 * picks between the API and local storage based on the auth store, so no
 * composable or view has to change.
 *
 * Tests can swap in a fake with `setListRepository(fake)` and restore the
 * default with `setListRepository(null)`.
 */
import { apiListRepository, type ListRepository } from './listRepository'

let override: ListRepository | null = null

export function useListRepository(): ListRepository {
  return override ?? apiListRepository
}

/** Test seam: force a specific repository (pass `null` to go back to the default). */
export function setListRepository(repository: ListRepository | null): void {
  override = repository
}
