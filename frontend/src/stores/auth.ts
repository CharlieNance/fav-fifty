import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, apiFetch } from '@/api/client'

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

  function logout(): void {
    user.value = null
    // TODO: call the backend to clear the session cookie once it exists.
  }

  return { user, isReady, isAuthenticated, fetchMe, logout }
})
