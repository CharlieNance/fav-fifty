import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    // `@` -> `src`, so imports don't turn into ../../../ chains.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Proxy API calls to the FastAPI backend during local dev. Requests to
    // `/api/*` are forwarded to localhost:8000, so the browser sees a single
    // origin — no CORS in dev, and the HttpOnly session cookie "just works".
    // The backend mounts its routers at the root (`/me`, `/auth/*`), so we strip
    // the `/api` prefix here. In prod the SPA calls the API's real origin via
    // VITE_API_BASE_URL, so this rewrite is a dev-only concern.
    proxy: {
      '/api': {
        // Use 127.0.0.1, not localhost: Node 17+ resolves `localhost` to IPv6
        // (::1) first, but uvicorn listens on IPv4 only by default, so a
        // `localhost` target gets ECONNREFUSED. Pinning IPv4 avoids that.
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    // Vitest: run component tests in a browser-like DOM.
    environment: 'jsdom',
    globals: true,
  },
})
