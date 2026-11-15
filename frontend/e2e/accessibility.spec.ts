import type { Page } from '@playwright/test'

import { test, expect, expectAccessible } from './fixtures.ts'

// Automated WCAG 2.1 A/AA checks (axe-core) on every page and dialog
// (docs/DESIGN.md §Accessibility). Runs in each Playwright project, so the
// same screens are checked in the light theme, the dark theme and at phone
// size — contrast especially differs between the themes.
//
// axe catches roughly a third of real accessibility problems (contrast,
// names, roles, labels, landmarks); keyboard flow and screen-reader wording
// still need a manual pass. One test per screen, so a failure names it.

// Dialogs fade and slide in; without this, axe can measure contrast mid-fade.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

/** Create a device (anonymous) list from the index and land on its page. */
async function createList(page: Page, title: string): Promise<void> {
  await page.goto('/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

async function addItem(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: /add (your first favorite|item)/i }).click()
  await page.getByLabel('Name').fill(text)
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

test('public pages', async ({ page }) => {
  for (const [path, heading] of [
    ['/', /Stop stopping/],
    ['/login', 'Welcome back'],
    ['/signup', 'Create your free account'],
    ['/lists', 'My lists'],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expectAccessible(page, path)
  }
})

test('a list page, empty and with items', async ({ page }) => {
  await createList(page, 'Axe list')
  await expect(page.getByText('Nothing ranked yet.')).toBeVisible()
  await expectAccessible(page, 'an empty list page')

  await addItem(page, 'Alpha')
  await addItem(page, 'Bravo')
  await expectAccessible(page, 'a list page with items')

  await page.goto('/lists')
  await expect(page.getByRole('link', { name: 'Axe list' })).toBeVisible()
  await expectAccessible(page, 'the lists index with a list')
})

test('list dialogs', async ({ page }) => {
  await page.goto('/lists')
  await page.getByRole('button', { name: 'New list' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectAccessible(page, 'the new-list dialog')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await createList(page, 'Axe dialogs')
  await addItem(page, 'Alpha')

  const dialogs: [string, string][] = [
    ['Add item', 'the add-item dialog'],
    ['Edit Alpha', 'the edit-item dialog'],
    ['Delete Alpha', 'the delete-item confirmation'],
    ['Tags', 'the manage-tags dialog'],
    ['Edit', 'the edit-list dialog'],
    ['Delete', 'the delete-list confirmation'],
  ]
  for (const [button, what] of dialogs) {
    await page.getByRole('button', { name: button, exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expectAccessible(page, what)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }
})

test('an add-item error shown in the dialog', async ({ page }) => {
  await createList(page, 'Axe errors')
  await addItem(page, 'Alpha')
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  await page.getByLabel('Name').fill('alpha')
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expectAccessible(page, 'the add-item dialog showing an error')
})

test('signed in, with the claim dialog', async ({ page }) => {
  await createList(page, 'Axe claim')
  await page.getByRole('link', { name: 'Log in' }).click()
  await page.getByRole('button', { name: /dev login/i }).click()

  const dialog = page.getByRole('dialog', { name: 'Bring your lists with you?' })
  await expect(dialog).toBeVisible()
  await expectAccessible(page, 'the claim dialog')
  await dialog.getByRole('button', { name: 'Add 1 list' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByRole('link', { name: 'Axe claim' })).toBeVisible()
  await expectAccessible(page, 'the signed-in lists index')

  // Logging out goes home and says so in a toast (its own colors, so scan it).
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByText(/logged out/)).toBeVisible()
  await expectAccessible(page, 'the logged-out toast')
})

test('messages and empty states', async ({ page }) => {
  await page.goto('/login?error=1')
  await expect(page.getByRole('alert')).toContainText('didn’t complete')
  await expectAccessible(page, 'the login error')

  // A list id that doesn't exist (on this device or anywhere).
  await page.goto('/lists/00000000-0000-4000-8000-000000000000')
  await expect(page.getByText(/not found|doesn.t exist|couldn.t find/i)).toBeVisible()
  await expectAccessible(page, 'a missing list')

  // Two device lists bring up the backup reminder banner.
  await createList(page, 'Axe one')
  await createList(page, 'Axe two')
  await page.goto('/lists')
  await expect(page.getByTestId('backup-reminder')).toBeVisible()
  await expectAccessible(page, 'the backup reminder')

  await page.getByRole('searchbox', { name: /search your lists/i }).fill('zzz-nothing')
  await expect(page.getByText(/no lists match/i)).toBeVisible()
  await expectAccessible(page, 'a search with no results')
})

// axe can't judge keyboard use. BaseDialog's focus handling has jsdom tests
// (BaseDialog.spec.ts); this is the one real-browser check of the same thing.
test('a dialog works from the keyboard alone', async ({ page }) => {
  await createList(page, 'Axe keyboard')
  const opener = page.getByRole('button', { name: /add your first favorite/i })
  await opener.focus()
  await page.keyboard.press('Enter')

  // Focus moves into the dialog, and Tab can't leave it.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(':focus')).toHaveCount(1)
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    await expect(dialog.locator(':focus')).toHaveCount(1)
  }
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator(':focus')).toHaveCount(1)

  // Escape closes it and puts focus back where it was.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})
