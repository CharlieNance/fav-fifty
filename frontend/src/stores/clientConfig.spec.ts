import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { DEFAULT_LIMITS, mergeLimits, useClientConfigStore } from '@/stores/clientConfig'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

// Imported after the mock so we get the mocked function.
import { apiFetch } from '@/api/client'
const apiFetchMock = vi.mocked(apiFetch)

const SERVED = {
  max_tags_per_list: 7,
  max_lists_per_import: 40,
  max_import_bytes: 1_000_000,
  max_items_per_list: 50,
  max_title_length: 120,
  max_item_text_length: 300,
  max_note_length: 1000,
  max_image_url_length: 1024,
  max_tag_length: 30,
}

describe('mergeLimits', () => {
  it('takes every valid served value', () => {
    expect(mergeLimits(SERVED)).toEqual(SERVED)
  })

  it('falls back per field for missing, non-integer or non-positive values', () => {
    const merged = mergeLimits({
      max_tags_per_list: 7,
      max_title_length: '120',
      max_item_text_length: 0,
      max_note_length: 2.5,
      max_tag_length: -1,
      // max_items_per_list and max_image_url_length missing (e.g. an older server)
    })

    expect(merged).toEqual({ ...DEFAULT_LIMITS, max_tags_per_list: 7 })
  })

  it.each([null, undefined, 'nope', 42])('uses all defaults for %s', (served) => {
    expect(mergeLimits(served)).toEqual(DEFAULT_LIMITS)
  })
})

describe('client config store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with the bundled defaults, before anything loads', () => {
    const store = useClientConfigStore()

    expect(store.limits).toEqual(DEFAULT_LIMITS)
    expect(store.isLoaded).toBe(false)
  })

  it('loads the served limits from /config/client', async () => {
    apiFetchMock.mockResolvedValue({ limits: SERVED })
    const store = useClientConfigStore()

    await store.load()

    expect(apiFetchMock).toHaveBeenCalledWith('/config/client')
    expect(store.limits).toEqual(SERVED)
    expect(store.isLoaded).toBe(true)
  })

  it('keeps the defaults and does not throw when the request fails', async () => {
    apiFetchMock.mockRejectedValue(new Error('Network error'))
    const store = useClientConfigStore()

    await expect(store.load()).resolves.toBeUndefined()

    expect(store.limits).toEqual(DEFAULT_LIMITS)
    expect(store.isLoaded).toBe(false)
  })

  it('shares one request between concurrent calls and does not refetch after success', async () => {
    apiFetchMock.mockResolvedValue({ limits: SERVED })
    const store = useClientConfigStore()

    await Promise.all([store.load(), store.load()])
    await store.load()

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on a later call after a failure', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ limits: SERVED })
    const store = useClientConfigStore()

    await store.load()
    await store.load()

    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(store.limits).toEqual(SERVED)
  })
})
