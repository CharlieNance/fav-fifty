import { ref } from 'vue'
import { defineStore } from 'pinia'

import { apiFetch } from '@/api/client'

/**
 * The limits served by `GET /config/client` (snake_case, matching the wire). See
 * backend `app/schemas/config.py`: `max_tags_per_list`, `max_lists_per_user`,
 * `max_lists_per_import` and `max_import_bytes` are runtime settings, the rest are the fixed limits from `app/core/limits.py`.
 */
export interface ClientLimits {
  max_tags_per_list: number
  /** Most lists one account (or this device) may hold. Creating and importing both count. */
  max_lists_per_user: number
  /** Most lists one `POST /lists/import` may carry (the claim dialog, an account's file import). */
  max_lists_per_import: number
  /** Largest import file (or `POST /lists/import` body) accepted, in bytes. */
  max_import_bytes: number
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
  max_lists_per_user: 100,
  max_lists_per_import: 100,
  max_import_bytes: 5 * 1024 * 1024,
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

/** The switches served by `GET /config/client`. */
export interface ClientFeatures {
  /** Send analytics events (`POST /events`). Off until the server says otherwise. */
  events_enabled: boolean
}

/** Optional features stay off until the server turns them on. */
export const DEFAULT_FEATURES: Readonly<ClientFeatures> = Object.freeze({
  events_enabled: false,
})

/** Keep each served switch only if it's a boolean (an older server may not send it). */
export function mergeFeatures(served: unknown): ClientFeatures {
  const merged: ClientFeatures = { ...DEFAULT_FEATURES }
  if (!served || typeof served !== 'object') return merged
  const source = served as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_FEATURES) as (keyof ClientFeatures)[]) {
    if (typeof source[key] === 'boolean') merged[key] = source[key]
  }
  return merged
}

export const useClientConfigStore = defineStore('clientConfig', () => {
  const limits = ref<ClientLimits>({ ...DEFAULT_LIMITS })
  const features = ref<ClientFeatures>({ ...DEFAULT_FEATURES })
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
        const config = await apiFetch<{ limits?: unknown; features?: unknown }>('/config/client')
        limits.value = mergeLimits(config?.limits)
        features.value = mergeFeatures(config?.features)
        isLoaded.value = true
      } catch {
        console.warn('Could not load client config; using bundled defaults.')
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return { limits, features, isLoaded, load }
})
