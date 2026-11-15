import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

import BaseDialog from './BaseDialog.vue'

// A page with an opener button and the dialog it controls, so focus moving in,
// staying in, and coming back can all be checked against real DOM focus.
const Host = defineComponent({
  components: { BaseDialog },
  setup() {
    const open = ref(false)
    const closes = ref(0)
    function close(): void {
      closes.value++
      open.value = false
    }
    return { open, closes, close }
  },
  template: `
    <main id="main-content" tabindex="-1">
      <button id="opener" @click="open = true">Open</button>
      <BaseDialog v-if="open" labelledby="h" @close="close">
        <h2 id="h">Title</h2>
        <button id="first">First</button>
        <button id="disabled" disabled>Disabled</button>
        <button id="last">Last</button>
      </BaseDialog>
    </main>
  `,
})

async function openDialog() {
  const wrapper = mount(Host, { attachTo: document.body })
  const opener = wrapper.get<HTMLButtonElement>('#opener')
  opener.element.focus()
  await opener.trigger('click')
  await flushPromises()
  return wrapper
}

/** Press Tab on the focused element; true if the dialog took over the move. */
function tab(shift = false): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  })
  document.activeElement!.dispatchEvent(event)
  return event.defaultPrevented
}

describe('BaseDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is a labelled modal dialog', async () => {
    const wrapper = await openDialog()
    const dialog = wrapper.get('[role="dialog"]')

    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('h')
  })

  it('moves focus to the first enabled control on open', async () => {
    await openDialog()
    expect(document.activeElement?.id).toBe('first')
  })

  it('wraps Tab from the last control to the first, and Shift+Tab back', async () => {
    await openDialog()

    document.getElementById('last')!.focus()
    expect(tab()).toBe(true)
    expect(document.activeElement?.id).toBe('first')

    expect(tab(true)).toBe(true)
    expect(document.activeElement?.id).toBe('last')
  })

  it('leaves Tab to the browser between controls in the middle', async () => {
    await openDialog()
    expect(tab()).toBe(false)
  })

  it('closes on Escape and on a backdrop click', async () => {
    const wrapper = await openDialog()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.vm.closes).toBe(1)

    await wrapper.get('#opener').trigger('click')
    await flushPromises()
    wrapper.get('[role="dialog"]').element.parentElement!.click()
    expect(wrapper.vm.closes).toBe(2)
  })

  it('returns focus to the control that opened it', async () => {
    const wrapper = await openDialog()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await nextTick()
    await nextTick()

    expect(document.activeElement?.id).toBe('opener')
  })
})
