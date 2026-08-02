import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ConfirmDialog from './ConfirmDialog.vue'

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

describe('ConfirmDialog', () => {
  it('renders the given title and message', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { title: "Delete 'Mine'?", message: "This can't be undone." },
    })

    expect(wrapper.text()).toContain("Delete 'Mine'?")
    expect(wrapper.text()).toContain("This can't be undone.")
  })

  it('emits confirm when the confirm button is clicked, without calling any API itself', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { title: 'Delete?', message: 'Sure?', confirmLabel: 'Delete' },
    })

    await findButton(wrapper, 'Delete')!.trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('emits cancel when the cancel button is clicked', async () => {
    const wrapper = mount(ConfirmDialog, { props: { title: 'Delete?', message: 'Sure?' } })

    await findButton(wrapper, 'Cancel')!.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('emits cancel on Escape and on a backdrop click', async () => {
    const wrapper = mount(ConfirmDialog, { props: { title: 'Delete?', message: 'Sure?' } })

    await wrapper.trigger('keydown.escape')
    await wrapper.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })

  it('shows the pending label and disables both buttons while pending', () => {
    const wrapper = mount(ConfirmDialog, {
      props: {
        title: 'Delete?',
        message: 'Sure?',
        confirmLabel: 'Delete',
        pendingLabel: 'Deleting…',
        pending: true,
      },
    })

    expect(findButton(wrapper, 'Deleting…')).toBeDefined()
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('renders an inline error without closing (no cancel/confirm emitted)', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { title: 'Delete?', message: 'Sure?', error: 'Could not delete the list.' },
    })

    expect(wrapper.find('[role="alert"]').text()).toBe('Could not delete the list.')
    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
