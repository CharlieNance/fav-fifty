/**
 * Cloudflare Web Analytics (docs/ARCHITECTURE.md §Analytics): page
 * views, referrers, countries and devices from a free, cookieless beacon. It works
 * without the site being hosted on Cloudflare and follows SPA route changes itself.
 *
 * Loaded only in production builds, and only when `VITE_CF_BEACON_TOKEN` is set
 * (the site token from the Cloudflare dashboard; public, like every `VITE_` value).
 * The CSP must allow the script and beacon hosts below
 * (docs/ABUSE_PROTECTION_PLAN.md §Request hygiene).
 */

export const BEACON_SCRIPT = 'https://static.cloudflareinsights.com/beacon.min.js'

/** Site tokens are hex; anything else is a misconfiguration, not something to inject. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/i

/** Add the beacon script to the page. Returns whether it was added. */
export function loadCloudflareBeacon(token: string | undefined, doc: Document = document): boolean {
  if (!token || !TOKEN_PATTERN.test(token)) return false
  if (doc.querySelector(`script[src="${BEACON_SCRIPT}"]`)) return true
  const script = doc.createElement('script')
  script.defer = true
  script.src = BEACON_SCRIPT
  script.dataset.cfBeacon = JSON.stringify({ token })
  doc.head.append(script)
  return true
}
