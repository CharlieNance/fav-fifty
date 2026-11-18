import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { useToastStore } from '@/stores/toasts'
import AdminListView from './AdminListView.vue'
import { makeListDetail } from './adminTestUtils'

const apiFetchMock = vi.mocked(apiFetch)
const stub = { template: '<div />' }

async function mountList() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/lists/:id', name: 'admin-list', component: AdminListView },
      { path: '/admin/users/:id', name: 'admin-user', component: stub },
      { path: '/login', name: 'login', component: stub },
    ],
  })
  router.push('/admin/lists/list-1')
  await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function buttonNamed(wrapper: Awaited<ReturnType<typeof mountList>>, name: string) {
  return wrapper.findAll('button').find((b) => b.text() === name)
}

enableAutoUnmount(afterEach)

describe('AdminListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('shows the list, its owner and its items in order', async () => {
    apiFetchMock.mockResolvedValueOnce(makeListDetail())
    const wrapper = await mountList()

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/lists/list-1')
    expect(wrapper.find('h1').text()).toBe('Secret sandwiches')
    expect(wrapper.find('a[href="/admin/users/user-2"]').text()).toContain('Scooby')
    const items = wrapper.findAll('ol li').map((li) => li.text())
    expect(items[0]).toContain('Cubano')
    expect(items[1]).toContain('Reuben')
  })

  it('shows an item image as its URL, never as an image', async () => {
    apiFetchMock.mockResolvedValueOnce(makeListDetail())
    const wrapper = await mountList()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('https://example.com/reuben.png')
  })

  it('needs a reason to remove the list', async () => {
    apiFetchMock.mockResolvedValueOnce(makeListDetail())
    const wrapper = await mountList()
    await buttonNamed(wrapper, 'Remove list')!.trigger('click')

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain('(required, kept in the audit log)')
    const confirm = dialog.findAll('button').find((b) => b.text() === 'Remove list')!
    expect(confirm.attributes('disabled')).toBeDefined()

    // A submit without a reason goes nowhere.
    await wrapper.find('form').trigger('submit')
    expect(apiFetchMock).toHaveBeenCalledTimes(1)

    apiFetchMock.mockResolvedValueOnce(
      makeListDetail({ deleted_at: '2026-11-18T00:00:00Z', removed_by_admin: true }),
    )
    await wrapper.find('textarea').setValue('slurs')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/lists/list-1/remove', {
      method: 'POST',
      body: JSON.stringify({ reason: 'slurs' }),
    })
    expect(wrapper.text()).toContain('Removed by admin')
    expect(buttonNamed(wrapper, 'Restore list')).toBeDefined()
    expect(useToastStore().toasts.map((t) => t.message)).toEqual(['List removed.'])
  })

  it('restores a list an admin removed', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeListDetail({ deleted_at: '2026-11-18T00:00:00Z', removed_by_admin: true }),
    )
    const wrapper = await mountList()
    await buttonNamed(wrapper, 'Restore list')!.trigger('click')
    apiFetchMock.mockResolvedValueOnce(makeListDetail())
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/lists/list-1/restore', {
      method: 'POST',
      body: JSON.stringify({ reason: null }),
    })
    expect(buttonNamed(wrapper, 'Remove list')).toBeDefined()
  })

  it('offers no restore for a list its owner deleted', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeListDetail({ deleted_at: '2026-11-18T00:00:00Z', removed_by_admin: false }),
    )
    const wrapper = await mountList()

    expect(wrapper.text()).toContain('Deleted by its owner')
    expect(buttonNamed(wrapper, 'Restore list')).toBeUndefined()
    expect(buttonNamed(wrapper, 'Remove list')).toBeUndefined()
  })
})
