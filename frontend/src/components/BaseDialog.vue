<script setup lang="ts">
/**
 * The one modal-dialog shell: backdrop, panel, and the keyboard and screen-reader
 * behavior every dialog owes its user (WCAG 2.1.2, 2.4.3), so each dialog only
 * supplies its content.
 *
 * - **Focus moves in** on open: to whatever the content already focused (a
 *   form's first input), else the first focusable control. In a confirm
 *   dialog that's Cancel, which is the safe default for a destructive action.
 * - **Tab is trapped**: it wraps between the first and last control instead of
 *   wandering into the page behind, which `aria-modal` already hides from
 *   screen readers.
 * - **Escape and a backdrop click close** (emit `close`; the owner decides what
 *   closing means, e.g. disabled while saving).
 * - **Focus goes back** to whatever opened the dialog when it closes. If that
 *   control is gone (its row was deleted), focus lands on the page's main region
 *   rather than being dropped on <body>.
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(
  defineProps<{
    /** id of the dialog's heading — its accessible name. */
    labelledby: string
    /** id of the text that explains it, read after the name. */
    describedby?: string
    /** Width/layout classes for the panel. */
    panelClass?: string
  }>(),
  { describedby: undefined, panelClass: 'max-w-sm' },
)

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
// Captured at setup, before anything inside takes focus.
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(): HTMLElement[] {
  return panel.value ? Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return

  const controls = focusables()
  if (controls.length === 0) {
    event.preventDefault()
    panel.value?.focus()
    return
  }
  const first = controls[0]!
  const last = controls[controls.length - 1]!
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  await nextTick()
  if (panel.value?.contains(document.activeElement)) return
  ;(focusables()[0] ?? panel.value)?.focus()
})

onBeforeUnmount(() => {
  // Deferred: the opener may be re-rendering in the same tick (e.g. a row
  // swapping in its saved data).
  void nextTick(() => {
    if (opener?.isConnected) opener.focus()
    else document.getElementById('main-content')?.focus()
  })
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-scrim px-4"
    @click.self="emit('close')"
    @keydown="onKeydown"
  >
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledby"
      :aria-describedby="describedby"
      tabindex="-1"
      class="w-full rounded-2xl border border-border bg-elevated p-6 shadow-xl outline-none motion-safe:animate-rise-in"
      :class="panelClass"
    >
      <slot />
    </div>
  </div>
</template>
