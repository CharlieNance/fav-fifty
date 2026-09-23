import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import LoginView from './LoginView.vue'
import { DEFAULT_POST_LOGIN_PATH } from './postLogin'
import { useAuthStore } from '@/stores/auth'

const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/login', name: 'login', component: LoginView },
      { path: '/lists', name: 'lists', component: stub },
      { path: '/lists/new', name: 'create-list', component: stub },
    ],
  })
}

async function mountAt(redirect?: string, query: Record<string, string | null> = {}) {
  const router = testRouter()
  await router.push({ name: 'login', query: { ...(redirect ? { redirect } : {}), ...query } })
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

  it('dev login with no redirect lands on the user’s lists, not the homepage', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'devLogin').mockResolvedValue()
    const { wrapper, router } = await mountAt()

    await button(wrapper, 'Dev login')!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe(DEFAULT_POST_LOGIN_PATH)
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

  it('explains the failure when the backend bounces back with ?error=', async () => {
    const { wrapper } = await mountAt(undefined, { error: 'auth_failed' })

    expect(wrapper.find('[role="alert"]').text()).toContain('try again')
  })

  it('surfaces the failure on a valueless ?error= too', async () => {
    // Presence is the signal, not the value — an empty flag still means failure.
    const { wrapper } = await mountAt(undefined, { error: '' })

    expect(wrapper.find('[role="alert"]').text()).toContain('try again')
  })

  it('surfaces the failure on a bare ?error with no value at all', async () => {
    // vue-router parses a valueless `?error` as null, a different shape from ''.
    const { wrapper, router } = await mountAt(undefined, { error: null })

    expect(router.currentRoute.value.fullPath).toBe('/login?error')
    expect(wrapper.find('[role="alert"]').text()).toContain('try again')
  })

  it('clears the error when a navigation drops the ?error= flag', async () => {
    // The header's "Log in" link points at a bare /login, so this navigation is
    // reachable from the errored page — and it reuses this component instance.
    const { wrapper, router } = await mountAt(undefined, { error: 'auth_failed' })
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await router.push({ name: 'login' })
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('lets a fresh dev-login failure speak over the stale ?error= flag', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'devLogin').mockRejectedValue(new Error('down'))
    const { wrapper } = await mountAt(undefined, { error: 'auth_failed' })

    await button(wrapper, 'Dev login')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('Dev login failed')
  })

  it('shows no error on a normal visit', async () => {
    const { wrapper } = await mountAt()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
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
