import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { makeItem } from './itemTestUtils'
import { useCreateItem } from './useCreateItem'

const apiFetchMock = vi.mocked(apiFetch)

const DRAFT = { text: 'New favorite', note: null, image_url: null }

describe('useCreateItem', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('POSTs the draft and returns the created item', async () => {
    const created = makeItem({ text: 'New favorite' })
    apiFetchMock.mockResolvedValueOnce(created)
    const { createItem, error } = useCreateItem()

    const result = await createItem('list-1', DRAFT)

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items', {
      method: 'POST',
      body: JSON.stringify(DRAFT),
    })
    expect(result).toEqual(created)
    expect(error.value).toBeNull()
  })

  it("shows the backend's own copy on a 409 (duplicate text / list full)", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(409, 'conflict', 'This list already has 50 items.'),
    )
    const { createItem, error } = useCreateItem()

    const result = await createItem('list-1', DRAFT)

    expect(result).toBeNull()
    expect(error.value).toBe('This list already has 50 items.')
  })

  it('falls back to a generic message on other failures', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { createItem, error } = useCreateItem()

    const result = await createItem('list-1', DRAFT)

    expect(result).toBeNull()
    expect(error.value).toBe('Could not add the item. Check it and try again.')
  })

  it('tracks pending around the request and reset clears the error', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { createItem, pending, error, reset } = useCreateItem()

    const promise = createItem('list-1', DRAFT)
    expect(pending.value).toBe(true)
    await promise
    expect(pending.value).toBe(false)

    reset()
    expect(error.value).toBeNull()
  })
})
