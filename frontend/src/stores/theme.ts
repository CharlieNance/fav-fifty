/**
 * Light/dark theme (docs/DESIGN.md §Light theme).
 *
 * - **Follows the system until the visitor picks.** With no saved choice the
 *   theme tracks `prefers-color-scheme` live; flipping the header toggle saves
 *   an explicit `light`/`dark` to `localStorage` that wins from then on.
 * - **Applied as `data-theme` on <html>.** `main.css` redefines the color
 *   tokens under `:root[data-theme='light']`, so nothing else needs to know.
 * - `public/theme-init.js` sets the same attribute before first paint (no flash
 *   of the wrong theme); this store takes over once the app is running.
 *
 * A per-device preference, so `localStorage` (in memory only if that's blocked),
 * not the account.
 */
import { computed, ref, watchEffect } from 'vue'
import { defineStore } from 'pinia'

export type Theme = 'light' | 'dark'

/** Keep in sync with `public/theme-init.js`. */
export const THEME_STORAGE_KEY = 'favfifty:theme'

function readSaved(): Theme | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    return null
  }
}

function writeSaved(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Blocked storage: the choice still holds for this visit.
  }
}

/** The theme to show: an explicit choice, else the system's preference. */
export function resolveTheme(saved: Theme | null, systemPrefersLight: boolean): Theme {
  return saved ?? (systemPrefersLight ? 'light' : 'dark')
}

export const useThemeStore = defineStore('theme', () => {
  const saved = ref<Theme | null>(readSaved())

  // jsdom (tests) and very old browsers have no matchMedia: treat as dark.
  const query =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null
  const systemPrefersLight = ref(query?.matches ?? false)
  // App-lifetime store, so the listener is never removed.
  query?.addEventListener('change', (event) => {
    systemPrefersLight.value = event.matches
  })

  const theme = computed<Theme>(() => resolveTheme(saved.value, systemPrefersLight.value))

  watchEffect(() => {
    document.documentElement.setAttribute('data-theme', theme.value)
  })

  function setTheme(next: Theme): void {
    saved.value = next
    writeSaved(next)
  }

  function toggle(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, setTheme, toggle }
})
