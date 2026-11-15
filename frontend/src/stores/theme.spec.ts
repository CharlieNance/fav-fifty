import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { resolveTheme, THEME_STORAGE_KEY, useThemeStore } from './theme'

describe('resolveTheme', () => {
  it('follows the system until there is a saved choice', () => {
    expect(resolveTheme(null, true)).toBe('light')
    expect(resolveTheme(null, false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
  })
})

describe('useThemeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    vi.restoreAllMocks()
  })

  it('defaults to dark and marks <html> with it', async () => {
    const store = useThemeStore()
    await nextTick()

    expect(store.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('toggling switches the theme, applies it, and remembers it', async () => {
    const store = useThemeStore()
    store.toggle()
    await nextTick()

    expect(store.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('starts from a saved choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    expect(useThemeStore().theme).toBe('light')
  })

  it('ignores a garbage saved value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(useThemeStore().theme).toBe('dark')
  })

  it('still switches for this visit when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    const store = useThemeStore()
    store.setTheme('light')

    expect(store.theme).toBe('light')
  })
})
