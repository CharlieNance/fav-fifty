import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import { ApiError } from '@/api/client'
import type { ListSummary } from './types'
import { useListModalsStore } from './useListModals'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import ListsView from './ListsView.vue'
import TagChip from './TagChip.vue'
import { useAuthStore } from '@/stores/auth'
import { ListError } from './listErrors'
import { apiListRepository, type ListRepository } from './listRepository'
import { STORAGE_KEY } from './localListDocument'
import { pinApiRepository } from './repositoryTestUtils'
import { setListRepository } from './useListRepository'

const apiFetchMock = vi.mocked(apiFetch)

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/lists', name: 'lists', component: ListsView },
      { path: '/lists/:id', name: 'list-detail', component: stub },
    ],
  })
}

const LISTS: ListSummary[] = [
  {
    id: 'list-1',
    title: 'Best sandwiches',
    status: 'draft',
    tags: [],
    item_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list-2',
    title: 'Favorite albums',
    status: 'draft',
    tags: [],
    item_count: 0,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
]

async function mountAtLists(router: Router, path = '/lists') {
  router.push(path)
  await router.isReady()
  return mount({ template: '<router-view />' }, { global: { plugins: [router] } })
}

pinApiRepository()
// Unmount each test's page, so its storage listener doesn't outlive the test.
enableAutoUnmount(afterEach)

describe('ListsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('shows a loading state while the request is in flight', async () => {
    let resolveFetch: (value: ListSummary[]) => void = () => {}
    apiFetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const wrapper = await mountAtLists(testRouter())

    expect(wrapper.text()).toContain('Loading your lists')
    resolveFetch([])
    await flushPromises()
  })

  it('renders each list as a row linking to its details page', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS)

    const wrapper = await mountAtLists(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain('Best sandwiches')
    expect(wrapper.text()).toContain('Favorite albums')

    const links = wrapper.findAllComponents({ name: 'RouterLink' })
    const detailLink = links.find((link) => link.text() === 'Best sandwiches')
    expect(detailLink?.props('to')).toEqual({ name: 'list-detail', params: { id: 'list-1' } })
  })

  it("renders a row's tags as read-only chips", async () => {
    apiFetchMock.mockResolvedValueOnce([{ ...LISTS[0]!, tags: ['deli', 'classics'] }, LISTS[1]!])

    const wrapper = await mountAtLists(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain('deli')
    expect(wrapper.text()).toContain('classics')
  })

  it('renders no chips for a row with no tags', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS)

    const wrapper = await mountAtLists(testRouter())
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('Best sandwiches'))
    expect(row?.findAllComponents(TagChip)).toHaveLength(0)
  })

  it('renders an empty state with a call to action when there are no lists', async () => {
    apiFetchMock.mockResolvedValueOnce([])

    const wrapper = await mountAtLists(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain("You haven't started a list yet")
  })

  it('renders an error state when the request fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))

    const wrapper = await mountAtLists(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain('Something went wrong loading your lists')
  })

  it('"New list" opens the create modal without navigating', async () => {
    apiFetchMock.mockResolvedValueOnce([])
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const newListButton = wrapper.findAll('button').find((b) => b.text() === 'New list')
    await newListButton!.trigger('click')

    expect(useListModalsStore().isCreateOpen).toBe(true)
    expect(router.currentRoute.value.name).toBe('lists')
  })

  it('the edit icon opens EditListModal for that row without navigating', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS)
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const editButton = wrapper.find('button[aria-label="Rename Best sandwiches"]')
    await editButton.trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(router.currentRoute.value.name).toBe('lists')
  })

  it('Save in EditListModal updates the row title in place, no navigation', async () => {
    // Clone LISTS — useLists() assigns apiFetch's resolved array by reference, and
    // updateList() below mutates that array in place; sharing LISTS itself here
    // would leak "Favorite sandwiches" into every other test in this file.
    apiFetchMock.mockResolvedValueOnce(LISTS.map((list) => ({ ...list })))
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const editButton = wrapper.find('button[aria-label="Rename Best sandwiches"]')
    await editButton.trigger('click')

    const updated = { ...LISTS[0]!, title: 'Favorite sandwiches' }
    apiFetchMock.mockResolvedValueOnce(updated)
    await wrapper.find('#edit-list-title').setValue('Favorite sandwiches')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Favorite sandwiches')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('lists')
  })

  it('Cancel in EditListModal closes it and leaves the title unchanged', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS)
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const editButton = wrapper.find('button[aria-label="Rename Best sandwiches"]')
    await editButton.trigger('click')
    await wrapper.find('#edit-list-title').setValue('Something else')

    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    await cancelButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledTimes(1) // only the initial load
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Best sandwiches')
  })

  it('the delete icon opens ConfirmDialog for that row without calling the API or navigating', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS)
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const deleteButton = wrapper.find('button[aria-label="Delete Best sandwiches"]')
    await deleteButton.trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("Delete 'Best sandwiches'?")
    expect(apiFetchMock).toHaveBeenCalledTimes(1) // only the initial load — not DELETE yet
    expect(router.currentRoute.value.name).toBe('lists')
  })

  it('confirming delete calls DELETE and removes the row from the index', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS.map((list) => ({ ...list })))
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const deleteButton = wrapper.find('button[aria-label="Delete Best sandwiches"]')
    await deleteButton.trigger('click')

    apiFetchMock.mockResolvedValueOnce(undefined)
    const confirmButton = wrapper.findAll('button').find((b) => b.text() === 'Delete')
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1', { method: 'DELETE' })
    expect(wrapper.text()).not.toContain('Best sandwiches')
    expect(wrapper.text()).toContain('Favorite albums')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('lists')
  })

  it('cancelling delete closes the dialog without calling the API, row stays', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS)
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const deleteButton = wrapper.find('button[aria-label="Delete Best sandwiches"]')
    await deleteButton.trigger('click')

    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    await cancelButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledTimes(1) // only the initial load
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Best sandwiches')
  })

  it('a failed delete surfaces an inline error and keeps the row', async () => {
    apiFetchMock.mockResolvedValueOnce(LISTS)
    const router = testRouter()

    const wrapper = await mountAtLists(router)
    await flushPromises()

    const deleteButton = wrapper.find('button[aria-label="Delete Best sandwiches"]')
    await deleteButton.trigger('click')

    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const confirmButton = wrapper.findAll('button').find((b) => b.text() === 'Delete')
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Best sandwiches')
  })

  describe('search', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('typing in the search box does not call apiFetch on every keystroke', async () => {
      apiFetchMock.mockResolvedValueOnce(LISTS)
      const router = testRouter()

      const wrapper = await mountAtLists(router)
      await flushPromises()
      apiFetchMock.mockResolvedValueOnce(LISTS)

      const input = wrapper.find('#list-search')
      await input.setValue('sand')
      await input.setValue('sandw')
      await input.setValue('sandwi')

      expect(apiFetchMock).toHaveBeenCalledTimes(1) // only the initial load so far

      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      expect(apiFetchMock).toHaveBeenCalledTimes(2)
      expect(apiFetchMock).toHaveBeenLastCalledWith('/lists?q=sandwi')
    })

    it('filters rows to what the debounced search returns', async () => {
      apiFetchMock.mockResolvedValueOnce(LISTS)
      const router = testRouter()

      const wrapper = await mountAtLists(router)
      await flushPromises()

      apiFetchMock.mockResolvedValueOnce([LISTS[0]!])
      await wrapper.find('#list-search').setValue('sandwiches')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      expect(wrapper.text()).toContain('Best sandwiches')
      expect(wrapper.text()).not.toContain('Favorite albums')
      // Announced too: rows changing alone says nothing to a screen reader.
      expect(wrapper.get('[role="status"][aria-live="polite"]').text()).toBe('1 list matches.')
    })

    it('shows a distinct "no matches" empty state, not the "no lists yet" one', async () => {
      apiFetchMock.mockResolvedValueOnce(LISTS)
      const router = testRouter()

      const wrapper = await mountAtLists(router)
      await flushPromises()

      apiFetchMock.mockResolvedValueOnce([])
      await wrapper.find('#list-search').setValue('nothing matches this')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      expect(wrapper.text()).toContain('No lists match')
      expect(wrapper.text()).not.toContain("You haven't started a list yet")
    })

    it('clearing the box restores the full list immediately, without waiting for the debounce', async () => {
      apiFetchMock.mockResolvedValueOnce(LISTS)
      const router = testRouter()

      const wrapper = await mountAtLists(router)
      await flushPromises()

      apiFetchMock.mockResolvedValueOnce([LISTS[0]!])
      await wrapper.find('#list-search').setValue('sandwiches')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      apiFetchMock.mockResolvedValueOnce(LISTS)
      const clearButton = wrapper.find('button[aria-label="Clear search"]')
      await clearButton.trigger('click')
      await flushPromises()

      expect(apiFetchMock).toHaveBeenLastCalledWith('/lists')
      expect(wrapper.text()).toContain('Favorite albums')
    })
  })
})

describe('ListsView for anonymous visitors and storage changes', () => {
  let getLists: ReturnType<typeof vi.fn<ListRepository['getLists']>>

  beforeEach(() => {
    setActivePinia(createPinia())
    getLists = vi.fn<ListRepository['getLists']>().mockResolvedValue(LISTS)
    setListRepository({ ...apiListRepository, getLists })
  })

  const signIn = () => {
    useAuthStore().user = { id: 'u-1', display_name: 'Dev', avatar_url: null }
  }

  it('tells an anonymous visitor their lists are saved on this device only', async () => {
    const wrapper = await mountAtLists(testRouter())
    await flushPromises()
    expect(wrapper.text()).toContain('Saved on this device only')
  })

  it('offers an anonymous visitor sign-in or a free account to keep their lists', async () => {
    const wrapper = await mountAtLists(testRouter())
    await flushPromises()
    expect(wrapper.text()).toContain('Sign in or create a FREE account to keep them safe')
    const href = (text: string) =>
      wrapper
        .findAll('a')
        .find((a) => a.text() === text)
        ?.attributes('href')
    expect(href('Sign in')).toBe('/login')
    expect(href('create a FREE account')).toBe('/signup')
  })

  it("doesn't show the device note to a signed-in user", async () => {
    signIn()
    const wrapper = await mountAtLists(testRouter())
    await flushPromises()
    expect(wrapper.text()).not.toContain('Saved on this device only')
    expect(wrapper.text()).not.toContain('create a FREE account')
  })

  it("shows why the device can't load lists when storage is blocked", async () => {
    getLists.mockRejectedValueOnce(new ListError('storage', 'Your browser isn’t letting us save.'))
    const wrapper = await mountAtLists(testRouter())
    await flushPromises()
    expect(wrapper.text()).toContain('Your browser isn’t letting us save.')
    expect(wrapper.text()).not.toContain('Something went wrong')
  })

  it('reloads from the new storage when the visitor signs in', async () => {
    await mountAtLists(testRouter())
    await flushPromises()
    expect(getLists).toHaveBeenCalledTimes(1)

    signIn()
    await flushPromises()

    expect(getLists).toHaveBeenCalledTimes(2)
  })

  it("reloads when another tab changes this device's lists", async () => {
    await mountAtLists(testRouter())
    await flushPromises()

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    await flushPromises()
    expect(getLists).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    await flushPromises()
    expect(getLists).toHaveBeenCalledTimes(2)
  })

  it('offers Export and Import to everyone', async () => {
    const wrapper = await mountAtLists(testRouter())
    await flushPromises()
    const labels = () => wrapper.findAll('button').map((b) => b.text())
    expect(labels()).toEqual(expect.arrayContaining(['Export', 'Import']))

    // Signed in, an import goes to the account through POST /lists/import.
    signIn()
    await flushPromises()
    expect(labels()).toEqual(expect.arrayContaining(['Export', 'Import']))
    expect(wrapper.find('[data-testid="import-file"]').exists()).toBe(true)
  })

  it('reloads the lists after importing a file', async () => {
    window.localStorage.clear()
    const exported = JSON.stringify({
      schema_version: 1,
      device_id: 'other-device',
      claimed_at: null,
      lists: [
        {
          local_id: 'l-1',
          title: 'Imported',
          tags: [],
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
          items: [],
        },
      ],
    })
    const wrapper = await mountAtLists(testRouter())
    await flushPromises()
    expect(getLists).toHaveBeenCalledTimes(1)

    const input = wrapper.get('[data-testid="import-file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File([exported], 'lists.json', { type: 'application/json' })],
    })
    await input.trigger('change')
    await flushPromises()

    expect(getLists).toHaveBeenCalledTimes(2)
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('Imported')
    window.localStorage.clear()
  })

  it("ignores another tab's device changes while signed in", async () => {
    signIn()
    await mountAtLists(testRouter())
    await flushPromises()

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    await flushPromises()

    expect(getLists).toHaveBeenCalledTimes(1)
  })
})
