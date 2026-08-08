/**
 * Shared fixtures for the item specs (only ever imported from `*.spec.ts`, so
 * none of this reaches the app bundle). One factory instead of per-spec object
 * literals: the `ListItem` shape has eight fields, and most tests care about
 * two of them.
 */
import type { ListItem } from './types'

export function makeItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    id: 'item-1',
    list_id: 'list-1',
    position: 1,
    text: 'The Empire Strikes Back',
    note: null,
    image_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** `count` items ranked 1..count, ids `item-1`..`item-count`, distinct texts. */
export function makeItems(count: number): ListItem[] {
  return Array.from({ length: count }, (_, index) =>
    makeItem({
      id: `item-${index + 1}`,
      position: index + 1,
      text: `Favorite thing ${index + 1}`,
    }),
  )
}
