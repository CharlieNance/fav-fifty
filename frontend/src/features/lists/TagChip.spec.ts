import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import TagChip from './TagChip.vue'

describe('TagChip', () => {
  it('renders the label and no remove control by default', () => {
    const wrapper = mount(TagChip, { props: { label: 'sci-fi' } })

    expect(wrapper.text()).toContain('sci-fi')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows a labeled remove button when removable, and emits remove on click', async () => {
    const wrapper = mount(TagChip, { props: { label: 'sci-fi', removable: true } })

    const removeButton = wrapper.find('button')
    expect(removeButton.attributes('aria-label')).toBe('Remove tag sci-fi')

    await removeButton.trigger('click')

    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})
