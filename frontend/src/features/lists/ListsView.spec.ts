import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list-2',
    title: 'Favorite albums',
    status: 'draft',
    tags: [],
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
]

async function mountAtLists(router: Router, path = '/lists') {
  router.push(path)
  await router.isReady()
  return mount({ template: '<router-view />' }, { global: { plugins: [router] } })
}

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

  it('opens the create modal on mount when redirected here with ?openCreate=1', async () => {
    apiFetchMock.mockResolvedValueOnce([])
    const router = testRouter()

    await mountAtLists(router, '/lists?openCreate=1')
    await flushPromises()

    expect(useListModalsStore().isCreateOpen).toBe(true)
    expect(router.currentRoute.value.query.openCreate).toBeUndefined()
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
})
