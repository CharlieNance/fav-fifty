/**
 * Returns the `ListRepository` the lists feature should use right now: the API
 * for a signed-in user, on-device storage for everyone else
 * (docs/ARCHITECTURE.md §Choosing storage).
 *
 * It's resolved on every call (`useListAction` asks per request), so signing in or
 * out switches storage for the next request without remounting anything. The
 * views reload what's on screen when that happens (see `useListsRefresh`).
 *
 * Tests can swap in a fake with `setListRepository(fake)` and restore the
 * default with `setListRepository(null)`.
 */
import { useAuthStore } from '@/stores/auth'
import { apiListRepository, type ListRepository } from './listRepository'
import { createLocalListRepository } from './localListRepository'

let override: ListRepository | null = null
// Created on first anonymous use. It holds no data of its own (every call reads
// storage), so one instance for the page's lifetime is fine.
let localRepository: ListRepository | null = null

export function useListRepository(): ListRepository {
  if (override) return override
  if (useAuthStore().isAuthenticated) return apiListRepository
  localRepository ??= createLocalListRepository()
  return localRepository
}

/** Test seam: force a specific repository (pass `null` to go back to the default). */
export function setListRepository(repository: ListRepository | null): void {
  override = repository
}
