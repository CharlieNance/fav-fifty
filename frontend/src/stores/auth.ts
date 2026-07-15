import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, apiFetch, apiUrl } from '@/api/client'

/**
 * The current user as the frontend sees it. Mirrors the standard OIDC claims
 * the backend exposes (see docs/DECISIONS.md §Auth seam) — the frontend never
 * knows whether that identity came from the local dev stub or real Cognito.
 */
export interface User {
  id: string
  displayName: string
  avatarUrl: string | null
}

/**
 * Central auth/session state. This is the one piece of truly global state we
 * know we need on day one. `fetchMe()` will call the protected `GET /me`
 * endpoint once it exists; for now the store just holds the shape.
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  // Whether we've checked the session at least once (so guards can wait).
  const isReady = ref(false)

  const isAuthenticated = computed(() => user.value !== null)

  async function fetchMe(): Promise<void> {
    try {
      user.value = await apiFetch<User>('/me')
    } catch (error) {
      // 401 = not logged in; anything else is a real failure worth surfacing.
      if (error instanceof ApiError && error.status === 401) {
        user.value = null
      } else {
        throw error
      }
    } finally {
      isReady.value = true
    }
  }

  /**
   * Development-only login: mint a session for the fixed dev identity via the
   * backend's `POST /auth/dev-login` stub (which 404s outside development). The
   * real flow is {@link loginWithGoogle}; this exists so the whole app can be
   * exercised locally before Cognito is wired.
   */
  async function devLogin(): Promise<void> {
    user.value = await apiFetch<User>('/auth/dev-login', { method: 'POST' })
    isReady.value = true
  }

  /**
   * Real login: hand the browser off to the backend, which builds the Cognito
   * (Google) authorize URL and redirects there. This is a full-page navigation,
   * not a fetch — the OAuth dance ends by redirecting back to `redirect`.
   */
  function loginWithGoogle(redirect?: string): void {
    const url = apiUrl('/auth/login')
    if (redirect) {
      url.searchParams.set('redirect', redirect)
    }
    window.location.assign(url.toString())
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // Best-effort: a failed logout call shouldn't surface as an error to the
      // user who just clicked "Log out". We clear local state regardless below.
    } finally {
      // Never leave the UI looking signed in once the user asked to log out.
      user.value = null
    }
  }

  return { user, isReady, isAuthenticated, fetchMe, devLogin, loginWithGoogle, logout }
})
