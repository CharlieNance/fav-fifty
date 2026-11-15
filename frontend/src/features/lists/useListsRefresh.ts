/**
 * Reloads what a lists page shows when the data behind it changes underneath it
 * (docs/ARCHITECTURE.md §Choosing storage):
 *
 * - **Signing in or out** switches the repository (`useListRepository`). The page
 *   reloads from the new one, so lists from one storage never show in the other.
 * - **Lists were claimed** into the account from the dialog after sign-in
 *   (`useListClaimStore`). The account has new lists to show.
 * - **Another tab changed this device's lists.** The browser fires a `storage`
 *   event in every *other* tab. The local repository has no cache to go stale (each
 *   call reads storage), so reloading what's on screen is all a tab has to do.
 *
 * Call it from a component's `setup`; the listener is removed on unmount.
 */
import { onMounted, onUnmounted, watch } from 'vue'

import { useAuthStore } from '@/stores/auth'
import { STORAGE_KEY } from './localListDocument'
import { useListClaimStore } from './useListClaim'

export function useListsRefresh(reload: () => void): void {
  const auth = useAuthStore()

  const claim = useListClaimStore()

  watch(
    () => auth.isAuthenticated,
    () => reload(),
  )

  watch(
    () => claim.claimCount,
    () => reload(),
  )

  function onStorage(event: StorageEvent): void {
    // `key` is null when another tab cleared all of storage.
    if (auth.isAuthenticated || (event.key !== STORAGE_KEY && event.key !== null)) return
    reload()
  }

  onMounted(() => window.addEventListener('storage', onStorage))
  onUnmounted(() => window.removeEventListener('storage', onStorage))
}
