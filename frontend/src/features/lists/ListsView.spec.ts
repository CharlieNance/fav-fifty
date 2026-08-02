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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list-2',
    title: 'Favorite albums',
    status: 'draft',
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
})
