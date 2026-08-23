/**
 * Holds the search box's query text and debounces re-fetching, so a network
 * request fires once per pause in typing rather than once per keystroke
 * (Interaction 3, docs/TAGS_SEARCH_PLAN.md). Kept out of `ListsView.vue` and
 * `useLists.ts` so the debounce timer is its own small, independently-testable
 * unit — per open question 4's decision, this also keeps the door open for a
 * future upgrade (autocomplete, fuzzy matching) to plug in here later without
 * touching the fetch/list state at all.
 */
import { ref, watch } from 'vue'

const DEBOUNCE_MS = 300

export function useListSearch(onSearch: (query: string) => void, debounceMs = DEBOUNCE_MS) {
  const query = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(
    query,
    (value) => {
      clearTimeout(timer)
      timer = setTimeout(() => onSearch(value.trim()), debounceMs)
    },
    // Synchronous so the debounce timer resets the instant a keystroke lands,
    // not on Vue's next render-flush tick — the timer, not the framework, is
    // what should own this timing.
    { flush: 'sync' },
  )

  /** Clears the box and searches immediately — no reason to wait out the debounce. */
  function clear(): void {
    // Order matters: setting `query.value` re-triggers the sync watcher above,
    // which schedules its own new timer — clear that *after*, or it outlives
    // this function and fires a redundant onSearch('') later.
    query.value = ''
    clearTimeout(timer)
    onSearch('')
  }

  return { query, clear }
}
