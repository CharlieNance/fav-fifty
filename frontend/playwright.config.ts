import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive a real browser against the real frontend + backend
// (unlike Vitest's jsdom unit tests). `webServer` starts both dev servers and
// waits for them to be reachable; `globalSetup` brings up Postgres first,
// since neither dev server does that itself. See the project's `run` skill
// (.claude/skills/run/SKILL.md) for how a human or an agent drives the app
// manually the same way.
//
// Each test signs in as its own fresh dev user (e2e/fixtures.ts), so tests never
// share lists, per-user caps or per-user rate-limit buckets — in parallel, or
// across runs against the persistent local DB.
//
// The e2e servers get their OWN ports (5190/8090) and are started fresh every
// run — never reused — so e2e never collides with, or inherits state from, a dev
// session you have open (`run_dev.sh`). (Not 5174: a second `npm run dev`
// auto-bumps from 5173 onto it.)
const FRONTEND_PORT = 5190
const BACKEND_PORT = 8090

// GitHub Actions sets CI=true. There, retry flaky failures (a retry is also
// what records a trace — see `trace` below) and write an HTML report that the
// workflow uploads as an artifact when the run fails. Locally, fail fast with
// plain console output.
const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    // Traces land in test-results/ (uploaded with the report on CI failure);
    // read them with the playwright-trace skill or `npx playwright show-trace`.
    trace: 'on-first-retry',
  },
  // Every spec runs in each. All three are Chromium, so CI installs one browser.
  projects: [
    // Playwright emulates a light `prefers-color-scheme` unless told otherwise,
    // and the app follows the system theme (stores/theme.ts) — so this is light.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The same, in the dark theme: catches anything hidden or unreadable there.
    { name: 'chromium-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    // Phone-sized, with touch (docs/MOBILE_READINESS.md).
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
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
        // Rate limits and caps run at their real defaults: they're per user,
        // and every test is a fresh user.
      },
    },
  ],
})
