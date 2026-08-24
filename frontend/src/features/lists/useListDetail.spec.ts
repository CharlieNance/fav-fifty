import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { ListSummary } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { useListDetail } from './useListDetail'

const apiFetchMock = vi.mocked(apiFetch)

const LIST: ListSummary = {
  id: 'list-1',
  title: 'Best sandwiches',
  status: 'draft',
  tags: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('useListDetail', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('starts idle with no list', () => {
    const { status, list } = useListDetail()
    expect(status.value).toBe('idle')
    expect(list.value).toBeNull()
  })

  it('loads the list from the API on success', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)
    const { status, list, load } = useListDetail()

    await load('list-1')

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1')
    expect(status.value).toBe('success')
    expect(list.value).toEqual(LIST)
  })

  it('sets a not-found status on a 404', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const { status, list, load } = useListDetail()

    await load('missing-id')

    expect(status.value).toBe('not-found')
    expect(list.value).toBeNull()
  })

  it('sets an error status on other failures', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { status, list, load } = useListDetail()

    await load('list-1')

    expect(status.value).toBe('error')
    expect(list.value).toBeNull()
  })

  it('updateList replaces the loaded list when ids match', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)
    const { list, load, updateList } = useListDetail()
    await load('list-1')

    const renamed = { ...LIST, title: 'Favorite sandwiches' }
    updateList(renamed)

    expect(list.value).toEqual(renamed)
  })

  it('updateList is a no-op when the id does not match the loaded list', async () => {
    apiFetchMock.mockResolvedValueOnce(LIST)
    const { list, load, updateList } = useListDetail()
    await load('list-1')

    updateList({ ...LIST, id: 'someone-elses-list' })

    expect(list.value).toEqual(LIST)
  })

  it('updateList is a no-op when no list is loaded', () => {
    const { list, updateList } = useListDetail()

    updateList(LIST)

    expect(list.value).toBeNull()
  })
})
