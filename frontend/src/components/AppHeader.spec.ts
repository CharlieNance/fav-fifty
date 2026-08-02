import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import AppHeader from './AppHeader.vue'
import { useAuthStore } from '@/stores/auth'

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/login', name: 'login', component: stub },
      { path: '/lists/new', name: 'create-list', component: stub },
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
    auth.user = { id: 'u1', displayName: 'Shaggy', avatarUrl: null }

    const wrapper = mountHeader(testRouter())
    expect(wrapper.text()).toContain('Shaggy')
    expect(wrapper.text()).toContain('Log out')
    expect(wrapper.text()).not.toContain('Log in')
  })

  it('shows a "My lists" link only when logged in', () => {
    const loggedOut = mountHeader(testRouter())
    expect(loggedOut.text()).not.toContain('My lists')

    const auth = useAuthStore()
    auth.user = { id: 'u1', displayName: 'Shaggy', avatarUrl: null }
    const loggedIn = mountHeader(testRouter())
    const link = loggedIn
      .findAllComponents({ name: 'RouterLink' })
      .find((c) => c.text() === 'My lists')
    expect(link?.props('to')).toBe('/lists')
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
    expect(router.currentRoute.value.query.redirect).toBe('/lists/new')
  })
})
