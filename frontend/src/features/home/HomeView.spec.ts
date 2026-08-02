import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import HomeView from './HomeView.vue'

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/login', name: 'login', component: stub },
    ],
  })
}

describe('HomeView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the hero headline', () => {
    const wrapper = mount(HomeView, { global: { plugins: [testRouter()] } })
    expect(wrapper.text()).toContain('Stop stopping at your top 10.')
  })

  it('sends an anonymous visitor to login when they start a list', async () => {
    const router = testRouter()
    const wrapper = mount(HomeView, { global: { plugins: [router] } })
    await router.isReady()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/lists?openCreate=1')
  })
})
