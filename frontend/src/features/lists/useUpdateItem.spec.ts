import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { makeItem } from './itemTestUtils'
import { useUpdateItem } from './useUpdateItem'

const apiFetchMock = vi.mocked(apiFetch)

const DRAFT = { text: 'Edited', note: 'better than ever', image_url: null }

describe('useUpdateItem', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('PATCHes the full draft and returns the updated item', async () => {
    const updated = makeItem({ text: 'Edited', note: 'better than ever' })
    apiFetchMock.mockResolvedValueOnce(updated)
    const { updateItem, error } = useUpdateItem()

    const result = await updateItem('list-1', 'item-1', DRAFT)

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items/item-1', {
      method: 'PATCH',
      body: JSON.stringify(DRAFT),
    })
    expect(result).toEqual(updated)
    expect(error.value).toBeNull()
  })

  it("shows the backend's own copy on a 409 (text collides with another item)", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(409, 'conflict', 'An item with this text already exists in this list.'),
    )
    const { updateItem, error } = useUpdateItem()

    const result = await updateItem('list-1', 'item-1', DRAFT)

    expect(result).toBeNull()
    expect(error.value).toBe('An item with this text already exists in this list.')
  })

  it('falls back to a generic message on other failures', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { updateItem, error } = useUpdateItem()

    const result = await updateItem('list-1', 'item-1', DRAFT)

    expect(result).toBeNull()
    expect(error.value).toBe('Could not save the item. Check it and try again.')
  })
})
