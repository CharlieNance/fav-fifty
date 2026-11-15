/**
 * The on-device lists document (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Local storage
 * format): one versioned JSON document per device, under one `localStorage` key.
 *
 * Three jobs live here, and nothing about lists or items as the views see them:
 *
 * 1. **The format.** `LocalListsDocument` is snake_case, like the API, so the claim
 *    upload (PR 7) can send it with no mapping. Rank is array order; no position is
 *    stored.
 * 2. **Reading untrusted data.** Anything in storage (or an imported file) may have
 *    been edited by hand or by an extension. `parseDocument` migrates it to the
 *    current schema, then keeps what's usable and drops or repairs the rest. It never
 *    throws on bad input.
 * 3. **Storage I/O.** `createDocumentStore` wraps `localStorage`, turning every
 *    browser failure (blocked, private mode, quota) into a `ListError('storage')`.
 */
import { ListError } from './listErrors'
import { isHttpUrl } from './listRules'

/** The one key the document lives under. The `v1` names the key, not the schema. */
export const STORAGE_KEY = 'favfifty:v1'

export const CURRENT_SCHEMA_VERSION = 1

export interface LocalItem {
  /** Client-generated UUID; also the item's `id` in the views. Never sent as a server id. */
  local_id: string
  text: string
  note: string | null
  image_url: string | null
  created_at: string
  updated_at: string
}

export interface LocalList {
  /** Client-generated UUID; also the list's `id` in the views (and its route). */
  local_id: string
  title: string
  tags: string[]
  created_at: string
  updated_at: string
  /** Rank order: `items[0]` is #1. */
  items: LocalItem[]
}

export interface LocalListsDocument {
  schema_version: typeof CURRENT_SCHEMA_VERSION
  /** Random, generated once per device; makes the claim upload idempotent. */
  device_id: string
  lists: LocalList[]
  /** When lists from this device were last uploaded to an account, or `null`. */
  claimed_at: string | null
}

/** Upgrades a raw document from version `n` (its key) to `n + 1`. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>

/**
 * One entry per old schema version. Empty while v1 is the only version. When a
 * field is added (e.g. `kind` on lists in Track 2), bump `CURRENT_SCHEMA_VERSION`,
 * add `1: (doc) => ({ ...doc, schema_version: 2, lists: … })` here, and teach
 * `parseDocument` the new field. Never edit a migration that has shipped: exported
 * files from months ago still go through it.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {}

export type ParseResult =
  | {
      ok: true
      document: LocalListsDocument
      /** True if anything was dropped, repaired or migrated on the way in. */
      repaired: boolean
    }
  | {
      ok: false
      /**
       * `newer-version`: saved by a newer app than this one, so don't touch it.
       * `unreadable`: not a lists document at all.
       */
      reason: 'newer-version' | 'unreadable'
    }

export interface ParseOptions {
  /** Fallback timestamp for entries with a missing or bad one. */
  now: () => string
  /** Used only if the document has no usable `device_id`. */
  newId: () => string
  migrations?: Readonly<Record<number, Migration>>
  currentVersion?: number
}

export function emptyDocument(deviceId: string): LocalListsDocument {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    device_id: deviceId,
    lists: [],
    claimed_at: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/**
 * Validate and repair one document that's already parsed from JSON.
 *
 * Kept: anything with the right shape. Dropped: lists or items with no id, no
 * title/text, or a duplicate id. Repaired: bad timestamps (→ now), a non-http(s)
 * image URL or bad note (→ `null`), non-string tags (removed).
 *
 * Content limits (lengths, the 50-item cap) are deliberately **not** enforced here.
 * Data over a limit is still the user's, and the server rejects it, with a message
 * saying why, when they try to import it.
 */
export function parseDocument(raw: unknown, options: ParseOptions): ParseResult {
  const migrations = options.migrations ?? MIGRATIONS
  const currentVersion = options.currentVersion ?? CURRENT_SCHEMA_VERSION

  if (!isRecord(raw)) return { ok: false, reason: 'unreadable' }
  const version = raw.schema_version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'unreadable' }
  }
  if (version > currentVersion) return { ok: false, reason: 'newer-version' }

  let doc = raw
  let repaired = false
  for (let v = version; v < currentVersion; v++) {
    const migrate = migrations[v]
    if (!migrate) return { ok: false, reason: 'unreadable' }
    doc = migrate(doc)
    repaired = true
  }

  const timestamp = (value: unknown): string => {
    if (isTimestamp(value)) return value
    repaired = true
    return options.now()
  }

  let deviceId: string
  if (nonEmptyString(doc.device_id)) {
    deviceId = doc.device_id
  } else {
    deviceId = options.newId()
    repaired = true
  }

  const rawLists = Array.isArray(doc.lists) ? doc.lists : []
  if (!Array.isArray(doc.lists)) repaired = true

  const lists: LocalList[] = []
  const listIds = new Set<string>()
  for (const rawList of rawLists) {
    if (
      !isRecord(rawList) ||
      !nonEmptyString(rawList.local_id) ||
      !nonEmptyString(rawList.title) ||
      listIds.has(rawList.local_id)
    ) {
      repaired = true
      continue
    }
    listIds.add(rawList.local_id)

    const rawTags = Array.isArray(rawList.tags) ? rawList.tags : []
    const tags = rawTags.filter(nonEmptyString)
    if (!Array.isArray(rawList.tags) || tags.length !== rawTags.length) repaired = true

    const rawItems = Array.isArray(rawList.items) ? rawList.items : []
    if (!Array.isArray(rawList.items)) repaired = true

    const items: LocalItem[] = []
    const itemIds = new Set<string>()
    for (const rawItem of rawItems) {
      if (
        !isRecord(rawItem) ||
        !nonEmptyString(rawItem.local_id) ||
        !nonEmptyString(rawItem.text) ||
        itemIds.has(rawItem.local_id)
      ) {
        repaired = true
        continue
      }
      itemIds.add(rawItem.local_id)

      let note: string | null = null
      if (nonEmptyString(rawItem.note)) note = rawItem.note
      else if (rawItem.note != null && rawItem.note !== '') repaired = true

      let imageUrl: string | null = null
      if (nonEmptyString(rawItem.image_url) && isHttpUrl(rawItem.image_url.trim())) {
        imageUrl = rawItem.image_url
      } else if (rawItem.image_url != null && rawItem.image_url !== '') {
        repaired = true
      }

      items.push({
        local_id: rawItem.local_id,
        text: rawItem.text,
        note,
        image_url: imageUrl,
        created_at: timestamp(rawItem.created_at),
        updated_at: timestamp(rawItem.updated_at),
      })
    }

    lists.push({
      local_id: rawList.local_id,
      title: rawList.title,
      tags,
      created_at: timestamp(rawList.created_at),
      updated_at: timestamp(rawList.updated_at),
      items,
    })
  }

  let claimedAt: string | null = null
  if (isTimestamp(doc.claimed_at)) claimedAt = doc.claimed_at
  else if (doc.claimed_at != null) repaired = true

  return {
    ok: true,
    repaired,
    document: {
      schema_version: CURRENT_SCHEMA_VERSION,
      device_id: deviceId,
      lists,
      claimed_at: claimedAt,
    },
  }
}

// --- storage I/O -------------------------------------------------------------

export const STORAGE_UNAVAILABLE_DETAIL =
  "Your browser isn't letting us save lists on this device. Private browsing or blocked site data can cause this."
export const STORAGE_FULL_DETAIL =
  'This device is out of space for saved lists. Delete a list you no longer need, or sign in to keep your lists in your account.'
export const STORAGE_NEWER_VERSION_DETAIL =
  'Your lists on this device were saved by a newer version of Fav Fifty. Reload the page to see them.'

export interface DocumentStore {
  /** The stored document, or `null` if there isn't one (or it was unreadable and set aside). */
  load(): LocalListsDocument | null
  save(document: LocalListsDocument): void
}

export interface DocumentStoreOptions {
  /** Returns the backing storage. A getter, because merely touching `window.localStorage` can throw. */
  storage?: () => Storage
  now?: () => string
  newId?: () => string
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22)
  )
}

/**
 * `localStorage`-backed load/save of the document.
 *
 * There's no in-memory cache: every `load` reads storage again. That keeps a second
 * tab from overwriting fresher data with a stale copy (each change is read, change,
 * write in one synchronous step), and it's cheap at this size (well under 1 MB).
 *
 * An unreadable document (bad JSON, or not a lists document) is copied to a
 * `favfifty:v1:unreadable:<time>` key and removed, so it's set aside rather than
 * silently overwritten. A document from a **newer** app version is left untouched,
 * and every call fails with a "reload" message until the page is reloaded.
 */
export function createDocumentStore(options: DocumentStoreOptions = {}): DocumentStore {
  const getStorage = options.storage ?? (() => window.localStorage)
  const now = options.now ?? (() => new Date().toISOString())
  const newId = options.newId ?? (() => crypto.randomUUID())

  function storage(): Storage {
    try {
      return getStorage()
    } catch (error) {
      throw new ListError('storage', STORAGE_UNAVAILABLE_DETAIL, { cause: error })
    }
  }

  function setAside(store: Storage, raw: string): void {
    try {
      store.setItem(`${STORAGE_KEY}:unreadable:${now()}`, raw)
      store.removeItem(STORAGE_KEY)
    } catch {
      // No room for the copy: leave the original in place rather than lose it.
      // The next save overwrites it, which is no worse than not being able to read it.
    }
    console.warn('Saved lists on this device were unreadable; set them aside and started fresh.')
  }

  return {
    load() {
      const store = storage()
      let raw: string | null
      try {
        raw = store.getItem(STORAGE_KEY)
      } catch (error) {
        throw new ListError('storage', STORAGE_UNAVAILABLE_DETAIL, { cause: error })
      }
      if (raw === null) return null

      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        setAside(store, raw)
        return null
      }

      const result = parseDocument(json, { now, newId })
      if (result.ok) return result.document
      if (result.reason === 'newer-version') {
        throw new ListError('storage', STORAGE_NEWER_VERSION_DETAIL)
      }
      setAside(store, raw)
      return null
    },

    save(document) {
      const store = storage()
      try {
        store.setItem(STORAGE_KEY, JSON.stringify(document))
      } catch (error) {
        const detail = isQuotaError(error) ? STORAGE_FULL_DETAIL : STORAGE_UNAVAILABLE_DETAIL
        throw new ListError('storage', detail, { cause: error })
      }
    },
  }
}
