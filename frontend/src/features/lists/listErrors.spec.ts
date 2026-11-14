import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import { ListError, toListError } from './listErrors'

describe('toListError', () => {
  it.each([
    [404, 'not-found'],
    [409, 'conflict'],
    [422, 'invalid'],
    [500, 'unknown'],
    [401, 'unknown'],
  ] as const)('maps HTTP %i to %s', (status, kind) => {
    const apiError = new ApiError(status, 'failed', 'Backend copy')
    const listError = toListError(apiError)
    expect(listError.kind).toBe(kind)
    expect(listError.detail).toBe('Backend copy')
    expect(listError.cause).toBe(apiError)
  })

  it('treats a network failure as unknown with no detail', () => {
    const listError = toListError(new Error('Network error'))
    expect(listError.kind).toBe('unknown')
    expect(listError.detail).toBeNull()
  })

  it('returns an existing ListError as-is', () => {
    const original = new ListError('conflict', 'Already there')
    expect(toListError(original)).toBe(original)
  })
})
