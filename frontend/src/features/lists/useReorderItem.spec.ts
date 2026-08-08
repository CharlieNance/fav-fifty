import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { makeItems } from './itemTestUtils'
import { useReorderItem } from './useReorderItem'

const apiFetchMock = vi.mocked(apiFetch)

describe('useReorderItem', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('PATCHes the new 1-based position and returns the full re-ranked list', async () => {
    const reordered = makeItems(3)
    apiFetchMock.mockResolvedValueOnce(reordered)
    const { reorderItem, error } = useReorderItem()

    const result = await reorderItem('list-1', 'item-3', 1)

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items/item-3/position', {
      method: 'PATCH',
      body: JSON.stringify({ position: 1 }),
    })
    expect(result).toEqual(reordered)
    expect(error.value).toBeNull()
  })

  it('returns null and sets an error on failure', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('boom'))
    const { reorderItem, error } = useReorderItem()

    const result = await reorderItem('list-1', 'item-3', 1)

    expect(result).toBeNull()
    expect(error.value).toBe('Could not move the item. The order was restored.')
  })

  it('tracks pending around the request', async () => {
    apiFetchMock.mockResolvedValueOnce(makeItems(2))
    const { reorderItem, pending } = useReorderItem()

    const promise = reorderItem('list-1', 'item-1', 2)
    expect(pending.value).toBe(true)
    await promise
    expect(pending.value).toBe(false)
  })
})
