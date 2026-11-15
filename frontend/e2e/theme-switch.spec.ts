import type { Page } from '@playwright/test'

import { test, expect } from './fixtures.ts'

// The light/dark switch in a real browser (stores/theme.ts, public/theme-init.js):
// the theme follows the system until the visitor picks one, and their pick then
// wins — across a reload and over the system setting. Vitest covers the store's
// logic; this checks the pieces together, including that the page really
// repaints. It sets the system scheme itself, so it means the same in every
// project (the `chromium-dark` project runs everything else in dark).

/** The page's resolved text color: proof the tokens really switched, not just the attribute. */
async function inkColor(page: Page): Promise<string> {
  // A string, because the e2e tsconfig is Node-only (no DOM types).
  return page.evaluate<string>('getComputedStyle(document.body).color')
}

test('the theme follows the system until you pick one, then your pick wins', async ({ page }) => {
  const html = page.locator('html')

  // — No choice yet: follow the system, live —
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  const darkInk = await inkColor(page)

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveAttribute('data-theme', 'light')
  expect(await inkColor(page)).not.toBe(darkInk)

  // — Pick dark with the header switch, against a light system —
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await inkColor(page)).toBe(darkInk)
  // The switch now offers the way back.
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()

  // — The pick survives a reload (theme-init.js applies it before the app loads) —
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')

  // — And outranks the system from now on —
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveAttribute('data-theme', 'dark')
})
