import { test, expect, type Page } from '@playwright/test'

// Drives the whole items feature (docs/ITEMS_CRUD_PLAN.md) against the REAL
// backend: add, edit, delete, and reorder — including a genuine SortableJS
// drag, which jsdom can't exercise (the Vitest specs simulate the drop event
// instead). Runs as one serial journey on one list because each step builds
// on the previous one's data; the list title is unique per run so leftovers
// from earlier local runs can't collide.

/** Rank rows as the user sees them: the text of each item, top to bottom. */
async function rowTexts(page: Page): Promise<string[]> {
  return page.locator('main li p.font-medium').allInnerTexts()
}

// The journey deletes its list in its last step, but a FAILED run dies before
// getting there — and this litter is visible beyond e2e: the local DB is shared
// with manual browser testing and with backend pytest (both use the same
// dev-login user). Sweep every list this spec ever names, pass or fail.
// `page.request` shares the page's session cookie, so plain API calls work.
test.afterEach(async ({ page }) => {
  const response = await page.request.get('/api/lists')
  if (!response.ok()) return
  for (const list of (await response.json()) as { id: string; title: string }[]) {
    if (list.title.startsWith('E2E favorites ')) {
      await page.request.delete(`/api/lists/${list.id}`)
    }
  }
})

async function addItem(page: Page, text: string, note?: string): Promise<void> {
  await page.getByRole('button', { name: /add (your first favorite|item)/i }).click()
  await page.getByLabel('Name').fill(text)
  if (note) await page.getByLabel(/note/i).fill(note)
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click()
  // The modal closes and the new row lands at the bottom.
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('main li').filter({ hasText: text })).toBeVisible()
}

test('build, edit, reorder, and prune a ranked list end-to-end', async ({ page }) => {
  // — Sign in via the dev stub and create a fresh list —
  await page.goto('/lists')
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()

  const title = `E2E favorites ${Date.now()}`
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByPlaceholder(/favorite albums/i).fill(title)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // — Empty state invites the first item —
  await expect(page.getByText('Nothing ranked yet.')).toBeVisible()

  // — Add three items —
  await addItem(page, 'Alpha', 'the original')
  await addItem(page, 'Bravo')
  await addItem(page, 'Charlie')
  await expect(page.getByText('3 of 50 ranked')).toBeVisible()
  expect(await rowTexts(page)).toEqual(['Alpha', 'Bravo', 'Charlie'])

  // — A duplicate is refused with the backend's own message, modal stays open —
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  await page.getByLabel('Name').fill('alpha') // dedup is case-insensitive
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click()
  await expect(page.getByRole('alert')).toContainText('already exists')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // — Edit: rename Bravo and give it a note —
  await page.getByRole('button', { name: 'Edit Bravo' }).click()
  await page.getByLabel('Name').fill('Bravo II')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('main li').filter({ hasText: 'Bravo II' })).toBeVisible()

  // — Reorder with the buttons: Charlie 3 → 2 —
  await page.getByRole('button', { name: 'Move Charlie up' }).click()
  // Wait on the row that MOVES (auto-retrying), not one already in place.
  await expect(page.locator('main li').nth(1)).toContainText('Charlie')
  expect(await rowTexts(page)).toEqual(['Alpha', 'Charlie', 'Bravo II'])

  // — Reorder with a real drag: grab Alpha's handle, drop it at the bottom —
  const rows = page.locator('main li')
  const handleBox = (await rows.filter({ hasText: 'Alpha' }).locator('.drag-handle').boundingBox())!
  const targetBox = (await rows.filter({ hasText: 'Bravo II' }).boundingBox())!
  // The list runs Sortable in forceFallback mode (see ListDetailView.vue), so
  // the drag is pure mouse-event-driven and simulatable — but it needs a real
  // gesture: press, a small move past fallbackTolerance, then a stepped glide
  // past the target's midpoint (with settle pauses) before releasing.
  // Playwright's one-shot dragTo() moves too abruptly for its hit-testing.
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2 + 10,
    {
      steps: 5,
    },
  )
  await page.waitForTimeout(150)
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 6, {
    steps: 20,
  })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await expect(rows.last()).toContainText('Alpha')
  expect(await rowTexts(page)).toEqual(['Charlie', 'Bravo II', 'Alpha'])

  // The order survives a reload — i.e. the server really has it, we didn't
  // just repaint locally.
  await page.reload()
  await expect(page.getByText('3 of 50 ranked')).toBeVisible()
  expect(await rowTexts(page)).toEqual(['Charlie', 'Bravo II', 'Alpha'])

  // — Delete the top item; the rest renumber from 1 —
  await page.getByRole('button', { name: 'Delete Charlie' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('2 of 50 ranked')).toBeVisible()
  expect(await rowTexts(page)).toEqual(['Bravo II', 'Alpha'])
  await expect(page.locator('main li').first()).toContainText('1')

  // — Tidy up: delete the whole list so local DBs don't accumulate E2E litter —
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/\/lists$/)
})
