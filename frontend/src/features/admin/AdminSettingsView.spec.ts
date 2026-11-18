import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import AdminSettingsView from './AdminSettingsView.vue'
import { makeSetting } from './adminTestUtils'

const apiFetchMock = vi.mocked(apiFetch)

const TAGS = makeSetting()
const SWITCH = makeSetting({
  key: 'rate_limits.enabled',
  kind: 'bool',
  description: 'Rate limiting on.',
  default: true,
  minimum: null,
  maximum: null,
  value: true,
})

async function mountSettings() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: AdminSettingsView }],
  })
  router.push('/')
  await router.isReady()
  const wrapper = mount(AdminSettingsView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountSettings>>

/** Rows' buttons are named "Save <setting>" / "Reset <setting>" for screen readers. */
function button(wrapper: Wrapper, name: string) {
  return wrapper.find(`button[aria-label="${name}"]`)
}

function saveButton(wrapper: Wrapper, label: string) {
  return button(wrapper, `Save ${label}`)
}

enableAutoUnmount(afterEach)

describe('AdminSettingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('lists settings by group with their defaults and bounds', async () => {
    apiFetchMock.mockResolvedValueOnce([TAGS, SWITCH])
    const wrapper = await mountSettings()

    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['Limits', 'Rate limits'])
    expect(wrapper.text()).toContain('Max tags per list')
    expect(wrapper.text()).toContain('Default 25, 1–200.')
    expect(
      wrapper.find<HTMLInputElement>('#setting-limits\\.max_tags_per_list').element.value,
    ).toBe('25')
  })

  it('only enables Save for a valid change, and explains a bad one', async () => {
    apiFetchMock.mockResolvedValueOnce([TAGS])
    const wrapper = await mountSettings()
    const input = wrapper.find('#setting-limits\\.max_tags_per_list')

    expect(saveButton(wrapper, 'Max tags per list').attributes('disabled')).toBeDefined()

    await input.setValue('500')
    expect(wrapper.text()).toContain('Must be between 1 and 200.')
    expect(saveButton(wrapper, 'Max tags per list').attributes('disabled')).toBeDefined()

    await input.setValue('40')
    expect(saveButton(wrapper, 'Max tags per list').attributes('disabled')).toBeUndefined()
  })

  it('saves after confirming, with the reason', async () => {
    apiFetchMock.mockResolvedValueOnce([TAGS])
    const wrapper = await mountSettings()
    await wrapper.find('#setting-limits\\.max_tags_per_list').setValue('40')
    await saveButton(wrapper, 'Max tags per list').trigger('click')

    expect(wrapper.find('[role="dialog"]').text()).toContain('From 25 to 40')

    apiFetchMock.mockResolvedValueOnce({ ...TAGS, value: 40, override: '40' })
    await wrapper.find('textarea').setValue('more tags')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/settings/limits.max_tags_per_list', {
      method: 'PUT',
      body: JSON.stringify({ value: 40, reason: 'more tags' }),
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    // Now overridden, so it can be reset.
    expect(button(wrapper, 'Reset Max tags per list').exists()).toBe(true)
  })

  it('resets an override to the default', async () => {
    apiFetchMock.mockResolvedValueOnce([{ ...TAGS, value: 40, override: '40' }])
    const wrapper = await mountSettings()

    await button(wrapper, 'Reset Max tags per list').trigger('click')
    apiFetchMock.mockResolvedValueOnce(TAGS)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/admin/settings/limits.max_tags_per_list/reset',
      { method: 'POST', body: JSON.stringify({ reason: null }) },
    )
  })

  it('saves a switch as a boolean', async () => {
    apiFetchMock.mockResolvedValueOnce([SWITCH])
    const wrapper = await mountSettings()
    await wrapper.find('#setting-rate_limits\\.enabled').setValue(false)
    await saveButton(wrapper, 'Enabled').trigger('click')
    apiFetchMock.mockResolvedValueOnce({ ...SWITCH, value: false, override: 'false' })
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiFetchMock).toHaveBeenLastCalledWith('/admin/settings/rate_limits.enabled', {
      method: 'PUT',
      body: JSON.stringify({ value: false, reason: null }),
    })
  })

  it('warns when a stored value is invalid', async () => {
    apiFetchMock.mockResolvedValueOnce([{ ...TAGS, override: 'lots', override_invalid: true }])
    const wrapper = await mountSettings()
    expect(wrapper.text()).toContain('The stored value “lots” isn’t valid')
  })
})
