import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import type { ListSummary } from '@/features/lists/types'
import { useAuthStore } from '@/stores/auth'
import HomeView from './HomeView.vue'

const apiFetchMock = vi.mocked(apiFetch)

const stub = { template: '<div />' }

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  tags: [],
  item_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/login', name: 'login', component: stub },
      { path: '/lists', name: 'lists', component: stub },
    ],
  })
}

function signIn(): void {
  useAuthStore().user = { id: 'u-1', displayName: 'Dev', avatarUrl: null }
}

async function mountHome() {
  const router = testRouter()
  const wrapper = mount(HomeView, { global: { plugins: [router] } })
  await router.isReady()
  await flushPromises()
  return { wrapper, router }
}

describe('HomeView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('renders the hero headline', async () => {
    const { wrapper } = await mountHome()
    expect(wrapper.text()).toContain('Stop stopping at your top 10.')
  })

  it('sends an anonymous visitor to login when they start a list', async () => {
    const { wrapper, router } = await mountHome()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/lists?openCreate=1')
  })

  it('pitches a first list to an anonymous visitor without asking the API', async () => {
    const { wrapper } = await mountHome()

    expect(wrapper.get('button').text()).toBe('Make your first list')
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('still pitches a first list to a signed-in user who has none', async () => {
    signIn()
    apiFetchMock.mockResolvedValueOnce([])

    const { wrapper } = await mountHome()

    expect(wrapper.get('button').text()).toBe('Make your first list')
  })

  it('invites a signed-in user who already has a list to start another', async () => {
    signIn()
    apiFetchMock.mockResolvedValueOnce([LIST])

    const { wrapper } = await mountHome()

    expect(wrapper.get('button').text()).toBe('Start a new list')
  })

  it('falls back to the neutral wording when the lists fetch fails', async () => {
    // Better to under-promise than to tell someone with fifty lists it's their first.
    signIn()
    apiFetchMock.mockRejectedValueOnce(new Error('offline'))

    const { wrapper } = await mountHome()

    expect(wrapper.get('button').text()).toBe('Start a new list')
  })
})
