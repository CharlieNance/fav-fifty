import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { TOAST_DURATION_MS, useToastStore } from './toasts'

describe('toast store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with nothing to show', () => {
    expect(useToastStore().toasts).toEqual([])
  })

  it('shows a message and drops it once its time is up', () => {
    const store = useToastStore()

    store.show('You’ve been logged out.')
    expect(store.toasts.map((t) => t.message)).toEqual(['You’ve been logged out.'])

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1)
    expect(store.toasts).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(store.toasts).toEqual([])
  })

  it('dismisses on request, and the expiry timer then finds nothing to do', () => {
    const store = useToastStore()
    const id = store.show('Gone in a moment')

    store.dismiss(id)
    expect(store.toasts).toEqual([])

    // The pending timeout must not resurrect anything or throw when it fires.
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(store.toasts).toEqual([])
  })

  it('stacks concurrent toasts, each expiring on its own clock', () => {
    const store = useToastStore()

    store.show('First')
    vi.advanceTimersByTime(TOAST_DURATION_MS / 2)
    store.show('Second')

    expect(store.toasts.map((t) => t.message)).toEqual(['First', 'Second'])

    vi.advanceTimersByTime(TOAST_DURATION_MS / 2)
    expect(store.toasts.map((t) => t.message)).toEqual(['Second'])
  })

  it('gives each toast a distinct id, even for identical messages', () => {
    const store = useToastStore()

    const first = store.show('Same words')
    const second = store.show('Same words')

    expect(first).not.toBe(second)
    store.dismiss(first)
    expect(store.toasts.map((t) => t.id)).toEqual([second])
  })

  it('defaults to the success variant, and takes any other on request', () => {
    const store = useToastStore()

    store.show('Saved')
    store.show('Careful', { variant: 'warning' })

    expect(store.toasts.map((t) => t.variant)).toEqual(['success', 'warning'])
  })

  it('honors a caller-supplied duration', () => {
    const store = useToastStore()
    store.show('Brief', { duration: 100 })

    vi.advanceTimersByTime(100)
    expect(store.toasts).toEqual([])
  })
})
