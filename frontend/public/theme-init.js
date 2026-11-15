// Sets the light/dark theme on <html> BEFORE the page paints, so a light-mode
// visitor never sees a flash of the dark default while the app bundle loads.
//
// A plain blocking script in <head>, not inline: the planned CSP is
// `script-src 'self'` (docs/ABUSE_PROTECTION_PLAN.md), which blocks inline
// scripts. Mirrors `resolveTheme` in src/stores/theme.ts; that store takes over
// once the app mounts. Keep the storage key in sync with THEME_STORAGE_KEY.
;(function () {
  var theme = null
  try {
    theme = localStorage.getItem('favfifty:theme')
  } catch {
    // Storage blocked (private mode, site data off): follow the system.
  }
  if (theme !== 'light' && theme !== 'dark') {
    var prefersLight =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    theme = prefersLight ? 'light' : 'dark'
  }
  document.documentElement.setAttribute('data-theme', theme)
})()
