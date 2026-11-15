import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import BackupReminder from './BackupReminder.vue'
import { createLocalListRepository } from './localListRepository'
import { REMINDER_DISMISSED_KEY } from './useBackupReminder'

// The real defaults: jsdom's localStorage behind the document store and the
// dismissal, as in the app.
async function seedDevice(lists: number) {
  const repo = createLocalListRepository({ requestPersistence: () => {} })
  for (let n = 0; n < lists; n++) await repo.createList(`List ${n}`)
}

async function mountBanner() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)', component: { template: '<div />' } }],
  })
  await router.push('/lists')
  const wrapper = mount(BackupReminder, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => localStorage.clear())

describe('BackupReminder', () => {
  it("isn't shown with a single list", async () => {
    await seedDevice(1)
    const wrapper = await mountBanner()
    expect(wrapper.find('[data-testid="backup-reminder"]').exists()).toBe(false)
  })

  it('offers sign-in and a backup file once there are two lists', async () => {
    await seedDevice(2)
    const wrapper = await mountBanner()

    expect(wrapper.text()).toContain('Keep your lists safe')
    expect(wrapper.text()).toContain('Your 2 lists are saved in this browser only.')
    expect(wrapper.text()).toContain('Sign in or create a FREE account to keep them safe')
    // Plain /login and /signup: after sign-in the app lands on /lists, where the
    // claim dialog opens.
    const links = Object.fromEntries(
      wrapper.findAll('a').map((a) => [a.text(), a.attributes('href')]),
    )
    expect(links['Sign in']).toBe('/login')
    expect(links['create a FREE account']).toBe('/signup')
    expect(wrapper.findAll('button').map((b) => b.text())).toContain('Export a backup')
  })

  it('goes away when dismissed, and stays away on the next page', async () => {
    await seedDevice(2)
    const wrapper = await mountBanner()

    await wrapper.get('button[aria-label="Dismiss reminder"]').trigger('click')

    expect(wrapper.find('[data-testid="backup-reminder"]').exists()).toBe(false)
    expect(localStorage.getItem(REMINDER_DISMISSED_KEY)).not.toBeNull()
    const next = await mountBanner()
    expect(next.find('[data-testid="backup-reminder"]').exists()).toBe(false)
  })
})
