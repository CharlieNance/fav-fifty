import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

/** Where "start a list" ultimately goes once the user is authenticated. */
export const CREATE_LIST_PATH = '/lists/new'

/**
 * The "Start a list" action, shared by the header button and the hero CTA.
 *
 * Design decision (docs/DESIGN.md): the button is always visible, but the
 * ACTION is gated. Logged-in users go straight to create-a-list; logged-out
 * users are routed to login with `redirect` preserved, so after signing in they
 * continue where they intended instead of landing back on the homepage.
 */
export function useStartList() {
  const router = useRouter()
  const auth = useAuthStore()

  function startList() {
    if (auth.isAuthenticated) {
      void router.push(CREATE_LIST_PATH)
    } else {
      void router.push({ name: 'login', query: { redirect: CREATE_LIST_PATH } })
    }
  }

  return { startList }
}
