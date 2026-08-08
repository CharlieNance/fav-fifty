import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, ApiError } from './client'

const fetchMock = vi.fn()

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    // apiFetch logs non-401 API errors; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the parsed JSON body on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await expect(apiFetch('/things')).resolves.toEqual({ ok: true })
  })

  it('returns undefined for a 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(apiFetch<void>('/things', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it("carries the backend's `detail` string on the ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'This list already has 50 items.' }), { status: 409 }),
    )

    const error = await apiFetch('/things').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).detail).toBe('This list already has 50 items.')
  })

  it('leaves detail null when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>nope</html>', { status: 500 }))

    const error = await apiFetch('/things').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).detail).toBeNull()
  })

  it('leaves detail null when the JSON has no string `detail`', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: [{ loc: ['body'] }] }), { status: 422 }),
    )

    const error = await apiFetch('/things').catch((caught: unknown) => caught)

    expect((error as ApiError).detail).toBeNull()
  })
})
