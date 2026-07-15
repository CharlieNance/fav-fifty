import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'

import BaseButton from './BaseButton.vue'

// Minimal router so the `to` (RouterLink) case can resolve.
function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: { template: '<div />' } }],
  })
}

describe('BaseButton', () => {
  it('renders a real <button> by default with the slot content', () => {
    const wrapper = mount(BaseButton, { slots: { default: 'Click me' } })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.text()).toBe('Click me')
  })

  it('renders an <a> when given href', () => {
    const wrapper = mount(BaseButton, { props: { href: 'https://example.com' } })
    expect(wrapper.element.tagName).toBe('A')
    expect(wrapper.attributes('href')).toBe('https://example.com')
  })

  it('renders a router link when given `to`', () => {
    const wrapper = mount(BaseButton, {
      props: { to: '/' },
      global: { plugins: [testRouter()] },
    })
    expect(wrapper.element.tagName).toBe('A')
  })

  it('applies the variant styling', () => {
    const primary = mount(BaseButton, { props: { variant: 'primary' } })
    expect(primary.classes()).toContain('bg-accent')

    const secondary = mount(BaseButton, { props: { variant: 'secondary' } })
    expect(secondary.classes()).toContain('border')
  })

  it('calls the provided click listener when the underlying button is clicked', async () => {
    const onClick = vi.fn()
    const wrapper = mount(BaseButton, { attrs: { onClick } })
    await wrapper.trigger('click')
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
