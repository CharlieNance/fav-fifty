import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import { ApiError } from '@/api/client'
import type { ListSummary } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import ListDetailView from './ListDetailView.vue'

const apiFetchMock = vi.mocked(apiFetch)

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/lists', name: 'lists', component: stub },
      { path: '/lists/:id', name: 'list-detail', component: ListDetailView },
    ],
  })
}

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

async function mountAtDetail(router: Router, id = 'list-1') {
  router.push(`/lists/${id}`)
  await router.isReady()
  return mount({ template: '<router-view />' }, { global: { plugins: [router] } })
}

describe('ListDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('shows a loading state while the request is in flight', async () => {
    let resolveFetch: (value: ListSummary) => void = () => {}
    apiFetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const wrapper = await mountAtDetail(testRouter())

    expect(wrapper.text()).toContain('Loading')
    resolveFetch(LIST)
    await flushPromises()
  })

  it('renders the fetched title and an empty-items message', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)

    const wrapper = await mountAtDetail(testRouter())
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1')
    expect(wrapper.text()).toContain('Best sandwiches')
    expect(wrapper.text()).toContain('Items are coming soon')
  })

  it('renders a not-found state on 404', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))

    const wrapper = await mountAtDetail(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain("doesn't exist")
  })

  it('renders an error state on other failures', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))

    const wrapper = await mountAtDetail(testRouter())
    await flushPromises()

    expect(wrapper.text()).toContain('Something went wrong loading this list')
  })

  it('Edit opens EditListModal without navigating', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)
    const router = testRouter()

    const wrapper = await mountAtDetail(router)
    await flushPromises()

    const editButton = wrapper.findAll('button').find((b) => b.text() === 'Edit')
    await editButton!.trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(router.currentRoute.value.name).toBe('list-detail')
  })

  it('Save in EditListModal updates the shown title, no navigation', async () => {
    apiFetchMock.mockResolvedValueOnce({ ...LIST })
    const router = testRouter()

    const wrapper = await mountAtDetail(router)
    await flushPromises()

    const editButton = wrapper.findAll('button').find((b) => b.text() === 'Edit')
    await editButton!.trigger('click')

    const updated = { ...LIST, title: 'Favorite sandwiches' }
    apiFetchMock.mockResolvedValueOnce(updated)
    await wrapper.find('#edit-list-title').setValue('Favorite sandwiches')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Favorite sandwiches')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('list-detail')
  })

  it('Delete opens ConfirmDialog without calling the API or navigating', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)
    const router = testRouter()

    const wrapper = await mountAtDetail(router)
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((b) => b.text() === 'Delete')
    await deleteButton!.trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("Delete 'Best sandwiches'?")
    expect(apiFetchMock).toHaveBeenCalledTimes(1) // only the initial load — not DELETE yet
    expect(router.currentRoute.value.name).toBe('list-detail')
  })

  it('confirming delete calls DELETE and redirects to /lists', async () => {
    apiFetchMock.mockResolvedValueOnce({ ...LIST })
    const router = testRouter()

    const wrapper = await mountAtDetail(router)
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((b) => b.text() === 'Delete')
    await deleteButton!.trigger('click')

    apiFetchMock.mockResolvedValueOnce(undefined)
    // The page's own Delete button and the dialog's confirm button share the
    // label "Delete" — scope the query to the dialog to get the right one.
    const dialog = wrapper.get('[role="dialog"]')
    const confirmButton = dialog.findAll('button').find((b) => b.text() === 'Delete')
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1', { method: 'DELETE' })
    expect(router.currentRoute.value.name).toBe('lists')
  })

  it('cancelling delete closes the dialog without calling the API and stays on the page', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)
    const router = testRouter()

    const wrapper = await mountAtDetail(router)
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((b) => b.text() === 'Delete')
    await deleteButton!.trigger('click')

    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    await cancelButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledTimes(1) // only the initial load
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('list-detail')
  })
})
