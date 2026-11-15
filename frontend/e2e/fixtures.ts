import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Page } from '@playwright/test'

// Every e2e test signs in as its OWN dev user. Specs import `test`/`expect`
// from here instead of '@playwright/test'.
//
// The dev-login stub takes an optional `?user=<key>` (backend/app/api/routes/
// auth.py); each key is a separate user. Rather than teach the app's "Dev
// login" button about keys, we rewrite its request on the way out — so tests
// still click the real button and exercise the real sign-in flow, but parallel
// tests (and repeat runs against the persistent local DB) never share lists,
// per-user rate-limit buckets or per-user caps.
//
// The route is on the test's `context`, so it covers every page in it. A
// context a test creates itself (`browser.newContext()`) signs in as the
// shared dev user unless it calls `useDevUser` too.
export const test = base.extend<{ devUserKey: string }>({
  // A fresh key per test (and per retry), so a retry starts with a clean user.
  devUserKey: async ({}, use) => {
    await use(`e2e-${randomUUID()}`)
  },
  context: async ({ context, devUserKey }, use) => {
    await useDevUser(context, devUserKey)
    await use(context)
  },
})

export { expect } from '@playwright/test'

/** WCAG 2.1 A + AA: the level docs/DESIGN.md §Accessibility holds the app to. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Fail the test if axe finds WCAG A/AA violations on the page as it is now
 * (open dialogs included). `what` names the screen in the failure message,
 * which lists each rule, its help link and the offending elements — enough to
 * fix without re-running.
 */
export async function expectAccessible(page: Page, what: string): Promise<void> {
  // Let running CSS transitions/animations finish first, or axe measures colors
  // mid-fade: e.g. a button re-enabling after a failed save fades opacity
  // 60% → 100% over 150ms and read as 3.5:1 contrast. Endless animations
  // (spinners) are skipped, or this would never resolve. A string, because the
  // e2e tsconfig has no DOM types.
  await page.evaluate(`Promise.allSettled(
    document.getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
      .map((a) => a.finished),
  )`)
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.helpUrl}\n` +
      v.nodes.map((n) => `  - ${n.target.join(' ')}\n    ${n.failureSummary ?? ''}`).join('\n'),
  )
  expect(report, `accessibility violations on ${what}`).toEqual([])
}

type Routable = Pick<import('@playwright/test').BrowserContext, 'route'>

/** Make every dev login from `target` sign in as the dev user named by `key`. */
export async function useDevUser(target: Routable, key: string): Promise<void> {
  await target.route('**/api/v1/auth/dev-login', async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('user', key)
    await route.continue({ url: url.toString() })
  })
}
