/**
 * The storage seam for lists and items (docs/ARCHITECTURE.md
 * §Layers). Every list composable and modal goes through a `ListRepository`
 * instead of calling `apiFetch` directly, so the same views can run against
 * either the REST API (signed in) or on-device storage (anonymous).
 *
 * Contract for implementations:
 * - Use the same types the views already use (`ListSummary`, `ListItem`,
 *   `ListItemDraft`), so views never know which storage is active.
 * - Fail with `ListError` (listErrors.ts), never a storage-specific error:
 *   `not-found` for a missing list/item, `conflict` for the 50-item cap or a
 *   duplicate item, `invalid` for validation, with the same user-facing `detail`
 *   copy the API writes. Callers go through `useListAction`, which only knows
 *   `ListError`, so they work whichever implementation is behind them.
 */
import { apiFetch } from '@/api/client'
import { toListError } from './listErrors'
import type { LocalList } from './localListDocument'
import type { ListItem, ListItemDraft, ListsImportResult, ListSummary } from './types'

export interface ListRepository {
  // lists
  /** All of the user's lists, optionally filtered by search text `q`. */
  getLists(q?: string): Promise<ListSummary[]>
  getList(id: string): Promise<ListSummary>
  createList(title: string): Promise<ListSummary>
  renameList(id: string, title: string): Promise<ListSummary>
  deleteList(id: string): Promise<void>
  /** Replaces the list's full tag set. */
  setTags(id: string, tags: string[]): Promise<ListSummary>

  // items
  /** The list's items in rank order (`position` 1..N). */
  getItems(listId: string): Promise<ListItem[]>
  /** Appends a new item at the end of the list. */
  createItem(listId: string, draft: ListItemDraft): Promise<ListItem>
  /** Full replace of the item's editable fields. */
  updateItem(listId: string, itemId: string, draft: ListItemDraft): Promise<ListItem>
  deleteItem(listId: string, itemId: string): Promise<void>
  /** Moves an item to 1-based rank `position`; resolves to the full re-ranked list. */
  moveItem(listId: string, itemId: string, position: number): Promise<ListItem[]>
}

/**
 * The body of `POST /lists/import`: lists in the on-device format, sent as stored.
 * The server ignores fields it doesn't know (item `local_id`s, a later schema's
 * additions), and keys each list on `"<device_id>:<local_id>"` so a retry can't
 * duplicate it.
 */
export interface ListsUpload {
  device_id: string
  lists: LocalList[]
}

/**
 * Uploading lists to an account. Only the API has it: it isn't part of
 * `ListRepository`, because on-device storage has nothing to upload to (a file
 * import on the device merges into storage directly, see `useListTransfer`).
 */
export interface AccountImport {
  /**
   * Add `upload.lists` to the signed-in user's account in one all-or-nothing,
   * idempotent request. Fails with `ListError('invalid')` naming the list that
   * breaks a rule (nothing is written), or with the server's copy for too many
   * lists or too large an upload.
   */
  importLists(upload: ListsUpload): Promise<ListsImportResult>
}

/** `apiFetch`, with any failure translated to a `ListError` at the repository boundary. */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await (options ? apiFetch<T>(path, options) : apiFetch<T>(path))
  } catch (error) {
    throw toListError(error)
  }
}

/** Signed-in storage: a thin wrapper over the `/api/v1/lists` REST endpoints. */
export const apiListRepository: ListRepository & AccountImport = {
  getLists(q) {
    const path = q ? `/lists?q=${encodeURIComponent(q)}` : '/lists'
    return request<ListSummary[]>(path)
  },

  getList(id) {
    return request<ListSummary>(`/lists/${id}`)
  },

  createList(title) {
    return request<ListSummary>('/lists', {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
  },

  renameList(id, title) {
    return request<ListSummary>(`/lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  },

  async deleteList(id) {
    await request<void>(`/lists/${id}`, { method: 'DELETE' })
  },

  setTags(id, tags) {
    return request<ListSummary>(`/lists/${id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    })
  },

  getItems(listId) {
    return request<ListItem[]>(`/lists/${listId}/items`)
  },

  createItem(listId, draft) {
    return request<ListItem>(`/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify(draft),
    })
  },

  updateItem(listId, itemId, draft) {
    return request<ListItem>(`/lists/${listId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    })
  },

  async deleteItem(listId, itemId) {
    await request<void>(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
  },

  moveItem(listId, itemId, position) {
    return request<ListItem[]>(`/lists/${listId}/items/${itemId}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ position }),
    })
  },

  importLists(upload) {
    return request<ListsImportResult>('/lists/import', {
      method: 'POST',
      body: JSON.stringify(upload),
    })
  },
}
