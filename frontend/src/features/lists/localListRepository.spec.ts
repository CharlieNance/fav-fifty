import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ClientLimits, DEFAULT_LIMITS, useClientConfigStore } from '@/stores/clientConfig'
import { ListError, type ListErrorKind } from './listErrors'
import type { ListRepository } from './listRepository'
import { createDocumentStore, type DocumentStore, STORAGE_KEY } from './localListDocument'
import { createLocalListRepository } from './localListRepository'
import { memoryStorage } from './localListTestUtils'
import type { ListItemDraft } from './types'

const draft = (text: string, extra: Partial<ListItemDraft> = {}): ListItemDraft => ({
  text,
  note: null,
  image_url: null,
  ...extra,
})

let storage: Storage
let store: DocumentStore
let repo: ListRepository
let limits: ClientLimits

beforeEach(() => {
  // A clock that ticks one second per call and sequential ids, so ordering and
  // output are deterministic.
  let tick = 0
  let id = 0
  const now = () => new Date(Date.UTC(2026, 10, 14, 12, 0, tick++)).toISOString()
  const newId = () => `id-${++id}`
  storage = memoryStorage()
  store = createDocumentStore({ storage: () => storage, now, newId })
  limits = { ...DEFAULT_LIMITS }
  repo = createLocalListRepository({ store, now, newId, limits: () => limits })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Expect `promise` to reject with a `ListError` of `kind`; return its detail. */
async function rejection(promise: Promise<unknown>, kind: ListErrorKind): Promise<string | null> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ListError)
  expect((error as ListError).kind).toBe(kind)
  return (error as ListError).detail
}

/** The raw stored document, parsed. */
function stored() {
  const raw = storage.getItem(STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

async function listWith(...texts: string[]) {
  const list = await repo.createList('Top Albums')
  const items = []
  for (const text of texts) items.push(await repo.createItem(list.id, draft(text)))
  return { list, items }
}

describe('lists', () => {
  it('starts empty without writing anything', async () => {
    expect(await repo.getLists()).toEqual([])
    expect(stored()).toBeNull()
  })

  it('creates a list shaped like the API response and saves it', async () => {
    const list = await repo.createList('  Top Albums ')
    expect(list).toEqual({
      id: 'id-2', // id-1 is the new device_id
      title: 'Top Albums',
      status: 'draft',
      tags: [],
      item_count: 0,
      created_at: list.created_at,
      updated_at: list.created_at,
    })
    expect(await repo.getList(list.id)).toEqual(list)
    expect(stored()).toMatchObject({
      schema_version: 1,
      device_id: 'id-1',
      claimed_at: null,
      lists: [{ local_id: 'id-2', title: 'Top Albums', tags: [], items: [] }],
    })
  })

  it('keeps the device id once it is saved', async () => {
    await repo.createList('A')
    await repo.createList('B')
    expect(stored().device_id).toBe('id-1')
  })

  it('rejects an invalid title with the backend copy and writes nothing', async () => {
    expect(await rejection(repo.createList('  '), 'invalid')).toBe('Title is required.')
    expect(stored()).toBeNull()
  })

  it('reports a missing list as not-found', async () => {
    await rejection(repo.getList('nope'), 'not-found')
    await rejection(repo.renameList('nope', 'X'), 'not-found')
    await rejection(repo.deleteList('nope'), 'not-found')
    await rejection(repo.setTags('nope', []), 'not-found')
    await rejection(repo.getItems('nope'), 'not-found')
  })

  it('renames, and the rename moves the list to the top', async () => {
    const a = await repo.createList('A')
    await repo.createList('B')
    expect((await repo.getLists()).map((l) => l.title)).toEqual(['B', 'A'])

    const renamed = await repo.renameList(a.id, ' A2 ')
    expect(renamed.title).toBe('A2')
    expect(renamed.updated_at > a.updated_at).toBe(true)
    expect((await repo.getLists()).map((l) => l.title)).toEqual(['A2', 'B'])
  })

  it('does not change the list order when items change, as on the server', async () => {
    const { list } = await listWith()
    await repo.createList('Newer')
    await repo.createItem(list.id, draft('X'))
    expect((await repo.getLists()).map((l) => l.title)).toEqual(['Newer', 'Top Albums'])
  })

  it('deletes', async () => {
    const { list } = await listWith('X')
    await repo.deleteList(list.id)
    expect(await repo.getLists()).toEqual([])
    await rejection(repo.getList(list.id), 'not-found')
  })

  it('normalizes, dedupes and caps tags with the backend copy', async () => {
    const list = await repo.createList('A')
    const tagged = await repo.setTags(list.id, ['  Sci   Fi ', 'sci fi', 'Music'])
    expect(tagged.tags).toEqual(['sci fi', 'music'])
    expect((await repo.getList(list.id)).tags).toEqual(['sci fi', 'music'])

    limits.max_tags_per_list = 2
    expect(await rejection(repo.setTags(list.id, ['a', 'b', 'c']), 'invalid')).toBe(
      'A list can have at most 2 tags.',
    )
    expect((await repo.getList(list.id)).tags).toEqual(['sci fi', 'music'])
  })

  describe('search', () => {
    beforeEach(async () => {
      const albums = await repo.createList('Top Albums')
      await repo.setTags(albums.id, ['music'])
      const desserts = await repo.createList('Desserts')
      await repo.setTags(desserts.id, ['food', 'sweet'])
    })

    it.each([
      ['album', ['Top Albums']],
      ['MUSIC', ['Top Albums']],
      ['swe', ['Desserts']],
      ['s', ['Desserts', 'Top Albums']],
      ['   ', ['Desserts', 'Top Albums']],
      ['zzz', []],
    ])('q=%j matches titles or tags, case-insensitively', async (q, titles) => {
      expect((await repo.getLists(q)).map((l) => l.title)).toEqual(titles)
    })
  })
})

describe('items', () => {
  it('appends items with 1-based positions, shaped like the API response', async () => {
    const { list, items } = await listWith('In Rainbows', 'OK Computer')
    expect(items[1]).toEqual({
      id: items[1]!.id,
      list_id: list.id,
      position: 2,
      text: 'OK Computer',
      note: null,
      image_url: null,
      created_at: items[1]!.created_at,
      updated_at: items[1]!.created_at,
    })
    expect(await repo.getItems(list.id)).toEqual(items)
    expect((await repo.getList(list.id)).item_count).toBe(2)
  })

  it('validates and trims the draft', async () => {
    const { list } = await listWith()
    const item = await repo.createItem(
      list.id,
      draft(' Kid A ', { note: '  ', image_url: ' https://x.test/a.png ' }),
    )
    expect(item).toMatchObject({ text: 'Kid A', note: null, image_url: 'https://x.test/a.png' })
    expect(
      await rejection(
        repo.createItem(list.id, draft('X', { image_url: 'javascript:x' })),
        'invalid',
      ),
    ).toBe('Image URL must start with http:// or https://.')
  })

  it('enforces the item cap with the backend copy', async () => {
    limits.max_items_per_list = 2
    const { list } = await listWith('A', 'B')
    expect(await rejection(repo.createItem(list.id, draft('C')), 'conflict')).toBe(
      'This list already has 2 items.',
    )
    expect(await repo.getItems(list.id)).toHaveLength(2)
  })

  it('checks bad input before the cap, as the API does', async () => {
    limits.max_items_per_list = 1
    const { list } = await listWith('A')
    await rejection(repo.createItem(list.id, draft(' ')), 'invalid')
  })

  it('rejects a duplicate item case-insensitively', async () => {
    const { list } = await listWith('In Rainbows')
    expect(await rejection(repo.createItem(list.id, draft(' in rainbows ')), 'conflict')).toBe(
      'An item with this text already exists in this list.',
    )
  })

  it('updates an item in place, keeping its rank', async () => {
    const { list, items } = await listWith('A', 'B')
    const updated = await repo.updateItem(list.id, items[0]!.id, draft(' a ', { note: 'n' }))
    expect(updated).toMatchObject({ id: items[0]!.id, position: 1, text: 'a', note: 'n' })
    expect(updated.created_at).toBe(items[0]!.created_at)
    expect(updated.updated_at > items[0]!.updated_at).toBe(true)
    expect((await repo.getItems(list.id))[0]).toEqual(updated)
  })

  it('rejects an update that duplicates another item', async () => {
    const { list, items } = await listWith('A', 'B')
    expect(await rejection(repo.updateItem(list.id, items[0]!.id, draft('b')), 'conflict')).toBe(
      'An item with this text already exists in this list.',
    )
  })

  it('reports a missing item as not-found, including one from another list', async () => {
    const { list } = await listWith('A')
    const other = await repo.createList('Other')
    const foreign = await repo.createItem(other.id, draft('X'))
    await rejection(repo.updateItem(list.id, foreign.id, draft('Y')), 'not-found')
    await rejection(repo.deleteItem(list.id, 'nope'), 'not-found')
    await rejection(repo.moveItem(list.id, 'nope', 1), 'not-found')
    await rejection(repo.createItem('nope', draft('Y')), 'not-found')
  })

  it('deletes an item and closes the gap in the ranks', async () => {
    const { list, items } = await listWith('A', 'B', 'C')
    await repo.deleteItem(list.id, items[0]!.id)
    expect((await repo.getItems(list.id)).map((i) => [i.position, i.text])).toEqual([
      [1, 'B'],
      [2, 'C'],
    ])
  })

  it.each([
    [3, 1, ['C', 'A', 'B', 'D']],
    [1, 3, ['B', 'C', 'A', 'D']],
    [2, 2, ['A', 'B', 'C', 'D']],
    [1, 4, ['B', 'C', 'D', 'A']],
  ])('moves #%i to #%i and returns the re-ranked list', async (from, to, expected) => {
    const { list, items } = await listWith('A', 'B', 'C', 'D')
    const moved = await repo.moveItem(list.id, items[from - 1]!.id, to)
    expect(moved.map((i) => i.text)).toEqual(expected)
    expect(moved.map((i) => i.position)).toEqual([1, 2, 3, 4])
    expect(await repo.getItems(list.id)).toEqual(moved)
  })

  it.each([0, 3, 1.5, Number.NaN])('rejects position %s as out of range', async (position) => {
    const { list, items } = await listWith('A', 'B')
    expect(await rejection(repo.moveItem(list.id, items[0]!.id, position), 'invalid')).toBe(
      'Position is out of range for this list.',
    )
  })
})

describe('storage', () => {
  it('writes nothing when a call fails', async () => {
    const { list } = await listWith('A')
    const save = vi.spyOn(store, 'save')
    await rejection(repo.createItem(list.id, draft('a')), 'conflict')
    await rejection(repo.renameList(list.id, ''), 'invalid')
    expect(save).not.toHaveBeenCalled()
  })

  it('sees changes made by another tab, since it never caches', async () => {
    const { list } = await listWith('A')
    const otherTab = createLocalListRepository({ store, limits: () => limits })
    await otherTab.renameList(list.id, 'From the other tab')
    expect((await repo.getList(list.id)).title).toBe('From the other tab')
  })

  it('passes storage failures through as ListError("storage")', async () => {
    const blocked = createLocalListRepository({
      store: createDocumentStore({
        storage: () => {
          throw new DOMException('denied', 'SecurityError')
        },
      }),
    })
    await rejection(blocked.getLists(), 'storage')
    await rejection(blocked.createList('A'), 'storage')
  })

  it('asks the browser to keep its storage once, after the first list is saved', async () => {
    const requestPersistence = vi.fn()
    const asking = createLocalListRepository({ store, limits: () => limits, requestPersistence })

    await rejection(asking.createList(''), 'invalid')
    expect(requestPersistence).not.toHaveBeenCalled()

    await asking.createList('A')
    await asking.createList('B')
    expect(requestPersistence).toHaveBeenCalledTimes(1)
  })
})

describe('limits', () => {
  it('reads the client config store by default', async () => {
    setActivePinia(createPinia())
    useClientConfigStore().limits.max_items_per_list = 2
    const configured = createLocalListRepository({ store })
    const list = await configured.createList('A')
    await configured.createItem(list.id, draft('X'))
    await configured.createItem(list.id, draft('Y'))
    expect(await rejection(configured.createItem(list.id, draft('Z')), 'conflict')).toBe(
      'This list already has 2 items.',
    )
  })
})
