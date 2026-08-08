import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive a real browser against the real frontend + backend
// (unlike Vitest's jsdom unit tests). `webServer` starts both dev servers and
// waits for them to be reachable; `globalSetup` brings up Postgres first,
// since neither dev server does that itself. See frontend/e2e/README.md and
// the project's `run` skill (.claude/skills/run/SKILL.md) for how a human or
// an agent drives the app manually the same way.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'uv run uvicorn app.main:app --reload',
      cwd: '../backend',
      url: 'http://localhost:8000/health',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
