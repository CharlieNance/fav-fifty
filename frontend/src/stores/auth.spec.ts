import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

// Mock the network seam but keep the real `apiUrl`/`ApiError` so URL building and
// error-type checks still exercise real code.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

// Imported after the mock so we get the mocked function.
import { apiFetch } from '@/api/client'
const apiFetchMock = vi.mocked(apiFetch)

const DEV_USER = { id: 'dev', displayName: 'Dev User', avatarUrl: null }

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchMe', () => {
    it('sets the user on success', async () => {
      apiFetchMock.mockResolvedValueOnce(DEV_USER)
      const auth = useAuthStore()

      await auth.fetchMe()

      expect(auth.user).toEqual(DEV_USER)
      expect(auth.isAuthenticated).toBe(true)
      expect(auth.isReady).toBe(true)
    })

    it('treats a 401 as logged out, not an error', async () => {
      apiFetchMock.mockRejectedValueOnce(new ApiError(401, 'nope'))
      const auth = useAuthStore()

      await auth.fetchMe()

      expect(auth.user).toBeNull()
      expect(auth.isReady).toBe(true)
    })

    it('re-throws non-401 errors', async () => {
      apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
      const auth = useAuthStore()

      await expect(auth.fetchMe()).rejects.toThrow()
      expect(auth.isReady).toBe(true)
    })
  })

  describe('devLogin', () => {
    it('POSTs to /auth/dev-login and stores the user', async () => {
      apiFetchMock.mockResolvedValueOnce(DEV_USER)
      const auth = useAuthStore()

      await auth.devLogin()

      expect(apiFetchMock).toHaveBeenCalledWith('/auth/dev-login', { method: 'POST' })
      expect(auth.user).toEqual(DEV_USER)
      expect(auth.isReady).toBe(true)
    })
  })

  describe('logout', () => {
    it('POSTs to /auth/logout and clears the user', async () => {
      apiFetchMock.mockResolvedValueOnce(undefined)
      const auth = useAuthStore()
      auth.user = DEV_USER

      await auth.logout()

      expect(apiFetchMock).toHaveBeenCalledWith('/auth/logout', { method: 'POST' })
      expect(auth.user).toBeNull()
    })

    it('clears local state even if the backend call fails', async () => {
      apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
      const auth = useAuthStore()
      auth.user = DEV_USER

      await auth.logout()

      expect(auth.user).toBeNull()
    })
  })

  describe('loginWithGoogle', () => {
    // jsdom's `window.location.assign` is non-configurable and can't be spied on,
    // so swap the whole location object for these tests and restore it after.
    let assign: ReturnType<typeof vi.fn>
    let original: Location

    beforeEach(() => {
      original = window.location
      assign = vi.fn()
      delete (window as unknown as { location?: Location }).location
      ;(window as unknown as { location: unknown }).location = { origin: original.origin, assign }
    })

    afterEach(() => {
      ;(window as unknown as { location: Location }).location = original
    })

    it('navigates to the backend login URL, forwarding the redirect', () => {
      const auth = useAuthStore()

      auth.loginWithGoogle('/lists/new')

      expect(assign).toHaveBeenCalledOnce()
      const url = new URL(assign.mock.calls[0][0] as string)
      expect(url.pathname).toBe('/api/auth/login')
      expect(url.searchParams.get('redirect')).toBe('/lists/new')
    })

    it('omits the redirect param when none is given', () => {
      const auth = useAuthStore()

      auth.loginWithGoogle()

      const url = new URL(assign.mock.calls[0][0] as string)
      expect(url.searchParams.has('redirect')).toBe(false)
    })
  })
})
