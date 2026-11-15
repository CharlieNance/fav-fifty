import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useClientConfigStore } from '@/stores/clientConfig'
import { useToastStore } from '@/stores/toasts'
import { ListError } from './listErrors'
import type { AccountImport } from './listRepository'
import { createDocumentStore, type DocumentStore } from './localListDocument'
import { createLocalListRepository } from './localListRepository'
import { memoryStorage } from './localListTestUtils'
import { tooManyListsDetail } from './localListTransfer'
import type { ImportedListOutcome, ListsImportResult } from './types'
import {
  CLAIM_DISMISSED_KEY,
  CLAIM_FAILED_MESSAGE,
  setListClaimDeps,
  useListClaimStore,
} from './useListClaim'

let storage: Storage
let session: Storage
let store: DocumentStore
let importLists: ReturnType<typeof vi.fn<AccountImport['importLists']>>
let clock = 0
// Each call is a second later, so lists created in turn sort predictably.
const now = () => new Date(Date.UTC(2026, 10, 14, 12, 0, clock++)).toISOString()

function outcome(localId: string, title: string, renamedFrom: string | null = null) {
  return {
    local_id: localId,
    outcome: 'created',
    renamed_from: renamedFrom,
    list: {
      id: `server-${localId}`,
      title,
      status: 'draft',
      tags: [],
      item_count: 0,
      created_at: now(),
      updated_at: now(),
    },
  } satisfies ImportedListOutcome
}

/** The server's answer to whatever was uploaded: every list created, none renamed. */
function echo(upload: Parameters<AccountImport['importLists']>[0]): Promise<ListsImportResult> {
  return Promise.resolve({ lists: upload.lists.map((l) => outcome(l.local_id, l.title)) })
}

async function seed(...titles: string[]): Promise<string[]> {
  const repo = createLocalListRepository({ store, now, requestPersistence: () => {} })
  const ids: string[] = []
  for (const title of titles) ids.push((await repo.createList(title)).id)
  return ids
}

function deviceTitles(): string[] {
  return (store.load()?.lists ?? []).map((l) => l.title)
}

beforeEach(() => {
  setActivePinia(createPinia())
  storage = memoryStorage()
  session = memoryStorage()
  store = createDocumentStore({ storage: () => storage, now })
  importLists = vi.fn<AccountImport['importLists']>(echo)
  setListClaimDeps({ store, account: { importLists }, session: () => session, now })
})

afterEach(() => setListClaimDeps(null))

describe('offer', () => {
  it("opens with the device's lists, most recently updated first", async () => {
    await seed('Older', 'Newer')
    const claim = useListClaimStore()
    claim.offer('u-1')

    expect(claim.isOpen).toBe(true)
    expect(claim.candidates.map((l) => l.title)).toEqual(['Newer', 'Older'])
  })

  it('stays closed when the device has no lists', () => {
    const claim = useListClaimStore()
    claim.offer('u-1')
    expect(claim.isOpen).toBe(false)
  })

  it("stays closed when the device's storage can't be read", async () => {
    await seed('Albums')
    const claim = useListClaimStore()
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    claim.offer('u-1')
    expect(claim.isOpen).toBe(false)
  })
})

describe('Not now', () => {
  it("isn't asked again in this session by the same user", async () => {
    await seed('Albums')
    const claim = useListClaimStore()
    claim.offer('u-1')
    claim.dismiss('u-1')

    expect(claim.isOpen).toBe(false)
    expect(session.getItem(CLAIM_DISMISSED_KEY)).toBe('u-1')
    claim.offer('u-1')
    expect(claim.isOpen).toBe(false)

    // A different account on this device is still asked.
    claim.offer('u-2')
    expect(claim.isOpen).toBe(true)
  })

  it('is forgotten on sign-out, so the next sign-in asks again', async () => {
    await seed('Albums')
    const claim = useListClaimStore()
    claim.offer('u-1')
    claim.dismiss('u-1')
    claim.reset()

    expect(session.getItem(CLAIM_DISMISSED_KEY)).toBeNull()
    claim.offer('u-1')
    expect(claim.isOpen).toBe(true)
  })

  it('still holds for the page when sessionStorage is blocked', async () => {
    await seed('Albums')
    setListClaimDeps({
      store,
      account: { importLists },
      now,
      session: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    const claim = useListClaimStore()
    claim.offer('u-1')
    claim.dismiss('u-1')
    claim.offer('u-1')
    expect(claim.isOpen).toBe(false)
  })
})

describe('claim', () => {
  it('uploads the checked lists, then takes them off the device', async () => {
    const [albums, , films] = await seed('Albums', 'Songs', 'Films')
    const device = store.load()!
    const claim = useListClaimStore()
    claim.offer('u-1')

    expect(await claim.claim([albums!, films!], 'u-1')).toBe(true)

    expect(importLists).toHaveBeenCalledTimes(1)
    const [upload] = importLists.mock.calls[0]!
    // The device's own id, so a retry is recognized as the same upload.
    expect(upload.device_id).toBe(device.device_id)
    expect(upload.lists.map((l) => l.title)).toEqual(['Albums', 'Films'])

    // The unchecked list stays, and claimed_at records the upload.
    expect(deviceTitles()).toEqual(['Songs'])
    expect(store.load()!.claimed_at).not.toBeNull()

    expect(claim.isOpen).toBe(false)
    expect(claim.claimCount).toBe(1)
    expect(useToastStore().toasts.map((t) => t.message)).toEqual(['Added 2 lists to your account.'])
    // What's left is offered at the next sign-in, not straight away.
    claim.offer('u-1')
    expect(claim.isOpen).toBe(false)
  })

  it('says which lists were renamed', async () => {
    const [albums] = await seed('Albums')
    importLists.mockResolvedValueOnce({ lists: [outcome(albums!, 'Albums (2)', 'Albums')] })
    const claim = useListClaimStore()
    claim.offer('u-1')

    await claim.claim([albums!], 'u-1')

    expect(useToastStore().toasts[0]!.message).toBe(
      "Added 1 list to your account. 'Albums' is now 'Albums (2)', since you already had one by that name.",
    )
  })

  it("keeps the dialog open with the server's reason when it rejects a list", async () => {
    const [albums] = await seed('Albums')
    const before = storage.getItem('favfifty:v1')
    importLists.mockRejectedValueOnce(
      new ListError('invalid', "'Albums' has 51 items; the limit is 50."),
    )
    const claim = useListClaimStore()
    claim.offer('u-1')

    expect(await claim.claim([albums!], 'u-1')).toBe(false)

    expect(claim.isOpen).toBe(true)
    expect(claim.error).toBe("'Albums' has 51 items; the limit is 50.")
    expect(claim.pending).toBe(false)
    expect(storage.getItem('favfifty:v1')).toBe(before)
  })

  it('shows its own copy for a network or server failure', async () => {
    const [albums] = await seed('Albums')
    importLists.mockRejectedValueOnce(new ListError('unknown', 'Internal Server Error'))
    const claim = useListClaimStore()
    claim.offer('u-1')

    await claim.claim([albums!], 'u-1')

    expect(claim.error).toBe(CLAIM_FAILED_MESSAGE)
    expect(deviceTitles()).toEqual(['Albums'])
  })

  it('refuses more lists than one upload may carry, without sending them', async () => {
    const ids = await seed('A', 'B', 'C')
    useClientConfigStore().limits.max_lists_per_import = 2
    const claim = useListClaimStore()
    claim.offer('u-1')

    expect(await claim.claim(ids, 'u-1')).toBe(false)
    expect(importLists).not.toHaveBeenCalled()
    expect(claim.error).toBe(tooManyListsDetail(2))
  })

  it('still succeeds when the device copy cannot be cleared afterwards', async () => {
    const [albums] = await seed('Albums')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const claim = useListClaimStore()
    claim.offer('u-1')
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(await claim.claim([albums!], 'u-1')).toBe(true)
    // Still on the device: offered again next time, and the idempotent import
    // returns the same list rather than a copy.
    expect(deviceTitles()).toEqual(['Albums'])
    expect(claim.isOpen).toBe(false)
  })

  it('closes without uploading if another tab removed the lists meanwhile', async () => {
    const [albums] = await seed('Albums')
    const claim = useListClaimStore()
    claim.offer('u-1')
    storage.clear()

    expect(await claim.claim([albums!], 'u-1')).toBe(false)
    expect(importLists).not.toHaveBeenCalled()
    expect(claim.isOpen).toBe(false)
  })
})
