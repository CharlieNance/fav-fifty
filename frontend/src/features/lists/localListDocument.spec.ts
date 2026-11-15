import { afterEach, describe, expect, it, vi } from 'vitest'

import { ListError } from './listErrors'
import {
  createDocumentStore,
  emptyDocument,
  type LocalListsDocument,
  type Migration,
  parseDocument,
  STORAGE_FULL_DETAIL,
  STORAGE_KEY,
  STORAGE_NEWER_VERSION_DETAIL,
  STORAGE_UNAVAILABLE_DETAIL,
} from './localListDocument'
import { memoryStorage } from './localListTestUtils'

const NOW = '2026-11-14T12:00:00.000Z'
const T1 = '2026-10-13T18:00:00.000Z'
const options = { now: () => NOW, newId: () => 'new-id' }

function validDocument(): LocalListsDocument {
  return {
    schema_version: 1,
    device_id: 'device-1',
    claimed_at: null,
    lists: [
      {
        local_id: 'l1',
        title: 'Top Albums',
        tags: ['music'],
        created_at: T1,
        updated_at: T1,
        items: [
          {
            local_id: 'i1',
            text: 'In Rainbows',
            note: null,
            image_url: 'https://x.test/a.png',
            created_at: T1,
            updated_at: T1,
          },
        ],
      },
    ],
  }
}

describe('parseDocument', () => {
  it('accepts a valid document unchanged', () => {
    const doc = validDocument()
    expect(parseDocument(doc, options)).toEqual({
      ok: true,
      repaired: false,
      skipped: 0,
      document: doc,
    })
  })

  it.each([null, 'text', 42, [], {}, { schema_version: 0 }, { schema_version: '1' }])(
    'reports %j as unreadable',
    (raw) => {
      expect(parseDocument(raw, options)).toEqual({ ok: false, reason: 'unreadable' })
    },
  )

  it('refuses a document from a newer schema version', () => {
    expect(parseDocument({ ...validDocument(), schema_version: 2 }, options)).toEqual({
      ok: false,
      reason: 'newer-version',
    })
  })

  it('drops lists and items without an id or title/text, and duplicate ids', () => {
    const doc = validDocument()
    const item = doc.lists[0]!.items[0]!
    const raw = {
      ...doc,
      lists: [
        { ...doc.lists[0], items: [item, { ...item }, { ...item, local_id: 'i2', text: '' }, 'x'] },
        { ...doc.lists[0] }, // duplicate list id
        { ...doc.lists[0], local_id: 'l2', title: '   ' },
        { title: 'no id' },
        null,
      ],
    }
    const result = parseDocument(raw, options)
    expect(result.ok && result.repaired).toBe(true)
    // 3 items, then 4 lists; the dropped lists' items aren't counted.
    expect(result.ok && result.skipped).toBe(7)
    expect(result.ok && result.document).toEqual(doc)
  })

  it('repairs bad fields instead of dropping the entry', () => {
    const raw = {
      schema_version: 1,
      device_id: '',
      claimed_at: 'not a date',
      lists: [
        {
          local_id: 'l1',
          title: 'Top',
          tags: ['ok', 7, ''],
          created_at: 'nope',
          items: [
            { local_id: 'i1', text: 'A', note: 5, image_url: 'javascript:alert(1)' },
            { local_id: 'i2', text: 'B', note: '', image_url: '' },
          ],
        },
        { local_id: 'l2', title: 'No items or tags' },
      ],
    }
    const result = parseDocument(raw, options)
    expect(result).toEqual({
      ok: true,
      repaired: true,
      skipped: 0,
      document: {
        schema_version: 1,
        device_id: 'new-id',
        claimed_at: null,
        lists: [
          {
            local_id: 'l1',
            title: 'Top',
            tags: ['ok'],
            created_at: NOW,
            updated_at: NOW,
            items: [
              {
                local_id: 'i1',
                text: 'A',
                note: null,
                image_url: null,
                created_at: NOW,
                updated_at: NOW,
              },
              {
                local_id: 'i2',
                text: 'B',
                note: null,
                image_url: null,
                created_at: NOW,
                updated_at: NOW,
              },
            ],
          },
          {
            local_id: 'l2',
            title: 'No items or tags',
            tags: [],
            created_at: NOW,
            updated_at: NOW,
            items: [],
          },
        ],
      },
    })
  })

  it('keeps content over the limits: the server rejects it at import, with a reason', () => {
    const doc = validDocument()
    const item = doc.lists[0]!.items[0]!
    doc.lists[0]!.title = 'a'.repeat(500)
    doc.lists[0]!.items = Array.from({ length: 60 }, (_, i) => ({
      ...item,
      local_id: `i${i}`,
      text: `${i}`,
    }))
    const result = parseDocument(doc, options)
    expect(result.ok && result.repaired).toBe(false)
    expect(result.ok && result.document.lists[0]!.items).toHaveLength(60)
  })

  describe('migrations', () => {
    // A pretend v1 → v2 step, so the pipeline is tested before a real one exists.
    const addKind: Migration = (doc) => ({
      ...doc,
      schema_version: 2,
      lists: (doc.lists as Record<string, unknown>[]).map((list) => ({ ...list, kind: null })),
    })

    it('upgrades an old document step by step before validating it', () => {
      const migrate = vi.fn(addKind)
      const result = parseDocument(validDocument(), {
        ...options,
        migrations: { 1: migrate },
        currentVersion: 2,
      })
      expect(migrate).toHaveBeenCalledOnce()
      expect(result.ok && result.repaired).toBe(true)
      expect(result.ok && result.document.lists[0]!.title).toBe('Top Albums')
    })

    it('reports a version with no migration path as unreadable', () => {
      expect(
        parseDocument(validDocument(), { ...options, migrations: {}, currentVersion: 2 }),
      ).toEqual({
        ok: false,
        reason: 'unreadable',
      })
    })
  })
})

describe('createDocumentStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setup(initial?: string) {
    const storage = memoryStorage()
    if (initial !== undefined) storage.setItem(STORAGE_KEY, initial)
    const store = createDocumentStore({ storage: () => storage, ...options })
    return { storage, store }
  }

  function storageError(fn: () => unknown): string | null {
    try {
      fn()
    } catch (error) {
      expect(error).toBeInstanceOf(ListError)
      expect((error as ListError).kind).toBe('storage')
      return (error as ListError).detail
    }
    throw new Error('expected a ListError')
  }

  it('returns null when nothing is stored', () => {
    expect(setup().store.load()).toBeNull()
  })

  it('round-trips a document as snake_case JSON under the one key', () => {
    const { storage, store } = setup()
    store.save(validDocument())
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(validDocument())
    expect(store.load()).toEqual(validDocument())
  })

  it('sets aside unparseable JSON instead of overwriting it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { storage, store } = setup('{not json')
    expect(store.load()).toBeNull()
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(storage.getItem(`${STORAGE_KEY}:unreadable:${NOW}`)).toBe('{not json')
  })

  it('sets aside JSON that is not a lists document', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { storage, store } = setup('[1,2,3]')
    expect(store.load()).toBeNull()
    expect(storage.getItem(`${STORAGE_KEY}:unreadable:${NOW}`)).toBe('[1,2,3]')
  })

  it('leaves a newer-version document alone and asks for a reload', () => {
    const raw = JSON.stringify({ ...validDocument(), schema_version: 99 })
    const { storage, store } = setup(raw)
    expect(storageError(() => store.load())).toBe(STORAGE_NEWER_VERSION_DETAIL)
    expect(storage.getItem(STORAGE_KEY)).toBe(raw)
  })

  it('reports blocked storage (touching localStorage throws)', () => {
    const store = createDocumentStore({
      storage: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    expect(storageError(() => store.load())).toBe(STORAGE_UNAVAILABLE_DETAIL)
    expect(storageError(() => store.save(emptyDocument('d')))).toBe(STORAGE_UNAVAILABLE_DETAIL)
  })

  it('reports a full quota with its own copy', () => {
    const { storage, store } = setup()
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(storageError(() => store.save(validDocument()))).toBe(STORAGE_FULL_DETAIL)
  })
})
