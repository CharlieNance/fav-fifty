import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { ApiError, apiFetch } from '@/api/client'
import AdminAbuseView from './AdminAbuseView.vue'
import type { AbuseOverview, BlockList } from './adminApi'

const apiFetchMock = vi.mocked(apiFetch)

function makeOverview(overrides: Partial<AbuseOverview> = {}): AbuseOverview {
  return {
    window_hours: 24,
    your_ip: '192.0.2.1',
    rate_limited_total: 40,
    by_route: [{ route_class: 'events', requests: 500, rate_limited: 40 }],
    top_ips: [
      { ip: '198.51.100.7', requests: 400, rate_limited: 40, blocked_by: null },
      { ip: '198.51.100.8', requests: 90, rate_limited: 0, blocked_by: '198.51.100.8/32' },
      { ip: '192.0.2.1', requests: 10, rate_limited: 0, blocked_by: null },
    ],
    ...overrides,
  }
}

function makeBlockList(overrides: Partial<BlockList> = {}): BlockList {
  return {
    source: 'local',
    enforced: false,
    entries: [
      {
        network: '198.51.100.8/32',
        blocked_at: '2026-11-18T10:00:00Z',
        blocked_by: 'Owner',
        reason: 'scraping',
      },
    ],
    ...overrides,
  }
}

/** Answers by path, so the page's two parallel loads can come back in any order. */
function serve(routes: Record<string, unknown>): void {
  apiFetchMock.mockImplementation(async (path: string) => {
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix))
    if (!key) throw new Error(`unexpected ${path}`)
    const value = routes[key]
    if (value instanceof Error) throw value
    return value
  })
}

async function mountAbuse() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: AdminAbuseView },
      { path: '/login', name: 'login', component: { template: '<p />' } },
    ],
  })
  router.push('/')
  await router.isReady()
  const wrapper = mount(AdminAbuseView, {
    global: { plugins: [router] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

function button(wrapper: Awaited<ReturnType<typeof mountAbuse>>, label: string) {
  return wrapper.findAll('button').find((b) => (b.attributes('aria-label') ?? b.text()) === label)
}

enableAutoUnmount(afterEach)

describe('AdminAbuseView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('shows 429s by route and the busiest addresses, marking you and the blocked', async () => {
    serve({ '/admin/abuse': makeOverview(), '/admin/blocked-ips': makeBlockList() })
    const wrapper = await mountAbuse()

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/abuse?hours=24')
    expect(wrapper.text()).toContain('40 requests got a 429.')
    const rows = wrapper
      .findAll('tbody tr')
      .map((row) => row.findAll('th, td').map((cell) => cell.text()))
    expect(rows).toContainEqual(['events', '500', '40'])
    expect(rows).toContainEqual(['198.51.100.7', '400', '40', 'Block'])
    expect(rows).toContainEqual(['198.51.100.8', '90', '0', 'Blocked'])
    expect(rows).toContainEqual(['192.0.2.1', '10', '0', 'You'])
  })

  it('reloads for another window', async () => {
    serve({ '/admin/abuse': makeOverview(), '/admin/blocked-ips': makeBlockList() })
    const wrapper = await mountAbuse()

    await wrapper.find('select').setValue('168')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/abuse?hours=168')
  })

  it('says when the block list is not enforced, and lists entries with their reason', async () => {
    serve({ '/admin/abuse': makeOverview(), '/admin/blocked-ips': makeBlockList() })
    const wrapper = await mountAbuse()

    expect(wrapper.text()).toContain('Not enforced here')
    const entry = wrapper.find('ul[aria-label="Blocked addresses"] li')
    expect(entry.text()).toContain('198.51.100.8/32')
    expect(entry.text()).toContain('by Owner')
    expect(entry.text()).toContain('“scraping”')
  })

  it('blocks a busy address with a required reason', async () => {
    serve({ '/admin/abuse': makeOverview(), '/admin/blocked-ips': makeBlockList() })
    const wrapper = await mountAbuse()

    await button(wrapper, 'Block 198.51.100.7')!.trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain('Block 198.51.100.7?')

    const after = makeBlockList({
      entries: [
        ...makeBlockList().entries,
        {
          network: '198.51.100.7/32',
          blocked_at: '2026-11-18T12:00:00Z',
          blocked_by: 'Owner',
          reason: 'flood',
        },
      ],
    })
    apiFetchMock.mockImplementationOnce(async () => after)
    await dialog.find('textarea').setValue('flood')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/blocked-ips', {
      method: 'POST',
      body: JSON.stringify({ network: '198.51.100.7', reason: 'flood' }),
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.findAll('ul[aria-label="Blocked addresses"] li')).toHaveLength(2)
  })

  it('blocks a typed range, and shows why the server refused one', async () => {
    serve({ '/admin/abuse': makeOverview(), '/admin/blocked-ips': makeBlockList() })
    const wrapper = await mountAbuse()

    await wrapper.find('input[type="text"]').setValue(' 10.0.0.0/8 ')
    await wrapper.find('section[aria-labelledby="abuse-blocklist"] form').trigger('submit')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain('Block 10.0.0.0/8?')

    apiFetchMock.mockRejectedValueOnce(
      new ApiError(422, 'Unprocessable', 'Too wide: block at most a /24 at once (IPv4).'),
    )
    await dialog.find('textarea').setValue('test')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="dialog"]').text()).toContain('Too wide')
  })

  it('unblocks an entry', async () => {
    serve({ '/admin/abuse': makeOverview(), '/admin/blocked-ips': makeBlockList() })
    const wrapper = await mountAbuse()

    await button(wrapper, 'Unblock 198.51.100.8/32')!.trigger('click')
    apiFetchMock.mockImplementationOnce(async () => makeBlockList({ entries: [] }))
    await wrapper.find('[role="dialog"] form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/blocked-ips/remove', {
      method: 'POST',
      body: JSON.stringify({ network: '198.51.100.8/32', reason: null }),
    })
    expect(wrapper.text()).toContain('Nothing is blocked.')
  })

  it('still shows the numbers when the block list is unreachable', async () => {
    serve({
      '/admin/abuse': makeOverview(),
      '/admin/blocked-ips': new ApiError(
        503,
        'Unavailable',
        'The WAF block list isn’t configured.',
      ),
    })
    const wrapper = await mountAbuse()

    expect(wrapper.text()).toContain('40 requests got a 429.')
    expect(wrapper.text()).toContain('isn’t configured')
    // No Block buttons without a list to add to.
    expect(button(wrapper, 'Block 198.51.100.7')).toBeUndefined()
  })
})
