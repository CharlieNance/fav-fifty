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

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
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
      throw new ApiError(response.status, `Request to ${path} failed with ${response.status}`)
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
