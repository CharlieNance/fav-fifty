import { afterEach, describe, expect, it } from 'vitest'

import { BEACON_SCRIPT, loadCloudflareBeacon } from './cloudflare'

const TOKEN = '0123456789abcdef0123456789abcdef'

describe('loadCloudflareBeacon', () => {
  afterEach(() => {
    document.head.querySelectorAll('script').forEach((script) => script.remove())
  })

  it('adds the deferred beacon script with the site token', () => {
    expect(loadCloudflareBeacon(TOKEN)).toBe(true)
    const script = document.head.querySelector<HTMLScriptElement>('script')!
    expect(script.src).toBe(BEACON_SCRIPT)
    expect(script.defer).toBe(true)
    expect(JSON.parse(script.dataset.cfBeacon!)).toEqual({ token: TOKEN })
  })

  it.each([undefined, '', 'not-a-token', `${TOKEN}"><script>`])(
    'does nothing without a valid token (%s)',
    (token) => {
      expect(loadCloudflareBeacon(token)).toBe(false)
      expect(document.head.querySelector('script')).toBeNull()
    },
  )

  it('adds it only once', () => {
    loadCloudflareBeacon(TOKEN)
    loadCloudflareBeacon(TOKEN)
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })
})
