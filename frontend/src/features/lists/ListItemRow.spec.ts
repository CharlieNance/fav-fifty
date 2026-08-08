import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { makeItem } from './itemTestUtils'
import ListItemRow from './ListItemRow.vue'
import type { ListItem } from './types'

function mountRow(item: ListItem, extra: { itemCount?: number; movePending?: boolean } = {}) {
  return mount(ListItemRow, {
    props: { item, itemCount: extra.itemCount ?? 3, movePending: extra.movePending ?? false },
  })
}

function button(wrapper: ReturnType<typeof mountRow>, labelStart: string) {
  return wrapper
    .findAll('button')
    .find((candidate) => candidate.attributes('aria-label')?.startsWith(labelStart))
}

describe('ListItemRow', () => {
  it('renders the rank, text, and note', () => {
    const wrapper = mountRow(makeItem({ position: 7, text: 'Cheesecake', note: 'the good kind' }))

    expect(wrapper.text()).toContain('7')
    expect(wrapper.text()).toContain('Cheesecake')
    expect(wrapper.text()).toContain('the good kind')
  })

  it('renders an image thumbnail only when image_url is set', () => {
    const bare = mountRow(makeItem())
    expect(bare.find('img').exists()).toBe(false)

    const withImage = mountRow(makeItem({ image_url: 'https://example.com/pic.jpg' }))
    expect(withImage.find('img').attributes('src')).toBe('https://example.com/pic.jpg')
  })

  it('emits edit / delete / move-up / move-down from the action buttons', async () => {
    const wrapper = mountRow(makeItem({ position: 2 }))

    await button(wrapper, 'Edit')!.trigger('click')
    await button(wrapper, 'Delete')!.trigger('click')
    await button(wrapper, 'Move')!.trigger('click') // "Move … up" sorts first

    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(wrapper.emitted('move-up')).toHaveLength(1)
  })

  it('disables Move up on the first item and Move down on the last', () => {
    const first = mountRow(makeItem({ position: 1 }), { itemCount: 3 })
    expect(button(first, 'Move Favorite thing 1 up') ?? button(first, 'Move')).toBeDefined()
    expect(
      first
        .findAll('button')
        .find((b) => b.attributes('aria-label')?.includes('up'))!
        .attributes().disabled,
    ).toBeDefined()

    const last = mountRow(makeItem({ position: 3 }), { itemCount: 3 })
    expect(
      last
        .findAll('button')
        .find((b) => b.attributes('aria-label')?.includes('down'))!
        .attributes().disabled,
    ).toBeDefined()

    const middle = mountRow(makeItem({ position: 2 }), { itemCount: 3 })
    for (const direction of ['up', 'down']) {
      expect(
        middle
          .findAll('button')
          .find((b) => b.attributes('aria-label')?.includes(direction))!
          .attributes().disabled,
      ).toBeUndefined()
    }
  })

  it('disables both move buttons while a reorder is pending', () => {
    const wrapper = mountRow(makeItem({ position: 2 }), { movePending: true })

    for (const direction of ['up', 'down']) {
      expect(
        wrapper
          .findAll('button')
          .find((b) => b.attributes('aria-label')?.includes(direction))!
          .attributes().disabled,
      ).toBeDefined()
    }
  })

  it('has a drag handle for pointer users, outside the tab order', () => {
    const wrapper = mountRow(makeItem())
    const handle = wrapper.find('.drag-handle')

    expect(handle.exists()).toBe(true)
    expect(handle.element.tagName).not.toBe('BUTTON')
    expect(handle.attributes('aria-hidden')).toBe('true')
  })
})
