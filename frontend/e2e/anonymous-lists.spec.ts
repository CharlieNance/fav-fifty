import { test, expect } from '@playwright/test'

// Anonymous use (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md, PR 4): a visitor who
// never signs in builds a list that's saved in this browser's localStorage, and
// nothing reaches the lists API. Each Playwright test gets a fresh browser
// context, so its storage starts empty and nothing leaks into the shared DB.

test('build a list without signing in, and find it again after a reload', async ({ page }) => {
  // Any request to the lists API would mean device data leaked to the server.
  const listApiCalls: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/lists')) {
      listApiCalls.push(`${request.method()} ${request.url()}`)
    }
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Make your first list' }).click()

  // The create modal opens right here, with no detour through login.
  const title = `Device favorites ${Date.now()}`
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.getByRole('button', { name: /add your first favorite/i }).click()
  await page.getByLabel('Name').fill('Alpha')
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click()
  await expect(page.locator('main li').filter({ hasText: 'Alpha' })).toBeVisible()

  // Still there after a reload: it's in this browser's storage.
  await page.reload()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.locator('main li').filter({ hasText: 'Alpha' })).toBeVisible()

  await page.getByRole('link', { name: 'My lists' }).click()
  await expect(page.getByText('Saved on this device only')).toBeVisible()
  await expect(page.getByRole('link', { name: title })).toBeVisible()

  expect(listApiCalls).toEqual([])
})

test("signing in shows the account's lists, and signing out brings the device's back", async ({
  page,
}) => {
  const title = `Device only ${Date.now()}`
  await page.goto('/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // Signed in, the device's list isn't shown (claiming it into the account
  // comes later, in PR 7) and the device note goes away.
  await page.getByRole('link', { name: 'Log in' }).click()
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
  await expect(page.getByText('Saved on this device only')).toBeHidden()
  await expect(page.getByRole('link', { name: title })).toBeHidden()

  // Signed out, it's back: signing in didn't touch the device's lists.
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByRole('link', { name: 'My lists' }).click()
  await expect(page.getByText('Saved on this device only')).toBeVisible()
  await expect(page.getByRole('link', { name: title })).toBeVisible()
})

test('export lists to a file, then import them into another browser', async ({ page, browser }) => {
  const title = `Backed up ${Date.now()}`
  await page.goto('/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.getByRole('link', { name: 'My lists' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^fav-fifty-lists-\d{4}-\d{2}-\d{2}\.json$/)
  const file = await download.path()

  // A fresh context is a different browser as far as storage goes: empty.
  const other = await browser.newContext()
  try {
    const otherPage = await other.newPage()
    await otherPage.goto('/lists')
    await expect(otherPage.getByRole('link', { name: title })).toBeHidden()

    await otherPage.getByTestId('import-file').setInputFiles(file)
    await expect(otherPage.getByText('Imported 1 list.')).toBeVisible()
    await expect(otherPage.getByRole('link', { name: title })).toBeVisible()
  } finally {
    await other.close()
  }
})

test("a signed-in user can export their account's lists for a browser that isn't signed in", async ({
  page,
  browser,
}) => {
  const title = `From my account ${Date.now()}`
  await page.goto('/')
  await page.getByRole('link', { name: 'Log in' }).click()
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
  // Importing into an account waits for the server's bulk import (PR 6).
  await expect(page.getByRole('button', { name: 'Import' })).toBeHidden()

  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.getByRole('link', { name: 'My lists' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const file = await (await downloading).path()

  const other = await browser.newContext()
  try {
    const otherPage = await other.newPage()
    await otherPage.goto('/lists')
    await otherPage.getByTestId('import-file').setInputFiles(file)
    await expect(otherPage.getByRole('link', { name: title })).toBeVisible()
  } finally {
    await other.close()
  }
})
