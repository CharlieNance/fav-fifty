import { randomUUID } from 'node:crypto'

import { test as base } from '@playwright/test'

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

type Routable = Pick<import('@playwright/test').BrowserContext, 'route'>

/** Make every dev login from `target` sign in as the dev user named by `key`. */
export async function useDevUser(target: Routable, key: string): Promise<void> {
  await target.route('**/api/v1/auth/dev-login', async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('user', key)
    await route.continue({ url: url.toString() })
  })
}
