import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'
import { createDocumentStore, type DocumentStore, STORAGE_KEY } from './localListDocument'
import { createLocalListRepository } from './localListRepository'
import { memoryStorage } from './localListTestUtils'
import {
  isSnoozed,
  REMINDER_DISMISSED_KEY,
  REMINDER_SNOOZE_MS,
  useBackupReminder,
  worthReminding,
} from './useBackupReminder'

describe('worthReminding', () => {
  it.each([
    [{ lists: 0, items: 0 }, false],
    [{ lists: 1, items: 19 }, false],
    [{ lists: 2, items: 0 }, true],
    [{ lists: 1, items: 20 }, true],
  ])('%o → %s', (totals, expected) => {
    expect(worthReminding(totals)).toBe(expected)
  })
})

describe('isSnoozed', () => {
  const now = Date.parse('2026-11-14T12:00:00Z')

  it('holds for 14 days after a dismissal', () => {
    expect(isSnoozed(new Date(now - REMINDER_SNOOZE_MS + 1).toISOString(), now)).toBe(true)
    expect(isSnoozed(new Date(now - REMINDER_SNOOZE_MS).toISOString(), now)).toBe(false)
  })

  it.each([null, 'garbled', '2027-01-01T00:00:00Z'])("doesn't hold for %s", (value) => {
    expect(isSnoozed(value, now)).toBe(false)
  })
})

describe('useBackupReminder', () => {
  let storage: Storage
  let prefs: Storage
  let store: DocumentStore
  let time: number

  function host() {
    let reminder!: ReturnType<typeof useBackupReminder>
    mount(
      defineComponent({
        setup() {
          reminder = useBackupReminder({ store, storage: () => prefs, now: () => time })
          return () => h('div')
        },
      }),
    )
    return reminder
  }

  async function seed(lists: number, itemsInFirst = 0) {
    const repo = createLocalListRepository({ store, requestPersistence: () => {} })
    for (let n = 0; n < lists; n++) {
      const list = await repo.createList(`List ${n}`)
      if (n === 0) {
        for (let i = 0; i < itemsInFirst; i++) {
          await repo.createItem(list.id, { text: `Item ${i}`, note: null, image_url: null })
        }
      }
    }
  }

  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    storage = memoryStorage()
    prefs = memoryStorage()
    store = createDocumentStore({ storage: () => storage })
    time = Date.parse('2026-11-14T12:00:00Z')
  })

  it('stays hidden with one short list', async () => {
    await seed(1, 3)
    expect(host().visible.value).toBe(false)
  })

  it('shows at two lists', async () => {
    await seed(2)
    const reminder = host()
    await flushPromises()
    expect(reminder.visible.value).toBe(true)
    expect(reminder.totals.value).toEqual({ lists: 2, items: 0 })
  })

  it('shows at twenty items in one list', async () => {
    await seed(1, 20)
    const reminder = host()
    await flushPromises()
    expect(reminder.visible.value).toBe(true)
  })

  it('appears as soon as this tab saves the list that crosses the line', async () => {
    await seed(1)
    const reminder = host()
    await flushPromises()
    expect(reminder.visible.value).toBe(false)

    await createLocalListRepository({ store, requestPersistence: () => {} }).createList('Second')
    await flushPromises()
    expect(reminder.visible.value).toBe(true)
  })

  it("follows another tab's changes", async () => {
    const reminder = host()
    await flushPromises()

    // Another tab writes storage directly; this tab only hears the event.
    const list = (id: string) => ({
      local_id: id,
      title: id,
      tags: [],
      created_at: '2026-11-14T12:00:00Z',
      updated_at: '2026-11-14T12:00:00Z',
      items: [],
    })
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        device_id: 'd',
        claimed_at: null,
        lists: [list('a'), list('b')],
      }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    await flushPromises()
    expect(reminder.visible.value).toBe(true)
  })

  it('never shows to a signed-in user', async () => {
    await seed(3)
    useAuthStore().user = { id: 'u-1', display_name: 'Dev', avatar_url: null }
    const reminder = host()
    await flushPromises()
    expect(reminder.visible.value).toBe(false)
  })

  it('dismissing hides it for 14 days, then it comes back', async () => {
    await seed(2)
    const reminder = host()
    await flushPromises()

    reminder.dismiss()
    expect(reminder.visible.value).toBe(false)
    expect(prefs.getItem(REMINDER_DISMISSED_KEY)).toBe('2026-11-14T12:00:00.000Z')

    // A new page load still remembers it…
    expect(host().visible.value).toBe(false)

    // …until the snooze runs out.
    time += REMINDER_SNOOZE_MS
    const later = host()
    await flushPromises()
    expect(later.visible.value).toBe(true)
  })

  it('still dismisses for the page when localStorage is blocked', async () => {
    await seed(2)
    const blocked = memoryStorage()
    vi.spyOn(blocked, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    prefs = blocked
    const reminder = host()
    await flushPromises()

    reminder.dismiss()
    expect(reminder.visible.value).toBe(false)
  })
})
