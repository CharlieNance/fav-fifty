import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useListModalsStore } from './useListModals'

/**
 * Where an unauthenticated "start a list" click resumes after login: the index,
 * with a flag telling `ListsView` to open the create modal itself once it lands
 * (there's no `/lists/new` page to redirect to anymore — see LISTS_CRUD_PLAN.md).
 */
export const START_LIST_REDIRECT = '/lists?openCreate=1'

/**
 * The "Start a list" action, shared by the header button and the hero CTA.
 *
 * Design decision (docs/DESIGN.md): the button is always visible, but the
 * ACTION is gated. Logged-in users get the create modal right where they
 * are — no navigation; logged-out users are routed to login with `redirect`
 * preserved, so after signing in they continue where they intended.
 */
export function useStartList() {
  const router = useRouter()
  const auth = useAuthStore()
  const modals = useListModalsStore()

  function startList() {
    if (auth.isAuthenticated) {
      modals.openCreate()
    } else {
      void router.push({ name: 'login', query: { redirect: START_LIST_REDIRECT } })
    }
  }

  return { startList }
}
