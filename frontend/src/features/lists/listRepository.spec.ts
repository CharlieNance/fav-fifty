import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { ListItemDraft } from './types'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { ListError } from './listErrors'
import { apiListRepository, type ListRepository } from './listRepository'
import { setListRepository, useListRepository } from './useListRepository'

const apiFetchMock = vi.mocked(apiFetch)

const DRAFT: ListItemDraft = { text: 'In Rainbows', note: null, image_url: null }

describe('apiListRepository', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    apiFetchMock.mockResolvedValue(undefined)
  })

  // Each repository method must make exactly the request the composables used to
  // make themselves — this table is the API contract for the signed-in path.
  const cases: [string, (repo: ListRepository) => Promise<unknown>, unknown[]][] = [
    ['getLists', (r) => r.getLists(), ['/lists']],
    ['getLists with a query', (r) => r.getLists('a&b'), ['/lists?q=a%26b']],
    ['getList', (r) => r.getList('l1'), ['/lists/l1']],
    [
      'createList',
      (r) => r.createList('Best'),
      ['/lists', { method: 'POST', body: JSON.stringify({ title: 'Best' }) }],
    ],
    [
      'renameList',
      (r) => r.renameList('l1', 'Better'),
      ['/lists/l1', { method: 'PATCH', body: JSON.stringify({ title: 'Better' }) }],
    ],
    ['deleteList', (r) => r.deleteList('l1'), ['/lists/l1', { method: 'DELETE' }]],
    [
      'setTags',
      (r) => r.setTags('l1', ['a', 'b']),
      ['/lists/l1/tags', { method: 'PUT', body: JSON.stringify({ tags: ['a', 'b'] }) }],
    ],
    ['getItems', (r) => r.getItems('l1'), ['/lists/l1/items']],
    [
      'createItem',
      (r) => r.createItem('l1', DRAFT),
      ['/lists/l1/items', { method: 'POST', body: JSON.stringify(DRAFT) }],
    ],
    [
      'updateItem',
      (r) => r.updateItem('l1', 'i1', DRAFT),
      ['/lists/l1/items/i1', { method: 'PATCH', body: JSON.stringify(DRAFT) }],
    ],
    ['deleteItem', (r) => r.deleteItem('l1', 'i1'), ['/lists/l1/items/i1', { method: 'DELETE' }]],
    [
      'moveItem',
      (r) => r.moveItem('l1', 'i1', 3),
      ['/lists/l1/items/i1/position', { method: 'PATCH', body: JSON.stringify({ position: 3 }) }],
    ],
  ]

  it.each(cases)('%s calls the matching endpoint', async (_name, call, expectedArgs) => {
    await call(apiListRepository)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock).toHaveBeenCalledWith(...expectedArgs)
  })

  it('translates ApiError into a ListError at the boundary', async () => {
    const apiError = new ApiError(409, 'Conflict', 'This list already has 50 items.')
    apiFetchMock.mockRejectedValueOnce(apiError)
    const caught = await apiListRepository.createItem('l1', DRAFT).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(ListError)
    expect(caught).toMatchObject({
      kind: 'conflict',
      detail: 'This list already has 50 items.',
      cause: apiError,
    })
  })
})

describe('useListRepository', () => {
  afterEach(() => {
    setListRepository(null)
  })

  it('defaults to the API repository', () => {
    expect(useListRepository()).toBe(apiListRepository)
  })

  it('returns an injected repository until it is cleared', () => {
    const fake = { ...apiListRepository }
    setListRepository(fake)
    expect(useListRepository()).toBe(fake)
    setListRepository(null)
    expect(useListRepository()).toBe(apiListRepository)
  })
})
