/**
 * Test helpers for picking the list repository (only ever imported from
 * `*.spec.ts`, so none of this reaches the app bundle).
 */
import { afterEach, beforeEach } from 'vitest'

import { apiListRepository } from './listRepository'
import { setListRepository } from './useListRepository'

/**
 * For specs that mock `apiFetch`: use the API repository whoever is signed in.
 *
 * Without it, `useListRepository()` picks on-device storage for an anonymous
 * test (most specs never sign in), and the `apiFetch` mock would never be called.
 * Call it once at the top level of the spec file.
 */
export function pinApiRepository(): void {
  beforeEach(() => setListRepository(apiListRepository))
  afterEach(() => setListRepository(null))
}
