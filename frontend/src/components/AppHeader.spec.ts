import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import AppHeader from './AppHeader.vue'
import { useAuthStore } from '@/stores/auth'
import { useListModalsStore } from '@/features/lists/useListModals'
import { useToastStore } from '@/stores/toasts'

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/login', name: 'login', component: stub },
      { path: '/lists', name: 'lists', component: stub },
    ],
  })
}

function mountHeader(router: Router) {
  return mount(AppHeader, { global: { plugins: [router] } })
}

describe('AppHeader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows "Log in" and hides "Log out" when logged out', () => {
    const wrapper = mountHeader(testRouter())
    expect(wrapper.text()).toContain('Log in')
    expect(wrapper.text()).not.toContain('Log out')
    expect(wrapper.text()).toContain('Start a list')
  })

  it('shows the user and "Log out" when logged in', () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: null }

    const wrapper = mountHeader(testRouter())
    expect(wrapper.text()).toContain('Shaggy')
    expect(wrapper.text()).toContain('Log out')
    expect(wrapper.text()).not.toContain('Log in')
  })

  it('shows the avatar image when the user has one', () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: 'https://example.com/s.png' }

    const img = mountHeader(testRouter()).find('img')
    expect(img.attributes('src')).toBe('https://example.com/s.png')
    expect(img.attributes('alt')).toBe('Shaggy')
    expect(img.attributes('referrerpolicy')).toBe('no-referrer')
  })

  it('shows the initial when there is no avatar', () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'shaggy', avatar_url: null }

    const wrapper = mountHeader(testRouter())
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('span[aria-hidden="true"]').text()).toBe('S')
  })

  it('falls back to the initial when the avatar fails to load', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: 'https://example.com/s.png' }

    const wrapper = mountHeader(testRouter())
    await wrapper.find('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('span[aria-hidden="true"]').text()).toBe('S')
  })

  it('shows a "My lists" link only when logged in', () => {
    const loggedOut = mountHeader(testRouter())
    expect(loggedOut.text()).not.toContain('My lists')

    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: null }
    const loggedIn = mountHeader(testRouter())
    const link = loggedIn
      .findAllComponents({ name: 'RouterLink' })
      .find((c) => c.text() === 'My lists')
    expect(link?.props('to')).toBe('/lists')
  })

  it('"Log out" sends you home and announces it', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: null }
    const router = testRouter()
    await router.push('/lists')
    const wrapper = mountHeader(router)
    await router.isReady()

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Log out'))!
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    expect(wrapper.text()).toContain('Log in')
    expect(useToastStore().toasts).toHaveLength(1)
  })

  it('"Start a list" routes an anonymous user to login, preserving intent', async () => {
    const router = testRouter()
    const wrapper = mountHeader(router)
    await router.isReady()

    const startButton = wrapper.findAll('button').find((b) => b.text().includes('Start a list'))
    expect(startButton).toBeDefined()
    await startButton!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/lists?openCreate=1')
  })

  it('"Start a list" opens the create modal for a logged-in user, without navigating', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: null }
    const router = testRouter()
    const wrapper = mountHeader(router)
    await router.isReady()

    const startButton = wrapper.findAll('button').find((b) => b.text().includes('Start a list'))
    await startButton!.trigger('click')
    await flushPromises()

    expect(useListModalsStore().isCreateOpen).toBe(true)
    expect(router.currentRoute.value.name).not.toBe('login')
  })
})
