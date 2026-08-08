import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiFetch: vi.fn() }
})

import { apiFetch } from '@/api/client'
import { makeItem, makeItems } from './itemTestUtils'
import { useListItems } from './useListItems'

const apiFetchMock = vi.mocked(apiFetch)

describe('useListItems', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('starts idle with no items', () => {
    const { status, items } = useListItems()
    expect(status.value).toBe('idle')
    expect(items.value).toEqual([])
  })

  it('loads the items from the API in rank order', async () => {
    const fixture = makeItems(3)
    apiFetchMock.mockResolvedValueOnce(fixture)
    const { status, items, load } = useListItems()

    await load('list-1')

    expect(apiFetchMock).toHaveBeenCalledWith('/lists/list-1/items')
    expect(status.value).toBe('success')
    expect(items.value).toEqual(fixture)
  })

  it('sets an error status and clears items on failure', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('boom'))
    const { status, items, load } = useListItems()

    await load('list-1')

    expect(status.value).toBe('error')
    expect(items.value).toEqual([])
  })

  it('addItem appends to the end', () => {
    const { items, setItems, addItem } = useListItems()
    setItems(makeItems(2))

    const added = makeItem({ id: 'item-3', position: 3, text: 'New one' })
    addItem(added)

    expect(items.value).toHaveLength(3)
    expect(items.value[2]).toEqual(added)
  })

  it('replaceItem swaps in the updated copy by id, leaving the rest untouched', () => {
    const { items, setItems, replaceItem } = useListItems()
    setItems(makeItems(3))

    replaceItem(makeItem({ id: 'item-2', position: 2, text: 'Edited' }))

    expect(items.value[1].text).toBe('Edited')
    expect(items.value[0].text).toBe('Favorite thing 1')
    expect(items.value[2].text).toBe('Favorite thing 3')
  })

  it('removeItem drops the item and renumbers the rest 1..N, like the backend repack', () => {
    const { items, setItems, removeItem } = useListItems()
    setItems(makeItems(3))

    removeItem('item-1')

    expect(items.value.map((item) => item.id)).toEqual(['item-2', 'item-3'])
    expect(items.value.map((item) => item.position)).toEqual([1, 2])
  })

  it('restoreServerOrder re-sorts by the position fields after a local (drag) shuffle', () => {
    const { items, setItems, restoreServerOrder } = useListItems()
    const [first, second, third] = makeItems(3)
    // A drag reordered the ARRAY but nobody rewrote the position fields yet.
    setItems([third, first, second])

    restoreServerOrder()

    expect(items.value.map((item) => item.id)).toEqual(['item-1', 'item-2', 'item-3'])
  })
})
