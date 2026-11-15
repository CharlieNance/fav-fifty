import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive a real browser against the real frontend + backend
// (unlike Vitest's jsdom unit tests). `webServer` starts both dev servers and
// waits for them to be reachable; `globalSetup` brings up Postgres first,
// since neither dev server does that itself. See the project's `run` skill
// (.claude/skills/run/SKILL.md) for how a human or an agent drives the app
// manually the same way.
//
// The e2e servers get their OWN ports (5190/8090) and are started fresh every
// run — never reused. The backend keeps rate-limit buckets in memory, and every
// e2e test signs in as the same fixed dev user, so reusing a long-lived backend
// (yours from `run_dev.sh`, or the previous e2e run's) carried spent buckets
// over: the second run within the hour hit `imports_per_hour` and the claim /
// import tests failed with "That's a lot of uploads". Separate ports also mean
// e2e never collides with a dev session you have open. (Not 5174: a second
// `npm run dev` auto-bumps from 5173 onto it.)
const FRONTEND_PORT = 5190
const BACKEND_PORT = 8090

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${BACKEND_PORT}` },
    },
    {
      // No --reload: nothing to watch, and the reloader's child process can
      // outlive Playwright's shutdown on Windows.
      command: `uv run uvicorn app.main:app --port ${BACKEND_PORT}`,
      cwd: '../backend',
      url: `http://localhost:${BACKEND_PORT}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        // The CSRF origin guard only trusts the configured frontend; on the
        // default (5173) every write from the e2e frontend would be a 403.
        FRONTEND_URL: `http://localhost:${FRONTEND_PORT}`,
        CORS_ALLOWED_ORIGINS: `http://localhost:${FRONTEND_PORT}`,
        // Rate limits stay ON (so e2e runs the real middleware path) but roomy:
        // the tests exercise features, not quotas — pytest covers the limits.
        RUNTIME_RATE_LIMITS__IMPORTS_PER_HOUR: '1000',
        // The shared dev user gains lists every run (the DB is persistent), so
        // the default 100-list cap would eventually fail list creation.
        RUNTIME_LIMITS__MAX_LISTS_PER_USER: '10000',
      },
    },
  ],
})
