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
    // origin — no CORS in dev, and future HttpOnly session cookies "just work".
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Vitest: run component tests in a browser-like DOM.
    environment: 'jsdom',
    globals: true,
  },
})
