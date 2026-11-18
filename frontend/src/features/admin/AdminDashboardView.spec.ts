import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import AdminDashboardView from './AdminDashboardView.vue'
import type { Dashboard } from './adminApi'

const apiFetchMock = vi.mocked(apiFetch)

const zero = { requests: 0, client_errors: 0, server_errors: 0, rate_limited: 0 }

function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    generated_at: '2026-11-18T12:00:00Z',
    product: {
      users_total: 12,
      users_new_7d: 3,
      users_new_30d: 9,
      users_signed_in_7d: 5,
      users_locked: 1,
      lists_live: 40,
      items_live: 812,
      daily: [
        {
          day: '2026-11-18',
          users_created: 1,
          lists_created: 4,
          lists_imported: 0,
          items_created: 30,
        },
      ],
    },
    health: {
      window_hours: 24,
      totals: { requests: 1000, client_errors: 20, server_errors: 2, rate_limited: 5 },
      by_route: [
        {
          route_class: 'lists',
          requests: 900,
          client_errors: 10,
          server_errors: 2,
          rate_limited: 5,
        },
      ],
      hourly: [{ hour: '2026-11-18T11:00:00Z', ...zero, requests: 50 }],
    },
    cost: null,
    cloudwatch_dashboard_url: null,
    ...overrides,
  }
}

async function mountDashboard() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: AdminDashboardView }],
  })
  router.push('/')
  await router.isReady()
  const wrapper = mount(AdminDashboardView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

describe('AdminDashboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('shows the product and health numbers', async () => {
    apiFetchMock.mockResolvedValueOnce(makeDashboard())
    const wrapper = await mountDashboard()

    expect(apiFetchMock).toHaveBeenCalledWith('/admin/dashboard')
    const text = wrapper.text()
    expect(text).toContain('Accounts')
    expect(text).toContain('+3 this week')
    expect(text).toContain('1 locked')
    expect(text).toContain('812')
    expect(text).toContain('0.2%') // 2 server errors in 1,000 requests
    expect(wrapper.find('table caption').text()).toBe('By route')
  })

  it('says when there is no cost snapshot or CloudWatch link yet', async () => {
    apiFetchMock.mockResolvedValueOnce(makeDashboard())
    const wrapper = await mountDashboard()

    expect(wrapper.text()).toContain('No snapshot yet.')
    expect(wrapper.text()).toContain('gets linked here after the first deploy')
  })

  it('shows the cost snapshot and the CloudWatch link once they exist', async () => {
    apiFetchMock.mockResolvedValueOnce(
      makeDashboard({
        cloudwatch_dashboard_url: 'https://console.aws.amazon.com/cloudwatch/x',
        cost: {
          taken_at: '2026-11-18T06:00:00Z',
          month: '2026-11-01',
          month_to_date: '4.00',
          forecast: '12.00',
          currency: 'USD',
          by_service: { 'Amazon Route 53': '0.50', 'Amazon Lightsail': '3.50' },
        },
      }),
    )
    const wrapper = await mountDashboard()

    expect(wrapper.text()).toContain('$4.00')
    expect(wrapper.text()).toContain('$12.00')
    // Biggest service first.
    expect(wrapper.findAll('li').map((li) => li.text())[0]).toContain('Amazon Lightsail')
    const link = wrapper.find('a[href="https://console.aws.amazon.com/cloudwatch/x"]')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('refreshes past the server cache', async () => {
    apiFetchMock.mockResolvedValue(makeDashboard())
    const wrapper = await mountDashboard()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Refresh')!
      .trigger('click')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/dashboard?refresh=true')
  })
})
