import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { ListSummary } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { useLists } from './useLists'

const apiFetchMock = vi.mocked(apiFetch)

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  tags: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('useLists', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('starts idle with no lists', () => {
    const { status, lists } = useLists()
    expect(status.value).toBe('idle')
    expect(lists.value).toEqual([])
  })

  it('loads lists from the API on success', async () => {
    apiFetchMock.mockResolvedValueOnce([LIST])
    const { status, lists, load } = useLists()

    await load()

    expect(apiFetchMock).toHaveBeenCalledWith('/lists')
    expect(status.value).toBe('success')
    expect(lists.value).toEqual([LIST])
  })

  it('sets an error status when the API call fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { status, lists, load } = useLists()

    await load()

    expect(status.value).toBe('error')
    expect(lists.value).toEqual([])
  })

  it('updateList replaces a matching list in place', async () => {
    apiFetchMock.mockResolvedValueOnce([LIST])
    const { lists, load, updateList } = useLists()
    await load()

    const renamed = { ...LIST, title: 'Favorite sandwiches' }
    updateList(renamed)

    expect(lists.value).toEqual([renamed])
  })

  it('updateList is a no-op when the list is not already loaded', async () => {
    apiFetchMock.mockResolvedValueOnce([LIST])
    const { lists, load, updateList } = useLists()
    await load()

    updateList({ ...LIST, id: 'someone-elses-list' })

    expect(lists.value).toEqual([LIST])
  })

  it('removeList drops a matching list', async () => {
    apiFetchMock.mockResolvedValueOnce([LIST])
    const { lists, load, removeList } = useLists()
    await load()

    removeList(LIST.id)

    expect(lists.value).toEqual([])
  })

  it('removeList is a no-op when the list is not already loaded', async () => {
    apiFetchMock.mockResolvedValueOnce([LIST])
    const { lists, load, removeList } = useLists()
    await load()

    removeList('someone-elses-list')

    expect(lists.value).toEqual([LIST])
  })
})
