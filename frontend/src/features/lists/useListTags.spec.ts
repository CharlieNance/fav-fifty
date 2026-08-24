import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { ListSummary } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { useListTags } from './useListTags'

const apiFetchMock = vi.mocked(apiFetch)

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  tags: ['deli', 'classics'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('useListTags', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('starts idle with no error', () => {
    const { pending, error } = useListTags()
    expect(pending.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('PUTs the full tag set and resolves the updated list on success', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)
    const { setTags, error } = useListTags()

    const result = await setTags('list-1', ['deli', 'classics'])

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/tags', {
      method: 'PUT',
      body: JSON.stringify({ tags: ['deli', 'classics'] }),
    })
    expect(result).toEqual(LIST)
    expect(error.value).toBeNull()
  })

  it('surfaces a 422 detail verbatim (e.g. over the per-list tag cap)', async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(422, 'Unprocessable', 'A list can have at most 100 tags.'),
    )
    const { setTags, error } = useListTags()

    const result = await setTags('list-1', ['a'])

    expect(result).toBeNull()
    expect(error.value).toBe('A list can have at most 100 tags.')
  })

  it('sets a generic error for a non-422 failure', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const { setTags, error } = useListTags()

    const result = await setTags('list-1', ['a'])

    expect(result).toBeNull()
    expect(error.value).toBe('Could not save the tags. Check them and try again.')
  })

  it('reset clears a previous error', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const { setTags, error, reset } = useListTags()
    await setTags('list-1', ['a'])
    expect(error.value).not.toBeNull()

    reset()

    expect(error.value).toBeNull()
  })
})
