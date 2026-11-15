import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '@/api/client'
import { ListError } from './listErrors'
import { apiListRepository } from './listRepository'
import { useListAction } from './useListAction'
import { setListRepository } from './useListRepository'

describe('useListAction', () => {
  // The active repository depends on the auth store.
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    setListRepository(null)
  })

  it('starts idle with no error', () => {
    const { pending, error, errorKind } = useListAction({ fallback: 'Nope' })
    expect(pending.value).toBe(false)
    expect(error.value).toBeNull()
    expect(errorKind.value).toBeNull()
  })

  it('runs the action against the active repository and returns its result', async () => {
    const fake = { ...apiListRepository }
    setListRepository(fake)
    const { run, error } = useListAction({ fallback: 'Nope' })

    const result = await run(async (repo) => {
      expect(repo).toBe(fake)
      return 'done'
    })

    expect(result).toBe('done')
    expect(error.value).toBeNull()
  })

  it('is pending only while the action is in flight', async () => {
    const { pending, run } = useListAction({ fallback: 'Nope' })
    let finish!: () => void
    const promise = run(() => new Promise<void>((resolve) => (finish = resolve)))

    expect(pending.value).toBe(true)
    finish()
    await promise
    expect(pending.value).toBe(false)
  })

  it('shows the fallback for an error kind not listed in showDetailFor', async () => {
    const { run, error, errorKind, pending } = useListAction({
      fallback: 'Could not do it.',
      showDetailFor: ['conflict'],
    })

    const result = await run(() => Promise.reject(new ListError('not-found', 'List not found')))

    expect(result).toBeNull()
    expect(error.value).toBe('Could not do it.')
    expect(errorKind.value).toBe('not-found')
    expect(pending.value).toBe(false)
  })

  it("shows the storage layer's own copy for a listed kind", async () => {
    const { run, error } = useListAction({
      fallback: 'Could not do it.',
      showDetailFor: ['conflict'],
    })
    await run(() => Promise.reject(new ListError('conflict', 'This list already has 50 items.')))
    expect(error.value).toBe('This list already has 50 items.')
  })

  it("always shows a storage error's own copy, listed or not", async () => {
    const { run, error, errorKind } = useListAction({ fallback: 'Could not do it.' })
    await run(() => Promise.reject(new ListError('storage', 'Your browser isn’t letting us save.')))
    expect(errorKind.value).toBe('storage')
    expect(error.value).toBe('Your browser isn’t letting us save.')
  })

  it('falls back when a listed kind has no detail', async () => {
    const { run, error } = useListAction({
      fallback: 'Could not do it.',
      showDetailFor: ['conflict'],
    })
    await run(() => Promise.reject(new ListError('conflict')))
    expect(error.value).toBe('Could not do it.')
  })

  it('translates a stray ApiError too', async () => {
    const { run, errorKind } = useListAction({ fallback: 'Nope' })
    await run(() => Promise.reject(new ApiError(404, 'Not found')))
    expect(errorKind.value).toBe('not-found')
  })

  it('clears the previous error when run again, and on reset', async () => {
    const { run, error, errorKind, reset } = useListAction({ fallback: 'Nope' })
    await run(() => Promise.reject(new Error('boom')))
    expect(error.value).toBe('Nope')

    await run(() => Promise.resolve(1))
    expect(error.value).toBeNull()

    await run(() => Promise.reject(new Error('boom')))
    reset()
    expect(error.value).toBeNull()
    expect(errorKind.value).toBeNull()
  })
})
