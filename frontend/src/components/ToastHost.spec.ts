import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

import ToastHost from './ToastHost.vue'
import { useToastStore } from '@/stores/toasts'

describe('ToastHost', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps the live region mounted while empty, so arrivals get announced', () => {
    const wrapper = mount(ToastHost)

    const region = wrapper.get('[aria-live="polite"]')
    expect(region.attributes('role')).toBe('status')
    // Not atomic: a second toast must not drag the first one back through the
    // screen reader with it (role="status" would imply atomic otherwise).
    expect(region.attributes('aria-atomic')).toBe('false')
    expect(wrapper.findAll('p')).toHaveLength(0)
  })

  it('renders every queued toast', async () => {
    const store = useToastStore()
    const wrapper = mount(ToastHost)

    store.show('You’ve been logged out.')
    store.show('Second thing')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('p').map((p) => p.text())).toEqual([
      'You’ve been logged out.',
      'Second thing',
    ])
  })

  it('paints each variant with its own status color', async () => {
    const store = useToastStore()
    const wrapper = mount(ToastHost)

    store.show('Done')
    store.show('Careful', { variant: 'warning' })
    store.show('Broke', { variant: 'error' })
    await wrapper.vm.$nextTick()

    const chips = wrapper.findAll('[role="status"] > div')
    expect(chips[0].classes()).toContain('bg-success')
    expect(chips[1].classes()).toContain('bg-warning')
    expect(chips[2].classes()).toContain('bg-error')
  })

  it('dismisses the toast whose close button was clicked', async () => {
    const store = useToastStore()
    const wrapper = mount(ToastHost)

    store.show('Keep me')
    const doomed = store.show('Dismiss me')
    await wrapper.vm.$nextTick()

    await wrapper.findAll('button')[1].trigger('click')

    expect(store.toasts.map((t) => t.message)).toEqual(['Keep me'])
    expect(doomed).toBeTypeOf('number')
  })
})
