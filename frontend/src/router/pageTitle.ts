/**
 * The browser tab title (WCAG 2.4.2 Page Titled). It's also the first thing a
 * screen reader announces after a navigation, so in an SPA, where the page
 * never reloads, it has to change with the route. Routes set it through
 * `meta.title`; a page whose title depends on data (a list's name) calls
 * `setPageTitle` once that data has loaded.
 */
export const SITE_NAME = 'Fav Fifty'

export function setPageTitle(title?: string | null): void {
  document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME
}
