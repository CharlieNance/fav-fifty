import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useListSearch } from './useListSearch'

describe('useListSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with an empty query', () => {
    const { query } = useListSearch(vi.fn())
    expect(query.value).toBe('')
  })

  it('debounces onSearch — only the last value in a burst fires', async () => {
    const onSearch = vi.fn()
    const { query } = useListSearch(onSearch, 300)

    query.value = 's'
    await vi.advanceTimersByTimeAsync(100)
    query.value = 'sa'
    await vi.advanceTimersByTimeAsync(100)
    query.value = 'sand'

    expect(onSearch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledWith('sand')
  })

  it('trims the query before calling onSearch', async () => {
    const onSearch = vi.fn()
    const { query } = useListSearch(onSearch, 300)

    query.value = '  sci-fi  '
    await vi.advanceTimersByTimeAsync(300)

    expect(onSearch).toHaveBeenCalledWith('sci-fi')
  })

  it('clear() resets the query and calls onSearch immediately, bypassing the debounce', async () => {
    const onSearch = vi.fn()
    const { query, clear } = useListSearch(onSearch, 300)

    query.value = 'sand'
    clear()

    expect(query.value).toBe('')
    expect(onSearch).toHaveBeenCalledWith('')

    // The pending debounced call for 'sand' must not fire after clear().
    onSearch.mockClear()
    await vi.advanceTimersByTimeAsync(300)
    expect(onSearch).not.toHaveBeenCalled()
  })
})
