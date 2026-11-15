import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useClientConfigStore } from '@/stores/clientConfig'
import { useToastStore } from '@/stores/toasts'
import { ListError } from './listErrors'
import {
  createDocumentStore,
  type DocumentStore,
  type LocalList,
  STORAGE_FULL_DETAIL,
  STORAGE_KEY,
} from './localListDocument'
import type { AccountImport, ListRepository } from './listRepository'
import { createLocalListRepository } from './localListRepository'
import { memoryStorage } from './localListTestUtils'
import {
  IMPORT_TOO_LARGE_DETAIL,
  MAX_IMPORT_FILE_BYTES,
  tooManyListsDetail,
} from './localListTransfer'
import { EXPORT_EMPTY_MESSAGE, EXPORT_FAILED_MESSAGE, useListTransfer } from './useListTransfer'

let storage: Storage
let store: DocumentStore
let saveFile: ReturnType<typeof vi.fn<(fileName: string, contents: string) => void>>
const now = () => '2026-11-14T12:00:00.000Z'

/** The device's lists, as the anonymous visitor's repository sees them. */
function deviceRepository(): ListRepository {
  return createLocalListRepository({ store, now, requestPersistence: () => {} })
}

function transfer(repository: () => ListRepository = deviceRepository) {
  let id = 0
  return useListTransfer({ repository, store, now, newId: () => `new-${++id}`, saveFile })
}

/** The contents of the one file `saveFile` was given. */
function savedContents(): string {
  expect(saveFile).toHaveBeenCalledTimes(1)
  return saveFile.mock.calls[0]![1]
}

function jsonFile(contents: string, name = 'lists.json'): File {
  return new File([contents], name, { type: 'application/json' })
}

function toasts() {
  return useToastStore().toasts.map(({ message, variant }) => ({ message, variant }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  storage = memoryStorage()
  store = createDocumentStore({ storage: () => storage, now })
  saveFile = vi.fn()
  // No real persistence prompt from the tests.
  vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(true) } })
  return () => vi.unstubAllGlobals()
})

async function seed(...titles: string[]) {
  const repo = deviceRepository()
  for (const title of titles) {
    const created = await repo.createList(title)
    await repo.createItem(created.id, { text: `${title} #1`, note: null, image_url: null })
  }
}

describe('exportLists', () => {
  it("saves the device's lists as a dated .json file", async () => {
    await seed('Albums')
    await transfer().exportLists()

    const [fileName] = saveFile.mock.calls[0]!
    expect(fileName).toBe('fav-fifty-lists-2026-11-14.json')
    const exported = JSON.parse(savedContents())
    expect(exported.lists.map((l: { title: string }) => l.title)).toEqual(['Albums'])
    expect(exported.lists[0].items[0].text).toBe('Albums #1')
  })

  it("exports a signed-in user's lists from whatever repository is active", async () => {
    const account: ListRepository = {
      ...deviceRepository(),
      getLists: vi.fn().mockResolvedValue([
        {
          id: 'server-list-id',
          title: 'From my account',
          status: 'draft',
          tags: ['music'],
          item_count: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
      ]),
      getItems: vi.fn().mockResolvedValue([
        {
          id: 'server-item-id',
          list_id: 'server-list-id',
          position: 1,
          text: 'Alpha',
          note: null,
          image_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]),
    }
    await transfer(() => account).exportLists()

    const contents = savedContents()
    expect(account.getItems).toHaveBeenCalledWith('server-list-id')
    expect(JSON.parse(contents).lists[0]).toMatchObject({
      title: 'From my account',
      tags: ['music'],
      items: [{ text: 'Alpha' }],
    })
    // The account's server ids stay out of a file that may be sent to a friend.
    expect(contents).not.toContain('server-')
  })

  it('says so instead of saving an empty file', async () => {
    await transfer().exportLists()
    expect(saveFile).not.toHaveBeenCalled()
    expect(toasts()).toEqual([{ message: EXPORT_EMPTY_MESSAGE, variant: 'warning' }])
  })

  it("shows an error when the lists can't be read", async () => {
    const broken: ListRepository = {
      ...deviceRepository(),
      getLists: vi.fn().mockRejectedValue(new Error('offline')),
    }
    const { exporting, exportLists } = transfer(() => broken)
    const done = exportLists()
    expect(exporting.value).toBe(true)
    await done

    expect(exporting.value).toBe(false)
    expect(saveFile).not.toHaveBeenCalled()
    expect(toasts()).toEqual([{ message: EXPORT_FAILED_MESSAGE, variant: 'error' }])
  })
})

describe('importFile', () => {
  it('round-trips an export into another browser', async () => {
    await seed('Albums', 'Songs')
    await transfer().exportLists()
    const exported = savedContents()

    storage = memoryStorage() // a different browser
    const { importFile } = transfer()
    expect(await importFile(jsonFile(exported))).toBe(true)

    const repo = deviceRepository()
    const lists = await repo.getLists()
    expect(lists.map((l) => l.title).sort()).toEqual(['Albums', 'Songs'])
    expect((await repo.getItems(lists[0]!.id)).map((i) => i.text)).toHaveLength(1)
    expect(toasts()).toEqual([{ message: 'Imported 2 lists.', variant: 'success' }])
    expect(navigator.storage.persist).toHaveBeenCalled()
  })

  it('adds to the lists already here, renaming a clash', async () => {
    await seed('Albums')
    await transfer().exportLists()

    expect(await transfer().importFile(jsonFile(saveFile.mock.calls[0]![1]))).toBe(true)

    const titles = (await deviceRepository().getLists()).map((l) => l.title)
    expect(titles.sort()).toEqual(['Albums', 'Albums (2)'])
    expect(toasts()[0]!.message).toContain("'Albums' is now 'Albums (2)'")
  })

  it('writes nothing and explains why when a list breaks a rule', async () => {
    await seed('Albums', 'Songs')
    await transfer().exportLists()
    const exported = saveFile.mock.calls[0]![1]
    const before = storage.getItem(STORAGE_KEY)

    useClientConfigStore().limits.max_title_length = 5
    expect(await transfer().importFile(jsonFile(exported))).toBe(false)

    expect(storage.getItem(STORAGE_KEY)).toBe(before)
    expect(toasts()).toEqual([
      { message: expect.stringContaining('Title must be 5 characters'), variant: 'error' },
    ])
  })

  it('rejects a file too large to be an export without reading it', async () => {
    const big = jsonFile('x')
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_FILE_BYTES + 1 })
    const read = vi.spyOn(big, 'text')

    expect(await transfer().importFile(big)).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(toasts()).toEqual([{ message: IMPORT_TOO_LARGE_DETAIL, variant: 'error' }])
  })

  it("shows the storage error when the device can't save the import", async () => {
    await seed('Albums')
    await transfer().exportLists()
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(await transfer().importFile(jsonFile(saveFile.mock.calls[0]![1]))).toBe(false)
    expect(toasts()).toEqual([{ message: STORAGE_FULL_DETAIL, variant: 'error' }])
  })
})

describe('importFile with damaged entries', () => {
  it('imports what it can and warns about what it skipped', async () => {
    await seed('Albums')
    await transfer().exportLists()
    const exported = JSON.parse(savedContents())
    exported.lists[0].items.push({ text: 'no id' })
    exported.lists.push({ title: 'no id either' })

    storage = memoryStorage()
    expect(await transfer().importFile(jsonFile(JSON.stringify(exported)))).toBe(true)

    expect((await deviceRepository().getLists()).map((l) => l.title)).toEqual(['Albums'])
    expect(toasts()).toEqual([
      {
        message: "Imported 1 list. 2 entries in the file couldn't be read and were skipped.",
        variant: 'warning',
      },
    ])
  })
})

describe('importFile while signed in', () => {
  function accountTransfer(importLists: AccountImport['importLists']) {
    let id = 0
    return useListTransfer({
      repository: deviceRepository,
      store,
      now,
      newId: () => `upload-${++id}`,
      saveFile,
      isSignedIn: () => true,
      account: { importLists },
    })
  }

  function created(localId: string, title: string, renamedFrom: string | null = null) {
    return {
      local_id: localId,
      outcome: 'created' as const,
      renamed_from: renamedFrom,
      list: {
        id: `server-${localId}`,
        title,
        status: 'draft',
        tags: [],
        item_count: 1,
        created_at: now(),
        updated_at: now(),
      },
    }
  }

  it('uploads the whole file to the account in one request, not to the device', async () => {
    await seed('Albums', 'Songs')
    await transfer().exportLists()
    const exported = JSON.parse(savedContents())
    storage = memoryStorage()
    store = createDocumentStore({ storage: () => storage, now })

    const importLists = vi.fn<AccountImport['importLists']>().mockResolvedValue({
      lists: [created('a', 'Albums (2)', 'Albums'), created('b', 'Songs')],
    })
    expect(await accountTransfer(importLists).importFile(jsonFile(savedContents()))).toBe(true)

    expect(importLists).toHaveBeenCalledTimes(1)
    const [upload] = importLists.mock.calls[0]!
    // A fresh id, not the file's, so the file's lists are keyed apart from any
    // earlier import of the same file.
    expect(upload.device_id).toMatch(/^upload-/)
    expect(upload.device_id).not.toBe(exported.device_id)
    expect(upload.lists.map((l) => l.title)).toEqual(exported.lists.map((l: LocalList) => l.title))
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(toasts()).toEqual([
      {
        message: expect.stringContaining("Imported 2 lists. 'Albums' is now 'Albums (2)'"),
        variant: 'success',
      },
    ])
  })

  it("shows the server's reason when it rejects the file", async () => {
    await seed('Albums')
    await transfer().exportLists()
    const importLists = vi
      .fn<AccountImport['importLists']>()
      .mockRejectedValue(new ListError('invalid', "'Albums' has 51 items; the limit is 50."))

    expect(await accountTransfer(importLists).importFile(jsonFile(savedContents()))).toBe(false)
    expect(toasts()).toEqual([
      { message: "'Albums' has 51 items; the limit is 50.", variant: 'error' },
    ])
  })

  it('refuses a file with more lists than one upload may carry, without sending it', async () => {
    await seed('A', 'B', 'C')
    await transfer().exportLists()
    useClientConfigStore().limits.max_lists_per_import = 2
    const importLists = vi.fn<AccountImport['importLists']>()

    expect(await accountTransfer(importLists).importFile(jsonFile(savedContents()))).toBe(false)
    expect(importLists).not.toHaveBeenCalled()
    expect(toasts()).toEqual([{ message: tooManyListsDetail(2), variant: 'error' }])
  })
})
