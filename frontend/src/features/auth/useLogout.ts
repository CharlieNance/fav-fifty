import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toasts'

/**
 * The "Log out" action: end the session, leave anywhere that needed it, say so.
 *
 * The navigation is the point. Clearing the session alone left the user sitting
 * on `/lists` reading lists they were no longer signed in to see — the page only
 * corrected itself on the next navigation, when the auth guard bounced them to
 * login. Going home instead makes logging out look like it did something.
 *
 * Home (not login): logging out is not a prelude to logging back in.
 */
export function useLogout() {
  const router = useRouter()
  const auth = useAuthStore()
  const toasts = useToastStore()

  async function logout(): Promise<void> {
    await auth.logout()
    await router.push({ name: 'home' })
    toasts.show('You’ve been logged out.')
  }

  return { logout }
}
