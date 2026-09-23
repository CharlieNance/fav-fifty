import { test, expect } from '@playwright/test'

// Exercises the dev-login stub (backend/app/api/routes/auth.py), since the
// real Google/Cognito flow needs live credentials and can't be driven in an
// automated browser (see docs/SETUP.md §3). Requires the backend to be in
// APP_ENV=development with no COGNITO_* values set — the default from
// backend/.env.example — so POST /auth/dev-login is live instead of 404ing.
test('dev login unlocks a protected route', async ({ page }) => {
  await page.goto('/lists')

  // The auth guard redirects unauthenticated visitors to /login.
  await expect(page).toHaveURL(/\/login/)

  await page.getByRole('button', { name: /dev login/i }).click()

  // Signing in sends the user back to the page they originally asked for.
  await expect(page).toHaveURL(/\/lists$/)
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
})

test('signing in with no destination in mind lands on your lists', async ({ page }) => {
  // Straight to /login, the way the header's "Log in" link goes — no ?redirect=.
  await page.goto('/login')

  await page.getByRole('button', { name: /dev login/i }).click()

  await expect(page).toHaveURL(/\/lists$/)
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()
})

test('logging out leaves the protected page and says what happened', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: /dev login/i }).click()
  await expect(page.getByRole('heading', { name: 'My lists' })).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()

  // Off the lists page, back to the homepage hero — not left reading lists
  // we're no longer signed in to see.
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: /Stop stopping/ })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('logged out')
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible()
})
