import { describe, expect, it } from 'vitest'

import { type ClientLimits, DEFAULT_LIMITS } from '@/stores/clientConfig'
import { ListError } from './listErrors'
import { createDocumentStore, emptyDocument, parseDocument } from './localListDocument'
import { createLocalListRepository } from './localListRepository'
import { memoryStorage } from './localListTestUtils'
import {
  collectExport,
  exportFileName,
  IMPORT_ALL_SKIPPED_DETAIL,
  IMPORT_EMPTY_DETAIL,
  IMPORT_NEWER_VERSION_DETAIL,
  IMPORT_UNREADABLE_DETAIL,
  claimSummaryMessage,
  importSummaryMessage,
  mergeImportedLists,
  summarizeAccountImport,
  tooManyListsDetail,
  parseImportFile,
  type ParsedImport,
  serializeExport,
} from './localListTransfer'

const NOW = '2026-11-14T12:00:00.000Z'

function sequentialIds() {
  let n = 0
  return () => `new-${++n}`
}

function item(text: string, extra: Record<string, unknown> = {}) {
  return {
    local_id: `item-${text}`,
    text,
    note: null,
    image_url: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...extra,
  }
}

function list(title: string, items: unknown[] = [], extra: Record<string, unknown> = {}) {
  return {
    local_id: `list-${title}`,
    title,
    tags: [],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    items,
    ...extra,
  }
}

function file(lists: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    device_id: 'other-device',
    lists,
    claimed_at: null,
    ...extra,
  })
}

function parse(text: string, limits: ClientLimits = DEFAULT_LIMITS): ParsedImport {
  return parseImportFile(text, { limits, now: () => NOW, newId: sequentialIds() })
}

/** Run `fn`, expecting a `ListError('invalid')`; return its detail. */
function rejection(fn: () => unknown): string | null {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ListError)
    expect((error as ListError).kind).toBe('invalid')
    return (error as ListError).detail
  }
  throw new Error('expected a rejection')
}

describe('export', () => {
  it('names the file after the local date', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('fav-fifty-lists-2026-01-05.json')
  })

  it('writes a document that reads back unchanged', () => {
    const doc = {
      ...emptyDocument('device-1'),
      lists: [parse(file([list('Albums', [item('A')])])).lists[0]!],
    }
    const text = serializeExport(doc)

    expect(text.endsWith('\n')).toBe(true)
    const result = parseDocument(JSON.parse(text), { now: () => NOW, newId: sequentialIds() })
    expect(result).toEqual({ ok: true, repaired: false, skipped: 0, document: doc })
  })

  it('collects every list and its items from a repository, with fresh ids', async () => {
    const storage = memoryStorage()
    const store = createDocumentStore({ storage: () => storage })
    let tick = 0
    const now = () => new Date(Date.UTC(2026, 10, 14, 12, 0, tick++)).toISOString()
    const repo = createLocalListRepository({ store, now, requestPersistence: () => {} })
    const albums = await repo.createList('Albums')
    await repo.setTags(albums.id, ['music'])
    await repo.createItem(albums.id, { text: 'B', note: 'second', image_url: null })
    await repo.createItem(albums.id, { text: 'A', note: null, image_url: 'https://x.test/a.png' })
    await repo.moveItem(albums.id, (await repo.getItems(albums.id))[1]!.id, 1)
    await repo.createList('Songs')

    const doc = await collectExport(repo, sequentialIds())

    expect(doc.device_id).toBe('new-1')
    expect(doc.lists.map((l) => l.title).sort()).toEqual(['Albums', 'Songs'])
    const exported = doc.lists.find((l) => l.title === 'Albums')!
    expect(exported).toMatchObject({ tags: ['music'], created_at: albums.created_at })
    expect(exported.items).toMatchObject([
      { text: 'A', note: null, image_url: 'https://x.test/a.png' },
      { text: 'B', note: 'second', image_url: null },
    ])
    // None of the storage's own ids leave in the file.
    const ids = [exported.local_id, ...exported.items.map((i) => i.local_id)]
    expect(ids.every((id) => id.startsWith('new-'))).toBe(true)
    // And it's a valid export.
    expect(parse(serializeExport(doc)).lists).toHaveLength(2)
  })
})

describe('parseImportFile', () => {
  it('reads every list in an export, items in rank order', () => {
    const { lists } = parse(file([list('Albums', [item('B'), item('A')]), list('Songs')]))
    expect(lists.map((l) => l.title)).toEqual(['Albums', 'Songs'])
    expect(lists[0]!.items.map((i) => i.text)).toEqual(['B', 'A'])
  })

  it('trims and normalizes the way a normal create does', () => {
    const [imported] = parse(
      file([list('  Albums  ', [item('  A  ', { note: '  ' })], { tags: [' Sci-Fi ', 'sci-fi'] })]),
    ).lists
    expect(imported!.title).toBe('Albums')
    expect(imported!.tags).toEqual(['sci-fi'])
    expect(imported!.items[0]).toMatchObject({ text: 'A', note: null })
  })

  it.each([
    ['not JSON', 'not json {', IMPORT_UNREADABLE_DETAIL],
    ['some other JSON', '{"hello": "world"}', IMPORT_UNREADABLE_DETAIL],
    [
      'a newer version',
      file([list('Albums')], { schema_version: 99 }),
      IMPORT_NEWER_VERSION_DETAIL,
    ],
    ['an export with no lists', file([]), IMPORT_EMPTY_DETAIL],
    [
      'an export with no readable lists',
      file([{ title: 'no id' }, null]),
      IMPORT_ALL_SKIPPED_DETAIL,
    ],
  ])('rejects %s', (_name, text, detail) => {
    expect(rejection(() => parse(text))).toBe(detail)
  })

  it('counts the lists and items it had to skip', () => {
    const parsed = parse(
      file([list('Albums', [item('A'), { text: 'no id' }, 'junk']), { title: 'no id' }]),
    )
    expect(parsed.lists).toHaveLength(1)
    expect(parsed.lists[0]!.items.map((i) => i.text)).toEqual(['A'])
    expect(parsed.skipped).toBe(3)
  })

  it('rejects the whole file when one list is over the item cap, saying which', () => {
    const tight = { ...DEFAULT_LIMITS, max_items_per_list: 2 }
    const text = file([list('Fine'), list('Top Albums', [item('A'), item('B'), item('C')])])
    expect(rejection(() => parse(text, tight))).toBe("'Top Albums' has 3 items; the limit is 2.")
  })

  it('names the list when a rule fails inside it', () => {
    const tight = { ...DEFAULT_LIMITS, max_item_text_length: 3 }
    expect(rejection(() => parse(file([list('Albums', [item('Too long')])]), tight))).toBe(
      "'Albums': Text must be 3 characters or fewer.",
    )
    expect(
      rejection(() =>
        parse(file([list('Albums', [], { tags: ['a', 'b', 'c'] })]), {
          ...DEFAULT_LIMITS,
          max_tags_per_list: 2,
        }),
      ),
    ).toBe("'Albums': A list can have at most 2 tags.")
  })

  it('shortens a long title in the message', () => {
    const title = 'x'.repeat(250)
    expect(rejection(() => parse(file([list(title)])))).toBe(
      `'${'x'.repeat(40)}…': Title must be 200 characters or fewer.`,
    )
  })

  it('rejects a list with the same item twice, ignoring case and spaces', () => {
    expect(rejection(() => parse(file([list('Albums', [item('Abba'), item(' ABBA ')])])))).toBe(
      "'Albums' has 'ABBA' more than once.",
    )
  })
})

describe('mergeImportedLists', () => {
  const limits = DEFAULT_LIMITS

  it('adds the lists with fresh ids, keeping what was already on the device', () => {
    const doc = emptyDocument('this-device')
    doc.lists.push(parse(file([list('Existing')])).lists[0]!)
    const incoming = parse(file([list('Albums', [item('A'), item('B')])]))

    const summary = mergeImportedLists(doc, incoming, { newId: sequentialIds(), limits })

    expect(summary).toEqual({ imported: 1, renamed: [], skipped: 0 })
    expect(doc.device_id).toBe('this-device')
    expect(doc.lists.map((l) => l.title)).toEqual(['Existing', 'Albums'])
    const added = doc.lists[1]!
    expect(added.local_id).toBe('new-1')
    expect(added.items.map((i) => i.local_id)).toEqual(['new-2', 'new-3'])
    // Timestamps come from the file.
    expect(added.updated_at).toBe('2026-10-02T00:00:00Z')
  })

  it('renames clashes with the device and within the file', () => {
    const doc = emptyDocument('this-device')
    doc.lists.push(parse(file([list('Albums')])).lists[0]!)
    const incoming = parse(file([list('ALBUMS'), list('albums', [], { local_id: 'other' })]))

    const summary = mergeImportedLists(doc, incoming, { newId: sequentialIds(), limits })

    expect(doc.lists.map((l) => l.title)).toEqual(['Albums', 'ALBUMS (2)', 'albums (3)'])
    expect(summary.renamed).toEqual([
      { from: 'ALBUMS', to: 'ALBUMS (2)' },
      { from: 'albums', to: 'albums (3)' },
    ])
  })

  it('refuses, changing nothing, an import past the lists-per-user quota', () => {
    const doc = emptyDocument('this-device')
    doc.lists.push(parse(file([list('Existing')])).lists[0]!)
    const incoming = parse(file([list('A'), list('B', [], { local_id: 'b' })]))
    const tight = { ...limits, max_lists_per_user: 2 }

    expect(() =>
      mergeImportedLists(doc, incoming, { newId: sequentialIds(), limits: tight }),
    ).toThrowError(
      'You have 1 lists, and this would add 2. The limit is 2, so delete some lists first or upload fewer.',
    )
    expect(doc.lists.map((l) => l.title)).toEqual(['Existing'])
  })

  it('can import the same backup twice without an id clash', () => {
    const doc = emptyDocument('this-device')
    const newId = sequentialIds()
    const text = file([list('Albums', [item('A')])])
    mergeImportedLists(doc, parse(text), { newId, limits })
    mergeImportedLists(doc, parse(text), { newId, limits })

    const ids = doc.lists.map((l) => l.local_id)
    expect(new Set(ids).size).toBe(2)
    expect(doc.lists.map((l) => l.title)).toEqual(['Albums', 'Albums (2)'])
  })
})

describe('importSummaryMessage', () => {
  it('counts the lists', () => {
    expect(importSummaryMessage({ imported: 1, renamed: [], skipped: 0 })).toBe('Imported 1 list.')
    expect(importSummaryMessage({ imported: 3, renamed: [], skipped: 0 })).toBe('Imported 3 lists.')
  })

  it('names a single rename, and counts several', () => {
    expect(
      importSummaryMessage({
        imported: 2,
        renamed: [{ from: 'Albums', to: 'Albums (2)' }],
        skipped: 0,
      }),
    ).toBe(
      "Imported 2 lists. 'Albums' is now 'Albums (2)', since you already had one by that name.",
    )
    expect(
      importSummaryMessage({
        imported: 2,
        renamed: [
          { from: 'A', to: 'A (2)' },
          { from: 'B', to: 'B (2)' },
        ],
        skipped: 0,
      }),
    ).toBe('Imported 2 lists. 2 were renamed, since you already had lists with those titles.')
  })

  it('says how many entries were skipped', () => {
    expect(importSummaryMessage({ imported: 1, renamed: [], skipped: 1 })).toBe(
      "Imported 1 list. 1 entry in the file couldn't be read and was skipped.",
    )
    expect(
      importSummaryMessage({ imported: 2, renamed: [{ from: 'A', to: 'A (2)' }], skipped: 4 }),
    ).toBe(
      "Imported 2 lists. 'A' is now 'A (2)', since you already had one by that name. " +
        "4 entries in the file couldn't be read and were skipped.",
    )
  })
})

describe('summarizeAccountImport', () => {
  const list = (title: string) => ({
    id: `server-${title}`,
    title,
    status: 'draft',
    tags: [],
    item_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  it('counts every list, and reports the renames the server made', () => {
    expect(
      summarizeAccountImport(
        {
          lists: [
            { local_id: 'a', outcome: 'created', list: list('A (2)'), renamed_from: 'A' },
            { local_id: 'b', outcome: 'created', list: list('B'), renamed_from: null },
            // An earlier attempt made it, and it has since been deleted.
            { local_id: 'c', outcome: 'already_imported', list: null, renamed_from: null },
          ],
        },
        1,
      ),
    ).toEqual({ imported: 3, renamed: [{ from: 'A', to: 'A (2)' }], skipped: 1 })
  })
})

describe('claimSummaryMessage', () => {
  it('says how many lists were added, and any renames', () => {
    expect(claimSummaryMessage({ imported: 1, renamed: [], skipped: 0 })).toBe(
      'Added 1 list to your account.',
    )
    expect(
      claimSummaryMessage({ imported: 3, renamed: [{ from: 'A', to: 'A (2)' }], skipped: 0 }),
    ).toBe(
      "Added 3 lists to your account. 'A' is now 'A (2)', since you already had one by that name.",
    )
  })
})

describe('tooManyListsDetail', () => {
  it("uses the server's wording", () => {
    expect(tooManyListsDetail(100)).toBe('You can upload at most 100 lists at a time.')
  })
})
