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

  it('loads with a q param when given a search query', async () => {
    apiFetchMock.mockResolvedValueOnce([LIST])
    const { load } = useLists()

    await load('sci-fi')

    expect(apiFetchMock).toHaveBeenCalledWith('/lists?q=sci-fi')
  })

  it('URL-encodes the q param', async () => {
    apiFetchMock.mockResolvedValueOnce([])
    const { load } = useLists()

    await load('board games')

    expect(apiFetchMock).toHaveBeenCalledWith('/lists?q=board%20games')
  })

  it('ignores a stale response that resolves after a newer request', async () => {
    let resolveFirst: (value: ListSummary[]) => void = () => {}
    apiFetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )
    const { status, lists, load } = useLists()

    const first = load('stale query')
    apiFetchMock.mockResolvedValueOnce([LIST])
    const second = load('fresh query')
    resolveFirst([])
    await Promise.all([first, second])

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
