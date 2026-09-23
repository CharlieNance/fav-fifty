/**
 * Transient, app-wide status messages ("You've been logged out.").
 *
 * A Pinia store rather than component state because the thing worth announcing
 * often happens *as the page changes* — logging out unmounts the header's
 * logged-in half and navigates home — so the message has to outlive whatever
 * component triggered it. `ToastHost` (mounted once in App.vue) renders them.
 *
 * Hand-rolled instead of a toast library: this is a handful of lines, and a
 * dependency would owe us more than that (see docs/DESIGN.md §Dependency policy).
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'

/** Long enough to read a short sentence, short enough not to linger. */
export const TOAST_DURATION_MS = 5000

/**
 * What the message is: a confirmation, a caution, or a failure. Drives the
 * chip's color and icon (docs/DESIGN.md §Status colors) — the three status
 * tokens, never a one-off color.
 */
export type ToastVariant = 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

export interface ToastOptions {
  /** Defaults to `success` — the confirmations outnumber everything else. */
  variant?: ToastVariant
  duration?: number
}

export const useToastStore = defineStore('toasts', () => {
  const toasts = ref<Toast[]>([])

  // Ids are only ever compared to each other, so a counter beats anything fancier.
  let nextId = 0
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  /** Show `message` until it's dismissed, or its duration passes. */
  function show(message: string, options: ToastOptions = {}): number {
    const { variant = 'success', duration = TOAST_DURATION_MS } = options
    const id = ++nextId
    toasts.value.push({ id, message, variant })
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    )
    return id
  }

  /** Drop one toast early (the close button, or a second call to the same action). */
  function dismiss(id: number): void {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  return { toasts, show, dismiss }
})
