import { useListModalsStore } from './useListModals'

/**
 * The "Start a list" action, shared by the header button and the hero CTA.
 *
 * It opens the create modal right where the visitor is, signed in or not:
 * anonymous visitors build lists on this device
 * (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md). This supersedes the 2026-07-14
 * decision in docs/DESIGN.md that sent logged-out visitors to login first.
 */
export function useStartList() {
  const modals = useListModalsStore()

  function startList() {
    modals.openCreate()
  }

  return { startList }
}
