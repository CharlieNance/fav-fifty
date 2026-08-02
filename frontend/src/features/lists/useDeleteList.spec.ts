import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { useDeleteList } from './useDeleteList'

const apiFetchMock = vi.mocked(apiFetch)

describe('useDeleteList', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('starts idle with no error', () => {
    const { pending, error } = useDeleteList()
    expect(pending.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('calls DELETE and resolves true on success', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined)
    const { deleteList, error } = useDeleteList()

    const result = await deleteList('list-1')

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1', { method: 'DELETE' })
    expect(result).toBe(true)
    expect(error.value).toBeNull()
  })

  it('sets an error and resolves false when the API call fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const { deleteList, error } = useDeleteList()

    const result = await deleteList('list-1')

    expect(result).toBe(false)
    expect(error.value).toBe('Could not delete the list. Try again.')
  })

  it('reset clears a previous error', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const { deleteList, error, reset } = useDeleteList()
    await deleteList('list-1')
    expect(error.value).not.toBeNull()

    reset()

    expect(error.value).toBeNull()
  })
})
