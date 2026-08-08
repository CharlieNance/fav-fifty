/**
 * Minimal typed fetch wrapper — the single seam through which the app talks to
 * the backend. Kept deliberately tiny (no axios) until we actually need more.
 *
 * Base URL is `/api` by default, which the Vite dev server proxies to FastAPI
 * (see vite.config.ts). `credentials: 'include'` sends the session cookie once
 * auth lands. When we add real endpoints we'll generate request/response types
 * from the backend's OpenAPI schema and layer them on top of this helper.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

/**
 * Absolute URL for a backend `path`, honoring the same base as {@link apiFetch}.
 * Use for full-page navigations (e.g. the OAuth redirect) where `fetch` isn't
 * involved. Works whether `BASE_URL` is relative (`/api`, dev) or an absolute
 * origin (prod): a relative base resolves against the current origin, and an
 * absolute base makes the second `URL` argument a no-op.
 */
export function apiUrl(path: string): URL {
  const base = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(`${base}${normalizedPath}`, window.location.origin)
}

export class ApiError extends Error {
  readonly status: number
  /**
   * The backend's human-readable `detail` string, when the error body had one
   * (FastAPI's `HTTPException(detail=...)` shape). UI code can show this
   * directly for statuses where the backend writes user-facing copy (e.g. the
   * 409s from items: "This list already has 50 items."), and fall back to its
   * own generic message when it's null.
   */
  readonly detail: string | null

  constructor(status: number, message: string, detail: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/** Best-effort extraction of FastAPI's `{ "detail": "..." }` from an error body. */
async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
    }
  } catch {
    // Not JSON (or empty) — fine, the caller falls back to a generic message.
  }
  return null
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    const headers = new Headers(options.headers)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    })

    if (!response.ok) {
      throw new ApiError(
        response.status,
        `Request to ${path} failed with ${response.status}`,
        await readErrorDetail(response),
      )
    }

    // 204 No Content has no body to parse.
    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status !== 401) {
        console.error(`API error: ${error.message}`)
      }

      throw error
    }

    throw new Error(`Network error while fetching ${path}: ${error}`)
  }
}
