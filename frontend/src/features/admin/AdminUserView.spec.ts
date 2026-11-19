import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import { ApiError } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toasts'
import AdminUserView from './AdminUserView.vue'
import { makeListDetail, makeUserDetail } from './adminTestUtils'

const apiFetchMock = vi.mocked(apiFetch)
const stub = { template: '<div />' }

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/users', name: 'admin-users', component: stub },
      { path: '/admin/users/:id', name: 'admin-user', component: AdminUserView },
      { path: '/admin/lists/:id', name: 'admin-list', component: stub },
      { path: '/admin/audit', name: 'admin-audit', component: stub },
      { path: '/login', name: 'login', component: stub },
    ],
  })
}

async function mountUser(id = 'user-2') {
  const router = testRouter()
  router.push(`/admin/users/${id}`)
  await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

describe('AdminUserView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
    useAuthStore().user = { id: 'owner', display_name: 'Owner', avatar_url: null, is_admin: true }
  })

  it('shows the user and their counts', async () => {
    apiFetchMock.mockResolvedValueOnce(makeUserDetail())
    const wrapper = await mountUser()

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/users/user-2')
    expect(wrapper.find('h1').text()).toBe('Scooby')
    expect(wrapper.text()).toContain('scooby@example.com')
    expect(wrapper.text()).toContain('42')
  })

  it('locks the account with a reason, then says so', async () => {
    apiFetchMock.mockResolvedValueOnce(makeUserDetail())
    const wrapper = await mountUser()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Lock account')!
      .trigger('click')
    expect(wrapper.find('[role="dialog"]').text()).toContain('Lock Scooby?')

    apiFetchMock.mockResolvedValueOnce(
      makeUserDetail({
        is_active: false,
        recent_actions: [
          {
            id: 'a1',
            admin_user_id: 'owner',
            action: 'lock_user',
            target_type: 'user',
            target_id: 'user-2',
            reason: 'spam',
            details: {},
            created_at: '2026-11-17T00:00:00Z',
          },
        ],
      }),
    )
    await wrapper.find('textarea').setValue('  spam ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/users/user-2/lock', {
      method: 'POST',
      body: JSON.stringify({ reason: 'spam' }),
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Locked')
    expect(wrapper.text()).toContain('“spam”')
    expect(wrapper.text()).toContain('Unlock account')
    expect(useToastStore().toasts.map((t) => t.message)).toEqual(['Scooby is locked.'])
  })

  it('keeps the dialog open with the error when the action fails', async () => {
    apiFetchMock.mockResolvedValueOnce(makeUserDetail())
    const wrapper = await mountUser()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Lock account')!
      .trigger('click')

    apiFetchMock.mockRejectedValueOnce(new ApiError(409, 'nope', 'Already gone.'))
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="dialog"] [role="alert"]').text()).toBe('Already gone.')
  })

  it('loads their lists only when asked', async () => {
    apiFetchMock.mockResolvedValueOnce(makeUserDetail())
    const wrapper = await mountUser()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Viewing them is recorded in the audit log.')

    apiFetchMock.mockResolvedValueOnce([
      { ...makeListDetail(), deleted_at: null, removed_by_admin: false },
      { ...makeListDetail({ id: 'list-9', title: 'Gone', deleted_at: '2026-11-18T00:00:00Z' }) },
    ])
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Show lists')!
      .trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/users/user-2/lists')
    const rows = wrapper.findAll('[aria-label="Their lists"] li').map((li) => li.text())
    expect(rows[0]).toContain('Secret sandwiches')
    expect(rows[1]).toContain('Deleted by owner')
    expect(wrapper.find('a[href="/admin/lists/list-1"]').exists()).toBe(true)
  })

  it('offers no lock button on your own account', async () => {
    apiFetchMock.mockResolvedValueOnce(makeUserDetail({ id: 'owner', role: 'admin' }))
    const wrapper = await mountUser('owner')

    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).not.toContain('Lock account')
    expect(labels).toContain('Sign out everywhere')
  })

  it('offers to sign in again when the admin session is too old', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(403, 'old', 'Sign in again to use admin tools'))
    const wrapper = await mountUser()

    const link = wrapper.find('[role="alert"] a')
    expect(link.text()).toBe('Sign in again')
    expect(link.attributes('href')).toBe('/login?redirect=/admin/users/user-2')
  })
})
