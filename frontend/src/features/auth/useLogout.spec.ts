import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toasts'
import { useLogout } from './useLogout'

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/lists', name: 'lists', component: stub },
    ],
  })
}

/** useLogout needs an active component (useRouter), so drive it through one. */
async function logoutFrom(path: string) {
  const router = testRouter()
  await router.push(path)
  await router.isReady()

  const harness = {
    setup() {
      return useLogout()
    },
    template: '<button @click="logout()">Log out</button>',
  }
  const wrapper = mount(harness, { global: { plugins: [router] } })

  await wrapper.get('button').trigger('click')
  await flushPromises()

  return router
}

describe('useLogout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('clears the session, leaves the protected page, and says so', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: null }
    const logoutSpy = vi.spyOn(auth, 'logout')

    const router = await logoutFrom('/lists')

    expect(logoutSpy).toHaveBeenCalledOnce()
    expect(auth.isAuthenticated).toBe(false)
    expect(router.currentRoute.value.name).toBe('home')
    expect(useToastStore().toasts.map((t) => t.message)).toEqual(['You’ve been logged out.'])
  })

  it('still announces it when you log out from the homepage', async () => {
    // No navigation to hint that anything happened, so the toast is the whole signal.
    const auth = useAuthStore()
    auth.user = { id: 'u1', display_name: 'Shaggy', avatar_url: null }

    const router = await logoutFrom('/')

    expect(router.currentRoute.value.name).toBe('home')
    expect(useToastStore().toasts).toHaveLength(1)
  })
})
