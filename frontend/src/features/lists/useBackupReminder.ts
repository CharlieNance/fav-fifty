/**
 * The backup reminder (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Where it's stored):
 * a gentle banner for anonymous visitors who have put enough into this device
 * that losing it would hurt. Device lists vanish when browser data is cleared,
 * and Safari deletes them after a week without a visit, so it points at the two
 * ways to keep them: sign in (the claim dialog then brings them along) or export
 * a backup file.
 *
 * - **Shown at 2+ lists or 20+ items**, anonymous only. Below that there's little
 *   to lose and the "Saved on this device only" note is enough.
 * - **Dismissing hides it for 14 days**, then it comes back if there's still
 *   something to lose. The time is kept in `localStorage` (in memory if that's
 *   blocked). It's a per-device nicety, so it isn't part of the lists document.
 * - **It follows the device's lists live:** this tab's saves (`localListsRevision`),
 *   other tabs' (`storage` events), and signing in or out.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useAuthStore } from '@/stores/auth'
import { createDocumentStore, type DocumentStore, localListsRevision } from './localListDocument'

export const REMIND_AT_LISTS = 2
export const REMIND_AT_ITEMS = 20
export const REMINDER_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

/** `localStorage` key holding when the reminder was last dismissed (ISO time). */
export const REMINDER_DISMISSED_KEY = 'favfifty:backup-reminder-dismissed'

export interface DeviceTotals {
  lists: number
  items: number
}

/** Whether the device holds enough to be worth a reminder. */
export function worthReminding({ lists, items }: DeviceTotals): boolean {
  return lists >= REMIND_AT_LISTS || items >= REMIND_AT_ITEMS
}

/** Whether a dismissal at `dismissedAt` (ISO, or null) still holds at `now`. */
export function isSnoozed(dismissedAt: string | null, now: number): boolean {
  if (!dismissedAt) return false
  const at = Date.parse(dismissedAt)
  // A garbled value, or one from the future (a changed clock), doesn't count.
  return !Number.isNaN(at) && at <= now && now - at < REMINDER_SNOOZE_MS
}

export interface BackupReminderOptions {
  store?: DocumentStore
  /** Where the dismissal is kept. A getter, because touching `localStorage` can throw. */
  storage?: () => Storage
  now?: () => number
}

export function useBackupReminder(options: BackupReminderOptions = {}) {
  const store = options.store ?? createDocumentStore()
  const storage = options.storage ?? (() => window.localStorage)
  const now = options.now ?? (() => Date.now())
  const auth = useAuthStore()

  const totals = ref<DeviceTotals>({ lists: 0, items: 0 })
  const dismissedAt = ref<string | null>(readDismissed())

  function readDismissed(): string | null {
    try {
      return storage().getItem(REMINDER_DISMISSED_KEY)
    } catch {
      return null
    }
  }

  function refresh(): void {
    if (auth.isAuthenticated) return
    try {
      const lists = store.load()?.lists ?? []
      totals.value = {
        lists: lists.length,
        items: lists.reduce((sum, list) => sum + list.items.length, 0),
      }
    } catch {
      // Storage blocked: the page already says so, and there's nothing to back up.
      totals.value = { lists: 0, items: 0 }
    }
  }

  const visible = computed(
    () =>
      !auth.isAuthenticated && worthReminding(totals.value) && !isSnoozed(dismissedAt.value, now()),
  )

  function dismiss(): void {
    const at = new Date(now()).toISOString()
    dismissedAt.value = at
    try {
      storage().setItem(REMINDER_DISMISSED_KEY, at)
    } catch {
      // Blocked: hidden until the page is reloaded.
    }
  }

  function onStorage(event: StorageEvent): void {
    if (event.key === REMINDER_DISMISSED_KEY) dismissedAt.value = readDismissed()
    else refresh()
  }

  watch([localListsRevision, () => auth.isAuthenticated], refresh)
  onMounted(() => {
    refresh()
    window.addEventListener('storage', onStorage)
  })
  onUnmounted(() => window.removeEventListener('storage', onStorage))

  return { visible, totals, dismiss }
}
