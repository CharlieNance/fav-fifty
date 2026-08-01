import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import LoginView from './LoginView.vue'
import { useAuthStore } from '@/stores/auth'

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/login', name: 'login', component: LoginView },
      { path: '/lists/new', name: 'create-list', component: stub },
    ],
  })
}

async function mountAt(redirect?: string) {
  const router = testRouter()
  await router.push(redirect ? { name: 'login', query: { redirect } } : { name: 'login' })
  await router.isReady()
  const wrapper = mount(LoginView, { global: { plugins: [router] } })
  return { wrapper, router }
}

function button(wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'], text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('offers both the Google and (in dev) the stub button', async () => {
    const { wrapper } = await mountAt()
    expect(button(wrapper, 'Continue with Google')).toBeDefined()
    // import.meta.env.DEV is true under Vitest, so the stub button is shown.
    expect(button(wrapper, 'Dev login')).toBeDefined()
  })

  it('hands off to the backend Google flow, forwarding the redirect', async () => {
    const auth = useAuthStore()
    const spy = vi.spyOn(auth, 'loginWithGoogle').mockImplementation(() => {})
    const { wrapper } = await mountAt('/lists/new')

    await button(wrapper, 'Continue with Google')!.trigger('click')

    expect(spy).toHaveBeenCalledWith('/lists/new')
  })

  it('dev login signs in then routes to the redirect target', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'devLogin').mockResolvedValue()
    const { wrapper, router } = await mountAt('/lists/new')

    await button(wrapper, 'Dev login')!.trigger('click')
    await flushPromises()

    expect(auth.devLogin).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.fullPath).toBe('/lists/new')
  })

  it('shows an error when dev login fails', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'devLogin').mockRejectedValue(new Error('down'))
    const { wrapper } = await mountAt()

    await button(wrapper, 'Dev login')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
