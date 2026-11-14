import { fileURLToPath, URL } from 'node:url'

import { configDefaults, defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  optimizeDeps: {
    // Serve vue-draggable-plus as source instead of prebundling it: the
    // prebundle gives it a SECOND copy of Vue in dev, and its internal
    // template ref then fails with "Missing ref owner context" / "Root
    // element not found" the moment a drag list mounts. Excluded, its `vue`
    // import resolves to the same module the app uses. (Prod builds are
    // unaffected — Rollup always dedupes.)
    exclude: ['vue-draggable-plus'],
  },
  resolve: {
    // `@` -> `src`, so imports don't turn into ../../../ chains.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Proxy API calls to the FastAPI backend during local dev. Requests to
    // `/api/*` are forwarded to localhost:8000 unchanged (the backend serves
    // `/api/v1/...` itself), so the browser sees a single origin — no CORS, and
    // the HttpOnly session cookie "just works". Prod is the same shape:
    // CloudFront routes `/api/v1/*` on favfifty.com to the backend.
    proxy: {
      '/api': {
        // Use 127.0.0.1, not localhost: Node 17+ resolves `localhost` to IPv6
        // (::1) first, but uvicorn listens on IPv4 only by default, so a
        // `localhost` target gets ECONNREFUSED. Pinning IPv4 avoids that.
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Vitest: run component tests in a browser-like DOM.
    environment: 'jsdom',
    globals: true,
    // e2e/ holds Playwright specs, which use a different `test`/`expect` and
    // must not be picked up by Vitest's own discovery.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
