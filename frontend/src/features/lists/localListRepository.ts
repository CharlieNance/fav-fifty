/**
 * Anonymous storage: a `ListRepository` that keeps everything on this device
 * (docs/ARCHITECTURE.md §Anonymous lists). `useListRepository()` picks it
 * when nobody is signed in.
 *
 * It behaves like `apiListRepository` as far as the views can tell:
 * - Same rules as the backend (listRules.ts): trimming, lengths, the item cap,
 *   case-insensitive duplicate items, tag normalization and the tag cap.
 * - Same errors: `ListError` with kind `not-found` / `conflict` / `invalid` and the
 *   backend's `detail` copy, checked in the same order the API checks them
 *   (missing list → bad input → cap → duplicate). Storage problems are `storage`.
 * - Same derived fields: `id` is the `local_id`, `status` is `"draft"`,
 *   `item_count` is `items.length`, `position` is index + 1.
 * - Same ordering: `getLists` is most recently updated first, and (as on the
 *   server) only a rename changes a list's `updated_at`; item changes don't.
 *
 * Every call reads the document fresh from storage, applies the change, and writes
 * it back. A call that fails writes nothing.
 *
 * Creating a list also asks the browser, once, to keep this site's storage
 * (`navigator.storage.persist()`), so it's less likely to be evicted. It's a
 * request, not a guarantee, and it's made on a click rather than on page load
 * because some browsers (Firefox) show a prompt for it.
 */
import { getActivePinia } from 'pinia'

import { type ClientLimits, DEFAULT_LIMITS, useClientConfigStore } from '@/stores/clientConfig'
import { ListError } from './listErrors'
import type { ListRepository } from './listRepository'
import { listQuotaDetail, normalizeTags, validateItemDraft, validateTitle } from './listRules'
import {
  createDocumentStore,
  type DocumentStore,
  emptyDocument,
  type LocalItem,
  type LocalList,
  type LocalListsDocument,
} from './localListDocument'
import type { ListItem, ListSummary } from './types'

export interface LocalListRepositoryOptions {
  store?: DocumentStore
  /** The limits in effect. Defaults to the client config store's (bundled defaults without Pinia). */
  limits?: () => ClientLimits
  now?: () => string
  newId?: () => string
  /** Asks the browser to keep this site's storage. Defaults to `navigator.storage.persist()`. */
  requestPersistence?: () => void
}

/** Ask the browser to keep this site's storage. Also used after a file import. */
export function requestPersistentStorage(): void {
  // Best effort: missing in older browsers, and a refusal changes nothing for us.
  navigator.storage?.persist?.().catch(() => {})
}

function defaultLimits(): ClientLimits {
  return getActivePinia() ? useClientConfigStore().limits : DEFAULT_LIMITS
}

function toSummary(list: LocalList): ListSummary {
  return {
    id: list.local_id,
    title: list.title,
    status: 'draft',
    tags: [...list.tags],
    item_count: list.items.length,
    created_at: list.created_at,
    updated_at: list.updated_at,
  }
}

function toItem(list: LocalList, item: LocalItem, index: number): ListItem {
  return {
    id: item.local_id,
    list_id: list.local_id,
    position: index + 1,
    text: item.text,
    note: item.note,
    image_url: item.image_url,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

function toItems(list: LocalList): ListItem[] {
  return list.items.map((item, index) => toItem(list, item, index))
}

function findList(doc: LocalListsDocument, id: string): LocalList {
  const list = doc.lists.find((candidate) => candidate.local_id === id)
  if (!list) throw new ListError('not-found')
  return list
}

function findItemIndex(list: LocalList, itemId: string): number {
  const index = list.items.findIndex((item) => item.local_id === itemId)
  if (index === -1) throw new ListError('not-found')
  return index
}

function textCollides(list: LocalList, text: string, excludeItemId?: string): boolean {
  const lowered = text.toLowerCase()
  return list.items.some(
    (item) => item.local_id !== excludeItemId && item.text.toLowerCase() === lowered,
  )
}

const DUPLICATE_ITEM_DETAIL = 'An item with this text already exists in this list.'

export function createLocalListRepository(
  options: LocalListRepositoryOptions = {},
): ListRepository {
  const now = options.now ?? (() => new Date().toISOString())
  const newId = options.newId ?? (() => crypto.randomUUID())
  const store = options.store ?? createDocumentStore({ now, newId })
  const limits = options.limits ?? defaultLimits
  const requestPersistence = options.requestPersistence ?? requestPersistentStorage
  let persistenceRequested = false

  /** The stored document, or an empty one (not saved until something changes). */
  function read(): LocalListsDocument {
    return store.load() ?? emptyDocument(newId())
  }

  /** Read, apply `change`, write. If `change` throws, nothing is written. */
  function write<T>(change: (doc: LocalListsDocument) => T): T {
    const doc = read()
    const result = change(doc)
    store.save(doc)
    return result
  }

  return {
    async getLists(q) {
      const query = q?.trim().toLowerCase()
      const lists = read().lists.filter(
        (list) =>
          !query ||
          list.title.toLowerCase().includes(query) ||
          list.tags.some((tag) => tag.toLowerCase().includes(query)),
      )
      return lists
        .map(toSummary)
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    },

    async getList(id) {
      return toSummary(findList(read(), id))
    },

    async createList(title) {
      const currentLimits = limits()
      const validTitle = validateTitle(title, currentLimits)
      const created = write((doc) => {
        // Same quota as an account, so claiming these lists later can't fail on it.
        if (doc.lists.length >= currentLimits.max_lists_per_user) {
          throw new ListError('conflict', listQuotaDetail(currentLimits.max_lists_per_user))
        }
        const timestamp = now()
        const list: LocalList = {
          local_id: newId(),
          title: validTitle,
          tags: [],
          created_at: timestamp,
          updated_at: timestamp,
          items: [],
        }
        doc.lists.push(list)
        return toSummary(list)
      })
      if (!persistenceRequested) {
        persistenceRequested = true
        requestPersistence()
      }
      return created
    },

    async renameList(id, title) {
      return write((doc) => {
        const list = findList(doc, id)
        list.title = validateTitle(title, limits())
        list.updated_at = now()
        return toSummary(list)
      })
    },

    async deleteList(id) {
      write((doc) => {
        findList(doc, id)
        doc.lists = doc.lists.filter((list) => list.local_id !== id)
      })
    },

    async setTags(id, tags) {
      return write((doc) => {
        const list = findList(doc, id)
        list.tags = normalizeTags(tags, limits())
        return toSummary(list)
      })
    },

    async getItems(listId) {
      return toItems(findList(read(), listId))
    },

    async createItem(listId, draft) {
      return write((doc) => {
        const list = findList(doc, listId)
        const currentLimits = limits()
        const valid = validateItemDraft(draft, currentLimits)
        if (list.items.length >= currentLimits.max_items_per_list) {
          throw new ListError(
            'conflict',
            `This list already has ${currentLimits.max_items_per_list} items.`,
          )
        }
        if (textCollides(list, valid.text)) throw new ListError('conflict', DUPLICATE_ITEM_DETAIL)

        const timestamp = now()
        const item: LocalItem = {
          local_id: newId(),
          ...valid,
          created_at: timestamp,
          updated_at: timestamp,
        }
        list.items.push(item)
        return toItem(list, item, list.items.length - 1)
      })
    },

    async updateItem(listId, itemId, draft) {
      return write((doc) => {
        const list = findList(doc, listId)
        const index = findItemIndex(list, itemId)
        const valid = validateItemDraft(draft, limits())
        if (textCollides(list, valid.text, itemId)) {
          throw new ListError('conflict', DUPLICATE_ITEM_DETAIL)
        }

        const item = list.items[index]!
        Object.assign(item, valid, { updated_at: now() })
        return toItem(list, item, index)
      })
    },

    async deleteItem(listId, itemId) {
      write((doc) => {
        const list = findList(doc, listId)
        list.items.splice(findItemIndex(list, itemId), 1)
      })
    },

    async moveItem(listId, itemId, position) {
      return write((doc) => {
        const list = findList(doc, listId)
        const from = findItemIndex(list, itemId)
        if (!Number.isInteger(position) || position < 1 || position > list.items.length) {
          throw new ListError('invalid', 'Position is out of range for this list.')
        }
        const [moved] = list.items.splice(from, 1)
        list.items.splice(position - 1, 0, moved!)
        return toItems(list)
      })
    },
  }
}
