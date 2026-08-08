import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { useDeleteItem } from './useDeleteItem'

const apiFetchMock = vi.mocked(apiFetch)

describe('useDeleteItem', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('DELETEs the item and reports success', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined)
    const { deleteItem, error } = useDeleteItem()

    const deleted = await deleteItem('list-1', 'item-1')

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items/item-1', { method: 'DELETE' })
    expect(deleted).toBe(true)
    expect(error.value).toBeNull()
  })

  it('reports failure and sets an error message', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('boom'))
    const { deleteItem, error } = useDeleteItem()

    const deleted = await deleteItem('list-1', 'item-1')

    expect(deleted).toBe(false)
    expect(error.value).toBe('Could not delete the item. Try again.')
  })

  it('reset clears the error', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('boom'))
    const { deleteItem, error, reset } = useDeleteItem()
    await deleteItem('list-1', 'item-1')

    reset()

    expect(error.value).toBeNull()
  })
})
