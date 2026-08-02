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
import CreateListModal from './CreateListModal.vue'

const apiFetchMock = vi.mocked(apiFetch)

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/lists', name: 'lists', component: stub },
      { path: '/lists/:id', name: 'list-detail', component: stub },
    ],
  })
}

async function mountModal(router: Router) {
  await router.push('/')
  await router.isReady()
  return mount(CreateListModal, { global: { plugins: [router] } })
}

const CREATED: ListSummary = {
  id: 'new-list-id',
  title: 'Best sandwiches',
  status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('CreateListModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('renders nothing when closed', async () => {
    const wrapper = await mountModal(testRouter())
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('renders the form when opened', async () => {
    const router = testRouter()
    const wrapper = await mountModal(router)
    useListModalsStore().openCreate()
    await flushPromises()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('Save with a valid title calls the API, closes the modal, and navigates to the new list', async () => {
    apiFetchMock.mockResolvedValueOnce(CREATED)
    const router = testRouter()
    const wrapper = await mountModal(router)
    const modals = useListModalsStore()
    modals.openCreate()
    await flushPromises()

    await wrapper.find('#create-list-title').setValue('Best sandwiches')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists', {
      method: 'POST',
      body: JSON.stringify({ title: 'Best sandwiches' }),
    })
    expect(modals.isCreateOpen).toBe(false)
    expect(router.currentRoute.value.name).toBe('list-detail')
    expect(router.currentRoute.value.params.id).toBe('new-list-id')
  })

  it('blocks Save client-side when the title is empty, without calling the API', async () => {
    const router = testRouter()
    const wrapper = await mountModal(router)
    const modals = useListModalsStore()
    modals.openCreate()
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(modals.isCreateOpen).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('Cancel closes the modal without calling the API or navigating', async () => {
    const router = testRouter()
    const wrapper = await mountModal(router)
    const modals = useListModalsStore()
    modals.openCreate()
    await flushPromises()

    await wrapper.find('#create-list-title').setValue('Some title')
    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    await cancelButton!.trigger('click')
    await flushPromises()

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(modals.isCreateOpen).toBe(false)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('surfaces a backend error as an inline message inside the still-open modal', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(422, 'Title is required.'))
    const wrapper = await mountModal(testRouter())
    const modals = useListModalsStore()
    modals.openCreate()
    await flushPromises()

    await wrapper.find('#create-list-title').setValue('Best sandwiches')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(modals.isCreateOpen).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
