import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'
import { useClientConfigStore } from '@/stores/clientConfig'
import ClaimListsDialog from './ClaimListsDialog.vue'
import { ListError } from './listErrors'
import type { AccountImport } from './listRepository'
import { createDocumentStore, type DocumentStore } from './localListDocument'
import { createLocalListRepository } from './localListRepository'
import { memoryStorage } from './localListTestUtils'
import { setListClaimDeps } from './useListClaim'

let store: DocumentStore
let importLists: ReturnType<typeof vi.fn<AccountImport['importLists']>>
let router: Router

const stub = { template: '<div />' }

async function seed(...titles: string[]): Promise<void> {
  // A second apart, so the newest-first order is predictable.
  let clock = 0
  const now = () => new Date(Date.UTC(2026, 10, 14, 12, 0, clock++)).toISOString()
  const repo = createLocalListRepository({ store, now, requestPersistence: () => {} })
  for (const title of titles) {
    const list = await repo.createList(title)
    await repo.createItem(list.id, { text: `${title} #1`, note: null, image_url: null })
  }
}

function signIn(id = 'u-1'): void {
  useAuthStore().user = { id, display_name: 'Dev', avatar_url: null }
}

async function mountDialog() {
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ClaimListsDialog, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function button(wrapper: Awaited<ReturnType<typeof mountDialog>>, name: RegExp) {
  const found = wrapper.findAll('button').find((b) => name.test(b.text()))
  if (!found) throw new Error(`No button matching ${name}`)
  return found
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  const storage = memoryStorage()
  store = createDocumentStore({ storage: () => storage })
  importLists = vi.fn<AccountImport['importLists']>(async (upload) => ({
    lists: upload.lists.map((l) => ({
      local_id: l.local_id,
      outcome: 'created' as const,
      renamed_from: null,
      list: null,
    })),
  }))
  const session = memoryStorage()
  setListClaimDeps({ store, account: { importLists }, session: () => session })
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/lists', name: 'lists', component: stub },
    ],
  })
})

afterEach(() => setListClaimDeps(null))

describe('ClaimListsDialog', () => {
  it('stays hidden for an anonymous visitor', async () => {
    await seed('Albums')
    const wrapper = await mountDialog()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('stays hidden when a signed-in user has nothing on this device', async () => {
    signIn()
    const wrapper = await mountDialog()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it("offers the device's lists on sign-in, all checked", async () => {
    await seed('Albums', 'Songs')
    const wrapper = await mountDialog()

    signIn()
    await flushPromises()

    expect(wrapper.text()).toContain('Bring your lists with you?')
    expect(wrapper.text()).toContain('Albums')
    expect(wrapper.text()).toContain('1 item')
    const boxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(boxes.every((box) => box.element.checked)).toBe(true)
    expect(button(wrapper, /^Add 2 lists$/).exists()).toBe(true)
  })

  it('offers them on a page loaded while already signed in', async () => {
    await seed('Albums')
    signIn()
    const wrapper = await mountDialog()
    expect(wrapper.text()).toContain('Bring your lists with you?')
  })

  it('uploads only the checked lists, then goes to the lists page', async () => {
    await seed('Albums', 'Songs')
    signIn()
    const wrapper = await mountDialog()

    // Newest first: Songs, then Albums. Leave Albums behind.
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(false)
    await button(wrapper, /^Add 1 list$/).trigger('click')
    await flushPromises()

    expect(importLists).toHaveBeenCalledTimes(1)
    expect(importLists.mock.calls[0]![0].lists.map((l) => l.title)).toEqual(['Songs'])
    expect(store.load()!.lists.map((l) => l.title)).toEqual(['Albums'])
    expect(router.currentRoute.value.name).toBe('lists')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it("can't add nothing", async () => {
    await seed('Albums')
    signIn()
    const wrapper = await mountDialog()
    await wrapper.find('input[type="checkbox"]').setValue(false)

    const add = button(wrapper, /^Add lists$/)
    expect(add.attributes('disabled')).toBeDefined()
  })

  it('says so, and disables Add, when more lists are checked than one upload may carry', async () => {
    await seed('A', 'B', 'C')
    signIn()
    useClientConfigStore().limits.max_lists_per_import = 2
    const wrapper = await mountDialog()

    expect(wrapper.text()).toContain('You can add up to 2 lists at a time.')
    expect(button(wrapper, /^Add 3 lists$/).attributes('disabled')).toBeDefined()
  })

  it("shows the server's reason and stays open when a list is rejected", async () => {
    await seed('Albums')
    importLists.mockRejectedValueOnce(
      new ListError('invalid', "'Albums' has 51 items; the limit is 50."),
    )
    signIn()
    const wrapper = await mountDialog()

    await button(wrapper, /^Add 1 list$/).trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe("'Albums' has 51 items; the limit is 50.")
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('"Not now" closes it and leaves the lists on the device', async () => {
    await seed('Albums')
    signIn()
    const wrapper = await mountDialog()

    await button(wrapper, /^Not now$/).trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(importLists).not.toHaveBeenCalled()
    expect(store.load()!.lists).toHaveLength(1)
  })

  it('closes on sign-out, and asks again on the next sign-in', async () => {
    await seed('Albums')
    signIn()
    const wrapper = await mountDialog()
    await button(wrapper, /^Not now$/).trigger('click')

    useAuthStore().user = null
    await flushPromises()
    signIn()
    await flushPromises()

    expect(wrapper.text()).toContain('Bring your lists with you?')
  })
})
