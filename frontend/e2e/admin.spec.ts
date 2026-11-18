import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { expect, expectAccessible, test, useDevUser } from './fixtures.ts'

// The admin area end to end (docs/ADMIN_AND_ANALYTICS_PLAN.md §Tests). No API
// path can make anyone an admin, so the test does what the owner does: signs in
// once, then runs the grant-admin CLI against the same database.

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend')

function grantAdmin(email: string): void {
  execFileSync('uv', ['run', 'python', '-m', 'app.cli', 'grant-admin', '--email', email], {
    cwd: backendDir,
    stdio: 'pipe',
  })
}

async function devLogin(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
}

test('a non-admin never sees the admin area', async ({ page }) => {
  await devLogin(page)
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeHidden()

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/$/)
})

test('the admin locks a user, whose next request is refused', async ({
  page,
  browser,
  devUserKey,
}) => {
  // The user to lock: signed in, in a browser of their own.
  const victimKey = `e2e-victim-${randomUUID()}`
  const victimContext = await browser.newContext()
  await useDevUser(victimContext, victimKey)
  const victim = await victimContext.newPage()
  await devLogin(victim)
  expect((await victim.request.get('/api/v1/me')).status()).toBe(200)

  // The admin: signs in, is granted admin on the box, and reloads.
  await devLogin(page)
  grantAdmin(`dev+${devUserKey}@example.com`)
  // Straight to /admin: on a phone the header has no Admin link (no room).
  await page.goto('/admin')

  // The admin area opens on the dashboard.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Health, last 24 hours/ })).toBeVisible()
  await expectAccessible(page, 'admin dashboard')

  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Users' }).click()
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search users' }).fill(victimKey)
  await page.getByRole('link', { name: new RegExp(`Dev User ${victimKey}`) }).click()
  await expect(page.getByRole('heading', { name: `Dev User ${victimKey}` })).toBeVisible()
  await expectAccessible(page, 'admin user detail')

  await page.getByRole('button', { name: 'Lock account' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Reason/).fill('e2e: testing the lock')
  await expectAccessible(page, 'admin lock dialog')
  await dialog.getByRole('button', { name: 'Lock account' }).click()

  await expect(page.getByRole('status')).toContainText('is locked')
  await expect(page.getByText('“e2e: testing the lock”')).toBeVisible()

  // Their very next request is refused.
  expect((await victim.request.get('/api/v1/me')).status()).toBe(401)
  await victimContext.close()

  // The Settings page loads too (read-only here: a save would write backend/.env).
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('limits.max_tags_per_list')).toBeVisible()
  await expectAccessible(page, 'admin settings')
})

test('the admin reads a user’s list, removes it, then restores it', async ({
  page,
  browser,
  devUserKey,
  baseURL,
}) => {
  // The owner, with a list of their own.
  const ownerKey = `e2e-owner-${randomUUID()}`
  const ownerContext = await browser.newContext({ baseURL })
  await useDevUser(ownerContext, ownerKey)
  const owner = await ownerContext.newPage()
  await devLogin(owner)
  const created = await owner.request.post('/api/v1/lists', {
    data: { title: 'Best sandwiches' },
    headers: { Origin: baseURL! },
  })
  expect(created.status()).toBe(201)
  const listId = ((await created.json()) as { id: string }).id

  await devLogin(page)
  grantAdmin(`dev+${devUserKey}@example.com`)
  await page.goto('/admin/users')
  await page.getByRole('searchbox', { name: 'Search users' }).fill(ownerKey)
  await page.getByRole('link', { name: new RegExp(`Dev User ${ownerKey}`) }).click()

  // Their lists load only on request.
  await page.getByRole('button', { name: 'Show lists' }).click()
  await page.getByRole('link', { name: /Best sandwiches/ }).click()
  await expect(page.getByRole('heading', { name: 'Best sandwiches' })).toBeVisible()
  await expectAccessible(page, 'admin list detail')

  await page.getByRole('button', { name: 'Remove list' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Remove list' })).toBeDisabled()
  await dialog.getByLabel(/Reason/).fill('e2e: testing removal')
  await dialog.getByRole('button', { name: 'Remove list' }).click()
  await expect(page.getByText('Removed by admin')).toBeVisible()
  await expectAccessible(page, 'admin list detail, removed')

  // Gone for its owner…
  expect((await owner.request.get(`/api/v1/lists/${listId}`)).status()).toBe(404)

  // …until it's restored.
  await page.getByRole('button', { name: 'Restore list' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Restore list' }).click()
  await expect(page.getByRole('button', { name: 'Remove list' })).toBeVisible()
  expect((await owner.request.get(`/api/v1/lists/${listId}`)).status()).toBe(200)
  await ownerContext.close()
})
