import { readFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

// Anonymous use (docs/ARCHITECTURE.md §Anonymous lists): a visitor who
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

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My lists' })
    .click()
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

  // Signed in, the device's list isn't shown unless the user brings it along,
  // and the device note goes away. Here they decline.
  await page.getByRole('link', { name: 'Log in' }).click()
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByText('Saved on this device only')).toBeHidden()
  await expect(page.getByRole('link', { name: title })).toBeHidden()

  // Signed out, it's back: signing in didn't touch the device's lists.
  await page.getByRole('button', { name: 'Log out' }).click()
  // Logging out goes home; wait for it, or it can override the click below.
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My lists' })
    .click()
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

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My lists' })
    .click()
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

  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My lists' })
    .click()
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

test("signing in offers to bring the device's lists into the account", async ({ page }) => {
  const stamp = Date.now()
  const kept = `Claimed ${stamp}`
  const leftBehind = `Left behind ${stamp}`
  await page.goto('/lists')
  for (const title of [leftBehind, kept]) {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My lists' })
      .click()
    await page.getByRole('button', { name: 'New list' }).click()
    await page.getByPlaceholder(/favorite albums/i).fill(title)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
  }
  await page.getByRole('button', { name: /add your first favorite/i }).click()
  await page.getByLabel('Name').fill('Alpha')
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click()
  await expect(page.locator('main li').filter({ hasText: 'Alpha' })).toBeVisible()

  await page.getByRole('link', { name: 'Log in' }).click()
  await page.getByRole('button', { name: /dev login/i }).click()

  // Every list starts checked. Leave one behind.
  const dialog = page.getByRole('dialog', { name: 'Bring your lists with you?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('checkbox', { name: new RegExp(leftBehind) }).uncheck()
  await dialog.getByRole('button', { name: 'Add 1 list' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByText('Added 1 list to your account.')).toBeVisible()
  await expect(page).toHaveURL(/\/lists$/)
  await expect(page.getByRole('link', { name: kept })).toBeVisible()
  await expect(page.getByRole('link', { name: leftBehind })).toBeHidden()

  // It's in the account, items and all, so it survives a reload from the server.
  await page.reload()
  await page.getByRole('link', { name: kept }).click()
  await expect(page.locator('main li').filter({ hasText: 'Alpha' })).toBeVisible()

  // Signed out, only the list left unchecked is still on the device.
  await page.getByRole('button', { name: 'Log out' }).click()
  // Logging out goes home; wait for it, or it can override the click below.
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My lists' })
    .click()
  await expect(page.getByRole('link', { name: leftBehind })).toBeVisible()
  await expect(page.getByRole('link', { name: kept })).toBeHidden()
})

test("a signed-in user's file import goes to the account", async ({ page, browser }) => {
  const title = `Imported to account ${Date.now()}`
  // Make the file in a separate, anonymous browser, so this one has no device
  // lists and signing in here doesn't open the claim dialog.
  const other = await browser.newContext()
  // Read now: closing the context deletes the download.
  let contents: Buffer
  try {
    const otherPage = await other.newPage()
    await otherPage.goto('/lists')
    await otherPage.getByRole('button', { name: 'New list' }).click()
    await otherPage.getByPlaceholder(/favorite albums/i).fill(title)
    await otherPage.getByRole('button', { name: 'Save' }).click()
    await expect(otherPage.getByRole('heading', { name: title })).toBeVisible()
    await otherPage
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My lists' })
      .click()
    const downloading = otherPage.waitForEvent('download')
    await otherPage.getByRole('button', { name: 'Export' }).click()
    contents = await readFile(await (await downloading).path())
  } finally {
    await other.close()
  }

  await page.goto('/login')
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()

  const uploads: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/lists/import') uploads.push(request.method())
  })
  await page
    .getByTestId('import-file')
    .setInputFiles({ name: 'lists.json', mimeType: 'application/json', buffer: contents })
  await expect(page.getByText('Imported 1 list.')).toBeVisible()
  await expect(page.getByRole('link', { name: title })).toBeVisible()
  expect(uploads).toEqual(['POST'])

  // From the server, not the device: still there after a reload.
  await page.reload()
  await expect(page.getByRole('link', { name: title })).toBeVisible()
})

test('with two lists on the device, a reminder offers to keep them safe', async ({ page }) => {
  const stamp = Date.now()
  const titles = [`Reminder one ${stamp}`, `Reminder two ${stamp}`]
  await page.goto('/lists')
  const reminder = page.getByTestId('backup-reminder')

  for (const [n, title] of titles.entries()) {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My lists' })
      .click()
    // One list isn't worth a reminder yet; the always-on sign-in link is enough.
    if (n === 1) {
      await expect(reminder).toBeHidden()
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'create a FREE account' })).toBeVisible()
    }
    await page.getByRole('button', { name: 'New list' }).click()
    await page.getByPlaceholder(/favorite albums/i).fill(title)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
  }

  // The second list crosses the line, so the reminder shows right on its page.
  await expect(reminder).toBeVisible()

  // Dismissed, it stays dismissed after a reload.
  await reminder.getByRole('button', { name: 'Dismiss reminder' }).click()
  await expect(reminder).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: titles[1]! })).toBeVisible()
  await expect(reminder).toBeHidden()

  // The lists page's create-account link leads (via the same Google flow as
  // sign-in) to the claim dialog.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My lists' })
    .click()
  await page.getByRole('link', { name: 'create a FREE account' }).click()
  await expect(page.getByRole('heading', { name: 'Create your free account' })).toBeVisible()
  await page.getByRole('button', { name: /dev login/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Bring your lists with you?' })
  await dialog.getByRole('button', { name: 'Add 2 lists' }).click()
  await expect(page.getByText('Added 2 lists to your account.')).toBeVisible()
  for (const title of titles) await expect(page.getByRole('link', { name: title })).toBeVisible()
  await expect(reminder).toBeHidden()
})
