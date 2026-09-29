import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ItemCountBadge from './ItemCountBadge.vue'
import { itemCountTier } from './itemCountTier'

describe('itemCountTier', () => {
  it.each([
    [0, 'low'],
    [10, 'low'],
    [11, 'mid'],
    [25, 'mid'],
    [26, 'high'],
    [49, 'high'],
    [50, 'full'],
  ] as const)('buckets %i items as %s', (count, tier) => {
    expect(itemCountTier(count)).toBe(tier)
  })
})

describe('ItemCountBadge', () => {
  it('shows the count in a disc with a spelled-out accessible name', () => {
    const wrapper = mount(ItemCountBadge, { props: { count: 12 } })

    const badge = wrapper.get('[role="img"]')
    expect(badge.text()).toBe('12')
    expect(badge.attributes('aria-label')).toBe('12 of 50 items')
    expect(badge.find('.bg-warning').exists()).toBe(true)
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('becomes a star once the list is full', () => {
    const wrapper = mount(ItemCountBadge, { props: { count: 50 } })

    expect(wrapper.find('svg polygon').exists()).toBe(true)
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('50 of 50 items')
    expect(wrapper.text()).toBe('50')
  })
})
