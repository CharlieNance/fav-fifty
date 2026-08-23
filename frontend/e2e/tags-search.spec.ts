import { test, expect, type Page } from '@playwright/test'

// One end-to-end journey covering step 6 of docs/TAGS_SEARCH_PLAN.md's build
// order: add a tag on the details page, see it as a chip on the index, then
// find the list by searching for that tag. Runs against the REAL backend, the
// same spirit as list-items.spec.ts — everything below it is exercised by
// Vitest specs already; this is the one pass confirming the pieces click
// together in a real browser.

test.afterEach(async ({ page }) => {
  const response = await page.request.get('/api/lists')
  if (!response.ok()) return
  for (const list of (await response.json()) as { id: string; title: string }[]) {
    if (list.title.startsWith('E2E tags ')) {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  }
})

async function search(page: Page, query: string): Promise<void> {
  const box = page.getByRole('searchbox', { name: /search your lists/i })
  await box.fill(query)
  // useListSearch debounces re-fetching by 300ms (frontend/src/features/lists/useListSearch.ts).
  await page.waitForTimeout(400)
}

test('add a tag, see it on the index, and find the list by searching', async ({ page }) => {
  // — Sign in via the dev stub and create a fresh list —
  await page.goto('/lists')
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()

  const title = `E2E tags ${Date.now()}`
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  // Creating a list navigates straight to its details page.
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // — Tag it via the Manage tags modal —
  await page.getByRole('button', { name: 'Tags' }).click()
  const tagsDialog = page.getByRole('dialog', { name: 'Manage tags' })
  await expect(tagsDialog).toBeVisible()
  await tagsDialog.getByLabel('Add a tag').fill('sci-fi')
  await tagsDialog.getByRole('button', { name: 'Add', exact: true }).click()
  await tagsDialog.getByLabel('Add a tag').fill('board games')
  await tagsDialog.getByRole('button', { name: 'Add', exact: true }).click()
  await tagsDialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  // The saved tags render as read-only chips right on the details page.
  await expect(page.getByText('sci-fi')).toBeVisible()
  await expect(page.getByText('board games')).toBeVisible()

  // — Back on the index, the same tags show as chips on the row —
  await page.getByRole('link', { name: 'My lists' }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
  const row = page.locator('li').filter({ hasText: title })
  await expect(row.getByText('board games')).toBeVisible()

  // — Search by a tag substring finds the list —
  await search(page, 'board')
  await expect(page.locator('li').filter({ hasText: title })).toBeVisible()

  // — A query matching neither title nor any tag shows the distinct empty state —
  await search(page, 'zzz-no-such-list-or-tag')
  await expect(page.getByText(/no lists match/i)).toBeVisible()
  await expect(page.locator('li').filter({ hasText: title })).toHaveCount(0)

  // — Clearing the search restores the full index —
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.locator('li').filter({ hasText: title })).toBeVisible()

  // — Tidy up: delete the list so local DBs don't accumulate E2E litter —
  await page.getByRole('link', { name: title }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/\/lists$/)
})
