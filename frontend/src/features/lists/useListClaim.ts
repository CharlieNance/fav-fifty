/**
 * Claim on sign-in (docs/ARCHITECTURE.md §Claim on sign-in): when
 * someone signs in with lists still saved on this device, offer to add them to the
 * account. `ClaimListsDialog.vue` is the UI; this store holds the state and does
 * the work.
 *
 * - **Nothing moves without a click.** `offer()` only opens the dialog. Every list
 *   starts checked, and the user picks which to bring.
 * - **One request, all or nothing** (`POST /lists/import`). If a list breaks a rule,
 *   the server names it, nothing is written, and the dialog stays open so the user
 *   can uncheck it and try again.
 * - **Idempotent.** The upload is keyed on the device's own `device_id` and each
 *   list's `local_id`, so a retry after a lost response (or a device copy that
 *   couldn't be cleared) brings back the lists the first attempt made instead of
 *   duplicating them.
 * - **After a claim the uploaded lists leave the device** (Q12) and `claimed_at` is
 *   set. Unchecked lists stay, and are offered again on the next sign-in.
 * - **"Not now" holds for this browser session.** Reloading the page while signed
 *   in doesn't ask again; signing out and in, or a new session, does. It's kept in
 *   `sessionStorage` (and in memory, if that's blocked).
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'

import { track } from '@/analytics/events'
import { useClientConfigStore } from '@/stores/clientConfig'
import { useToastStore } from '@/stores/toasts'
import { type ListError, toListError } from './listErrors'
import { type AccountImport, apiListRepository } from './listRepository'
import { createDocumentStore, type DocumentStore, type LocalList } from './localListDocument'
import {
  claimSummaryMessage,
  IMPORT_REJECTED_DETAIL,
  SIGN_IN_AGAIN_DETAIL,
  summarizeAccountImport,
  tooManyListsDetail,
} from './localListTransfer'

/** `sessionStorage` key holding the id of the user who chose "Not now". */
export const CLAIM_DISMISSED_KEY = 'favfifty:claim-dismissed'

export const CLAIM_FAILED_MESSAGE = "Couldn't add your lists. Check your connection and try again."

export interface ListClaimDeps {
  store: DocumentStore
  account: AccountImport
  session: () => Storage
  now: () => string
}

function defaultDeps(): ListClaimDeps {
  const now = () => new Date().toISOString()
  return {
    store: createDocumentStore({ now }),
    account: apiListRepository,
    session: () => window.sessionStorage,
    now,
  }
}

let depsOverride: Partial<ListClaimDeps> | null = null

/** Test seam: replace some of the claim's I/O (pass `null` to go back to the defaults). */
export function setListClaimDeps(deps: Partial<ListClaimDeps> | null): void {
  depsOverride = deps
}

function deps(): ListClaimDeps {
  return { ...defaultDeps(), ...depsOverride }
}

/**
 * What the dialog says when the upload fails. Only a failure that retrying might
 * fix gets "check your connection".
 */
function claimErrorMessage(listError: ListError): string {
  switch (listError.kind) {
    case 'unauthenticated':
      return SIGN_IN_AGAIN_DETAIL
    case 'invalid':
      return listError.detail ?? IMPORT_REJECTED_DETAIL
    case 'storage':
    case 'rate-limited':
      return listError.detail ?? CLAIM_FAILED_MESSAGE
    default:
      return CLAIM_FAILED_MESSAGE
  }
}

/** Most recently updated first, as the lists page shows them. */
function newestFirst(lists: LocalList[]): LocalList[] {
  return [...lists].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
}

export const useListClaimStore = defineStore('listClaim', () => {
  /** The device's lists on offer while the dialog is open; empty when it's closed. */
  const candidates = ref<LocalList[]>([])
  const isOpen = ref(false)
  const pending = ref(false)
  const error = ref<string | null>(null)
  /** Goes up after each successful claim, so pages showing lists know to reload. */
  const claimCount = ref(0)
  // Backs up `sessionStorage` when the browser blocks it.
  let dismissedFor: string | null = null

  function readDismissed(): string | null {
    try {
      return deps().session().getItem(CLAIM_DISMISSED_KEY)
    } catch {
      return dismissedFor
    }
  }

  function writeDismissed(userId: string | null): void {
    dismissedFor = userId
    try {
      const session = deps().session()
      if (userId === null) session.removeItem(CLAIM_DISMISSED_KEY)
      else session.setItem(CLAIM_DISMISSED_KEY, userId)
    } catch {
      // Blocked: the in-memory copy lasts until the page is reloaded.
    }
  }

  function close(): void {
    isOpen.value = false
    candidates.value = []
    error.value = null
  }

  /**
   * `userId` just signed in (or a signed-in page loaded). Open the dialog if this
   * device has lists, unless they said "Not now" earlier in this session.
   */
  function offer(userId: string): void {
    if (readDismissed() === userId) return
    let lists: LocalList[]
    try {
      lists = deps().store.load()?.lists ?? []
    } catch {
      // Storage blocked or from a newer app version: nothing we can offer.
      return
    }
    if (lists.length === 0) return
    candidates.value = newestFirst(lists)
    error.value = null
    isOpen.value = true
  }

  /** "Not now": close, and don't ask again until the next sign-in. */
  function dismiss(userId: string | null): void {
    if (pending.value) return
    close()
    if (userId) writeDismissed(userId)
  }

  /** Signed out: close the dialog, and forget "Not now" so the next sign-in asks again. */
  function reset(): void {
    close()
    pending.value = false
    writeDismissed(null)
  }

  /**
   * Upload the lists with these `local_id`s to the account, then take them off the
   * device. Resolves to true on success. On failure `error` says why and the
   * dialog stays open.
   */
  async function claim(localIds: string[], userId: string): Promise<boolean> {
    const { store, account, now } = deps()
    const max = useClientConfigStore().limits.max_lists_per_import
    if (localIds.length === 0 || pending.value) return false
    if (localIds.length > max) {
      error.value = tooManyListsDetail(max)
      return false
    }

    pending.value = true
    error.value = null
    track('import_started', { target: 'claim' })
    try {
      // Read fresh: another (anonymous) tab may have changed the device's lists
      // since the dialog opened.
      const doc = store.load()
      const wanted = new Set(localIds)
      const lists = doc?.lists.filter((list) => wanted.has(list.local_id)) ?? []
      if (!doc || lists.length === 0) {
        close()
        return false
      }

      const result = await account.importLists({ device_id: doc.device_id, lists })
      clearClaimed(store, new Set(result.lists.map((outcome) => outcome.local_id)), now)

      track('import_succeeded', { target: 'claim' })
      close()
      // Whatever is still on the device was left unchecked: offer it next sign-in.
      writeDismissed(userId)
      claimCount.value++
      useToastStore().show(claimSummaryMessage(summarizeAccountImport(result)), {
        variant: 'success',
      })
      return true
    } catch (caught) {
      error.value = claimErrorMessage(toListError(caught))
      return false
    } finally {
      pending.value = false
    }
  }

  return { candidates, isOpen, pending, error, claimCount, offer, dismiss, reset, claim }
})

/**
 * Take the uploaded lists off the device and record when (Q12). Best effort: they're
 * in the account already, so if storage won't take the write they're offered again
 * next time, and the idempotent import hands back the same lists without
 * duplicating them.
 */
function clearClaimed(store: DocumentStore, claimed: Set<string>, now: () => string): void {
  try {
    const doc = store.load()
    if (!doc) return
    doc.lists = doc.lists.filter((list) => !claimed.has(list.local_id))
    doc.claimed_at = now()
    store.save(doc)
  } catch {
    console.warn('Added the lists to the account, but could not remove them from this device.')
  }
}
