/**
 * First-party product events (docs/ARCHITECTURE.md §Analytics).
 *
 * Anonymous visitors' lists live on their device, so the server only hears what
 * they do through these events. The rules:
 *
 * - **Nothing is sent until `/config/client` says `events_enabled`.** Events
 *   tracked before that wait in memory; if it says no (or can't be reached), they're
 *   dropped and nothing more is kept.
 * - **Batched.** Events go out a few seconds after the first one queues, when the
 *   batch fills up, and when the page is hidden (tab switch, close, the Google
 *   sign-in redirect), via `fetch(..., { keepalive: true })` so a closing page can
 *   still send.
 * - **No free text, ever.** Only names from {@link EVENT_NAMES} with fixed property
 *   values. The server enforces its own allowlist too
 *   (backend `app/services/analytics_service.py`).
 * - **No user id from here.** The server attaches it from the session cookie when
 *   someone is signed in.
 * - **Best effort.** A failed send is dropped, never retried or shown to the user.
 */
import { apiUrl } from '@/api/client'

/** Keep in step with `EVENT_PROPS` in the backend's analytics service. */
export const EVENT_NAMES = [
  'session_start',
  'list_created',
  'item_added',
  'catalog_search',
  'catalog_pick',
  'export_file',
  'import_started',
  'import_succeeded',
  'sign_in_started',
  'sign_in_succeeded',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

/** Where an import's lists went: this device, the account (a file), or the sign-in claim. */
export type ImportTarget = 'device' | 'account' | 'claim'
export type SignInProvider = 'google' | 'dev'

/** Each event's allowed properties. Events not listed here take none. */
interface EventPropsByName {
  import_started: { target: ImportTarget }
  import_succeeded: { target: ImportTarget }
  sign_in_started: { provider: SignInProvider }
  sign_in_succeeded: { provider: SignInProvider }
}

type PropsFor<N extends EventName> = N extends keyof EventPropsByName
  ? [props: EventPropsByName[N]]
  : []

interface QueuedEvent {
  name: EventName
  at: string
  props?: Record<string, string>
}

/** The body of `POST /events` (backend `app/schemas/events.py`). */
export interface EventBatch {
  session_id: string
  platform: 'web'
  app_version: string
  events: QueuedEvent[]
}

/** `sessionStorage` key for this tab session's random id. */
export const SESSION_KEY = 'favfifty:analytics-session'
/** `sessionStorage` key noting a sign-in that was started and hasn't landed yet. */
export const PENDING_SIGN_IN_KEY = 'favfifty:sign-in-pending'

/** The server takes at most 50 events a batch. */
export const MAX_BATCH = 50
/** Oldest events are dropped past this, so a long offline session can't grow forever. */
export const MAX_QUEUE = 200
export const FLUSH_DELAY_MS = 5_000

export interface AnalyticsOptions {
  /** Hands one JSON batch to the network. */
  send?: (body: string) => void
  session?: () => Storage
  now?: () => Date
  newId?: () => string
  appVersion?: string
}

function sendWithFetch(body: string): void {
  fetch(apiUrl('/events'), {
    method: 'POST',
    body,
    keepalive: true,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {
    // Best effort: analytics never bothers the user.
  })
}

function envAppVersion(): string {
  const version = import.meta.env.VITE_APP_VERSION as string | undefined
  return version && /^[0-9A-Za-z.+_-]{1,32}$/.test(version) ? version : 'dev'
}

export function createAnalytics(options: AnalyticsOptions = {}) {
  const send = options.send ?? sendWithFetch
  const session = options.session ?? (() => window.sessionStorage)
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => crypto.randomUUID())
  const appVersion = options.appVersion ?? envAppVersion()

  let state: 'pending' | 'on' | 'off' = 'pending'
  let queue: QueuedEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let sessionId: string | null = null
  // Backs up sessionStorage when the browser blocks it.
  let pendingSignIn: SignInProvider | null = null

  function readSession(key: string): string | null {
    try {
      return session().getItem(key)
    } catch {
      return null
    }
  }

  function writeSession(key: string, value: string | null): void {
    try {
      if (value === null) session().removeItem(key)
      else session().setItem(key, value)
    } catch {
      // Blocked: the in-memory copy lasts until the page is reloaded.
    }
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function schedule(): void {
    if (state !== 'on' || timer !== null || queue.length === 0) return
    timer = setTimeout(flush, FLUSH_DELAY_MS)
  }

  /** Send everything queued now (if sending is on). */
  function flush(): void {
    clearTimer()
    if (state !== 'on' || queue.length === 0 || sessionId === null) return
    while (queue.length > 0) {
      const batch: EventBatch = {
        session_id: sessionId,
        platform: 'web',
        app_version: appVersion,
        events: queue.splice(0, MAX_BATCH),
      }
      send(JSON.stringify(batch))
    }
  }

  function track<N extends EventName>(name: N, ...[props]: PropsFor<N>): void {
    if (state === 'off') return
    sessionId ??= readSession(SESSION_KEY) ?? newId()
    const event: QueuedEvent = { name, at: now().toISOString() }
    if (props) event.props = { ...props }
    queue.push(event)
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
    if (state === 'on' && queue.length >= MAX_BATCH) flush()
    else schedule()
  }

  /**
   * Once per tab session: pick up this tab's id, or make one and send
   * `session_start`. A reload in the same tab is the same session.
   */
  function startSession(): void {
    const existing = readSession(SESSION_KEY)
    if (existing) {
      sessionId = existing
      return
    }
    sessionId = newId()
    writeSession(SESSION_KEY, sessionId)
    track('session_start')
  }

  /** What `/config/client` said. Off drops what's queued and stops collecting. */
  function setEnabled(enabled: boolean): void {
    state = enabled ? 'on' : 'off'
    if (enabled) {
      schedule()
    } else {
      clearTimer()
      queue = []
    }
  }

  /**
   * A sign-in is starting. The Google one leaves the page, so whether it worked is
   * only known after the redirect back: {@link noteSignedIn} finishes it.
   */
  function noteSignInStarted(provider: SignInProvider): void {
    track('sign_in_started', { provider })
    pendingSignIn = provider
    writeSession(PENDING_SIGN_IN_KEY, provider)
  }

  /** Someone is signed in. Counts a success only for a sign-in this tab started. */
  function noteSignedIn(): void {
    const stored = readSession(PENDING_SIGN_IN_KEY)
    const provider = stored === 'google' || stored === 'dev' ? stored : pendingSignIn
    if (!provider) return
    pendingSignIn = null
    writeSession(PENDING_SIGN_IN_KEY, null)
    track('sign_in_succeeded', { provider })
  }

  /** Flush when the page is hidden or unloads: the last chance to send. */
  function flushWhenHidden(win: Window = window): void {
    win.document.addEventListener('visibilitychange', () => {
      if (win.document.visibilityState === 'hidden') flush()
    })
    win.addEventListener('pagehide', flush)
  }

  /** Test seam: what's waiting to be sent. */
  function pending(): readonly QueuedEvent[] {
    return queue
  }

  return {
    track,
    flush,
    startSession,
    setEnabled,
    noteSignInStarted,
    noteSignedIn,
    flushWhenHidden,
    pending,
  }
}

export type Analytics = ReturnType<typeof createAnalytics>

/** The app's one queue. Inert until `main.ts` starts it and the config switches it on. */
export const analytics = createAnalytics()

/** Shorthand for `analytics.track`. */
export function track<N extends EventName>(name: N, ...props: PropsFor<N>): void {
  analytics.track(name, ...props)
}
