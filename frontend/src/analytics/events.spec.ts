import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAnalytics,
  type EventBatch,
  FLUSH_DELAY_MS,
  MAX_BATCH,
  MAX_QUEUE,
  PENDING_SIGN_IN_KEY,
  SESSION_KEY,
} from './events'

/** A Storage in memory, or one that throws on every call (blocked by the browser). */
function memoryStorage(blocked = false): Storage {
  const data = new Map<string, string>()
  const guard = () => {
    if (blocked) throw new DOMException('blocked', 'SecurityError')
  }
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (guard(), data.get(key) ?? null),
    setItem: (key, value) => (guard(), void data.set(key, value)),
    removeItem: (key) => (guard(), void data.delete(key)),
  }
}

function setup(options: { storage?: Storage } = {}) {
  const sent: EventBatch[] = []
  const storage = options.storage ?? memoryStorage()
  let ids = 0
  const analytics = createAnalytics({
    send: (body) => sent.push(JSON.parse(body) as EventBatch),
    session: () => storage,
    now: () => new Date('2026-11-18T12:00:00Z'),
    newId: () => `id-${++ids}`,
    appVersion: '1.0.0',
  })
  const names = () => sent.flatMap((batch) => batch.events.map((event) => event.name))
  return { analytics, sent, storage, names }
}

describe('analytics events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds events until the server config arrives, then sends them in one batch', () => {
    const { analytics, sent } = setup()
    analytics.startSession()
    analytics.track('list_created')
    vi.advanceTimersByTime(FLUSH_DELAY_MS * 10)
    expect(sent).toEqual([])

    analytics.setEnabled(true)
    vi.advanceTimersByTime(FLUSH_DELAY_MS)

    expect(sent).toEqual([
      {
        session_id: 'id-1',
        platform: 'web',
        app_version: '1.0.0',
        events: [
          { name: 'session_start', at: '2026-11-18T12:00:00.000Z' },
          { name: 'list_created', at: '2026-11-18T12:00:00.000Z' },
        ],
      },
    ])
  })

  it('sends nothing, and keeps nothing, when the server says events are off', () => {
    const { analytics, sent } = setup()
    analytics.track('list_created')
    analytics.setEnabled(false)
    analytics.track('item_added')
    analytics.flush()
    vi.runAllTimers()

    expect(sent).toEqual([])
    expect(analytics.pending()).toEqual([])
  })

  it('flushes on demand, as when the page is hidden', () => {
    const { analytics, names } = setup()
    analytics.setEnabled(true)
    analytics.track('export_file')
    analytics.flush()
    expect(names()).toEqual(['export_file'])
  })

  it('flushes when the page is hidden or unloads', () => {
    const { analytics, names } = setup()
    analytics.setEnabled(true)
    analytics.flushWhenHidden(window)

    analytics.track('item_added')
    window.dispatchEvent(new Event('pagehide'))
    expect(names()).toEqual(['item_added'])

    analytics.track('item_added')
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(names()).toEqual(['item_added', 'item_added'])
  })

  it('splits a long queue into batches the server accepts', () => {
    const { analytics, sent } = setup()
    for (let i = 0; i < MAX_BATCH + 5; i++) analytics.track('item_added')
    analytics.setEnabled(true)
    analytics.flush()
    expect(sent.map((batch) => batch.events.length)).toEqual([MAX_BATCH, 5])
  })

  it('drops the oldest events past the queue cap', () => {
    const { analytics } = setup()
    analytics.track('list_created')
    for (let i = 0; i < MAX_QUEUE; i++) analytics.track('item_added')
    expect(analytics.pending()).toHaveLength(MAX_QUEUE)
    expect(analytics.pending()[0]!.name).toBe('item_added')
  })

  it('starts a session once per tab: a reload keeps the same id', () => {
    const storage = memoryStorage()
    const first = setup({ storage })
    first.analytics.startSession()
    expect(storage.getItem(SESSION_KEY)).toBe('id-1')

    const reloaded = setup({ storage })
    reloaded.analytics.startSession()
    reloaded.analytics.setEnabled(true)
    reloaded.analytics.track('item_added')
    reloaded.analytics.flush()
    expect(reloaded.sent[0]!.session_id).toBe('id-1')
    expect(reloaded.names()).toEqual(['item_added']) // no second session_start
  })

  it('counts a sign-in success only after one this tab started, once', () => {
    const storage = memoryStorage()
    const { analytics, names } = setup({ storage })
    analytics.setEnabled(true)

    analytics.noteSignedIn() // already signed in on load: not a new sign-in
    analytics.noteSignInStarted('google')
    expect(storage.getItem(PENDING_SIGN_IN_KEY)).toBe('google')

    // The Google redirect reloads the page: a new queue, the same tab storage.
    const after = setup({ storage })
    after.analytics.setEnabled(true)
    after.analytics.noteSignedIn()
    after.analytics.noteSignedIn()
    analytics.flush()
    after.analytics.flush()

    expect(names()).toEqual(['sign_in_started'])
    expect(after.sent[0]!.events).toEqual([
      expect.objectContaining({ name: 'sign_in_succeeded', props: { provider: 'google' } }),
    ])
    expect(storage.getItem(PENDING_SIGN_IN_KEY)).toBeNull()
  })

  it('still works when sessionStorage is blocked', () => {
    const { analytics, names } = setup({ storage: memoryStorage(true) })
    analytics.startSession()
    analytics.noteSignInStarted('dev')
    analytics.noteSignedIn()
    analytics.setEnabled(true)
    analytics.flush()
    expect(names()).toEqual(['session_start', 'sign_in_started', 'sign_in_succeeded'])
  })
})
