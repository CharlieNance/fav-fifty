import { useListModalsStore } from './useListModals'

/**
 * The "Start a list" action, shared by the header button and the hero CTA.
 *
 * It opens the create modal right where the visitor is, signed in or not:
 * anonymous visitors build lists on this device
 * (docs/ARCHITECTURE.md §Anonymous lists).
 */
export function useStartList() {
  const modals = useListModalsStore()

  function startList() {
    modals.openCreate()
  }

  return { startList }
}
