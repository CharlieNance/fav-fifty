import { ref } from 'vue'
import { defineStore } from 'pinia'

import { apiFetch } from '@/api/client'

/**
 * The limits served by `GET /config/client` (snake_case, matching the wire). See
 * backend `app/schemas/config.py`: `max_tags_per_list` is a runtime setting, the
 * rest are the fixed limits from `app/core/limits.py`.
 */
export interface ClientLimits {
  max_tags_per_list: number
  max_items_per_list: number
  max_title_length: number
  max_item_text_length: number
  max_note_length: number
  max_image_url_length: number
  max_tag_length: number
}

/**
 * Bundled copy of the backend's defaults, used until (or instead of) the server's
 * values. Anonymous use must keep working offline or when the API is down, so the
 * app never waits on the request.
 */
export const DEFAULT_LIMITS: Readonly<ClientLimits> = Object.freeze({
  max_tags_per_list: 25,
  max_items_per_list: 50,
  max_title_length: 200,
  max_item_text_length: 500,
  max_note_length: 2000,
  max_image_url_length: 2048,
  max_tag_length: 50,
})

/**
 * Keep each served value only if it's a positive integer, and fall back to its
 * default otherwise. One bad field (or an older server missing a field) can't
 * break the others.
 */
export function mergeLimits(served: unknown): ClientLimits {
  const merged: ClientLimits = { ...DEFAULT_LIMITS }
  if (!served || typeof served !== 'object') return merged
  const source = served as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ClientLimits)[]) {
    const value = source[key]
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      merged[key] = value
    }
  }
  return merged
}

export const useClientConfigStore = defineStore('clientConfig', () => {
  const limits = ref<ClientLimits>({ ...DEFAULT_LIMITS })
  // True once the server's values have arrived. Defaults are in effect until then.
  const isLoaded = ref(false)
  let inFlight: Promise<void> | null = null

  /**
   * Fetch the server's limits once. Safe to call repeatedly: concurrent calls share
   * one request, and a successful load isn't repeated. Never throws. On failure the
   * defaults stay in effect and a later call retries.
   */
  function load(): Promise<void> {
    if (isLoaded.value) return Promise.resolve()
    inFlight ??= (async () => {
      try {
        const config = await apiFetch<{ limits?: unknown }>('/config/client')
        limits.value = mergeLimits(config?.limits)
        isLoaded.value = true
      } catch {
        console.warn('Could not load client config; using bundled defaults.')
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return { limits, isLoaded, load }
})
