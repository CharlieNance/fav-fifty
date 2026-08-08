/**
 * Fetches and holds the ranked items for one list (docs/ITEMS_CRUD_PLAN.md).
 * Mirrors `useListDetail`'s shape: fetch/state logic lives here so it's
 * unit-testable without mounting the view. The view owns exactly one instance,
 * and every mutation flow (create/edit/delete/reorder) reports back into it via
 * the mutator functions below — the array here is the single source of truth
 * for what the page renders.
 *
 * No `not-found` status like `useListDetail` has: the view only fetches items
 * after the parent list itself loaded successfully, so a 404 here is just an
 * unexpected error, not a state worth its own UI.
 */
import { ref } from 'vue'

import { apiFetch } from '@/api/client'
import type { ListItem } from './types'

export type ListItemsStatus = 'idle' | 'loading' | 'success' | 'error'

export function useListItems() {
  const status = ref<ListItemsStatus>('idle')
  const items = ref<ListItem[]>([])

  async function load(listId: string): Promise<void> {
    status.value = 'loading'
    try {
      items.value = await apiFetch<ListItem[]>(`/lists/${listId}/items`)
      status.value = 'success'
    } catch {
      items.value = []
      status.value = 'error'
    }
  }

  /** Append a just-created item (the backend always inserts at the end). */
  function addItem(item: ListItem): void {
    items.value = [...items.value, item]
  }

  /** Swap in a fresher copy of one item (e.g. after an edit). */
  function replaceItem(updated: ListItem): void {
    items.value = items.value.map((item) => (item.id === updated.id ? updated : item))
  }

  /**
   * Drop a deleted item and renumber what's left `1..N`, mirroring the repack
   * the backend already did (DELETE returns 204, so there's no fresh list to
   * swap in — we reproduce the same contiguous order locally).
   */
  function removeItem(id: string): void {
    items.value = items.value
      .filter((item) => item.id !== id)
      .map((item, index) => ({ ...item, position: index + 1 }))
  }

  /** Replace the whole array (e.g. with the reorder endpoint's full response). */
  function setItems(next: ListItem[]): void {
    items.value = next
  }

  /**
   * Re-sort the array by each item's server-assigned `position`. Used to roll
   * back a drag the server rejected: the drag mutated the array's ORDER but
   * nobody touched the `position` fields, so sorting by them restores exactly
   * what the server still has.
   */
  function restoreServerOrder(): void {
    items.value = [...items.value].sort((a, b) => a.position - b.position)
  }

  return { status, items, load, addItem, replaceItem, removeItem, setItems, restoreServerOrder }
}
