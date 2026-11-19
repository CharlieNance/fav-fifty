import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { ApiError, apiFetch } from '@/api/client'
import AdminAuditView from './AdminAuditView.vue'
import { AUDIT_PAGE_SIZE, type AuditLogEntry } from './adminApi'

const apiFetchMock = vi.mocked(apiFetch)
const stub = { template: '<div />' }

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'a1',
    admin_user_id: 'owner',
    action: 'lock_user',
    target_type: 'user',
    target_id: 'user-2',
    reason: null,
    details: {},
    created_at: '2026-11-18T12:00:00Z',
    admin_display_name: 'Owner',
    subject_user_id: 'user-2',
    subject_display_name: 'Scooby',
    ...overrides,
  }
}

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/audit', name: 'admin-audit', component: AdminAuditView },
      { path: '/admin/users/:id', name: 'admin-user', component: stub },
      { path: '/admin/lists/:id', name: 'admin-list', component: stub },
      { path: '/login', name: 'login', component: stub },
    ],
  })
}

async function mountAudit(path = '/admin/audit') {
  const router = testRouter()
  router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

function rows(wrapper: Awaited<ReturnType<typeof mountAudit>>['wrapper']): string[] {
  // Each row's parts are separate flex items: join them as they read on screen.
  return wrapper.findAll('li').map((li) =>
    li
      .findAll(':scope > div > *, :scope > p')
      .map((part) => part.text())
      .join(' '),
  )
}

enableAutoUnmount(afterEach)

describe('AdminAuditView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('lists entries with who did what to whom, naming a list by its owner', async () => {
    apiFetchMock.mockResolvedValueOnce([
      entry({ reason: 'spam' }),
      entry({
        id: 'a2',
        action: 'remove_list',
        target_type: 'list',
        target_id: 'list-1',
        details: { owner_id: 'user-2' },
      }),
      entry({
        id: 'a3',
        action: 'update_setting',
        target_type: 'setting',
        target_id: 'limits.max_tags_per_list',
        details: { from: null, to: '30' },
      }),
      entry({ id: 'a4', action: 'grant_admin', admin_user_id: null, admin_display_name: null }),
    ])
    const { wrapper } = await mountAudit()

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/audit-log?limit=50')
    const [lock, remove, setting, grant] = rows(wrapper)
    expect(lock).toContain('Locked Scooby')
    expect(lock).toContain('by Owner')
    expect(lock).toContain('“spam”')
    expect(remove).toContain('Removed a list of Scooby')
    expect(setting).toContain('limits.max_tags_per_list default → 30')
    expect(grant).toContain('by the CLI')

    const listLink = wrapper.findAll('a').find((a) => a.text() === 'a list')!
    expect(listLink.attributes('href')).toBe('/admin/lists/list-1')
  })

  it('filters by action through the URL', async () => {
    apiFetchMock.mockResolvedValue([])
    const { wrapper, router } = await mountAudit()

    await wrapper.findAll('select')[0]!.setValue('remove_list')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ action: 'remove_list' })
    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/audit-log?limit=50&action=remove_list')
    expect(wrapper.text()).toContain('Nothing matches.')
  })

  it('shows one user’s history from a link, and can widen to everyone', async () => {
    apiFetchMock.mockResolvedValue([entry()])
    const { wrapper, router } = await mountAudit('/admin/audit?user=user-2')

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/audit-log?limit=50&subject_user_id=user-2')
    expect(wrapper.text()).toContain('Only entries about Scooby')

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Show everyone')!
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({})
    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/audit-log?limit=50')
  })

  it('pages back from the oldest entry shown', async () => {
    const page = Array.from({ length: AUDIT_PAGE_SIZE }, (_, i) =>
      entry({ id: `p${i}`, created_at: `2026-11-18T12:00:${String(59 - i).padStart(2, '0')}Z` }),
    )
    apiFetchMock.mockResolvedValueOnce(page).mockResolvedValueOnce([entry({ id: 'older' })])
    const { wrapper } = await mountAudit()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Load older')!
      .trigger('click')
    await flushPromises()

    const last = page.at(-1)!.created_at
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      `/admin/audit-log?limit=50&before=${encodeURIComponent(last)}`,
    )
    expect(wrapper.findAll('li')).toHaveLength(AUDIT_PAGE_SIZE + 1)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Load older')).toBe(false)
  })

  it('explains a failure', async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(403, 'Forbidden', 'Sign in again to use admin tools'),
    )
    const { wrapper } = await mountAudit()
    expect(wrapper.text()).toContain('admin tools need a recent sign-in')
  })
})
