import { describe, expect, it } from 'vitest'

import { accessRedirect } from './index'

const anon = { isAuthenticated: false, isAdmin: false }
const member = { isAuthenticated: true, isAdmin: false }
const owner = { isAuthenticated: true, isAdmin: true }

function to(meta: Record<string, unknown>, fullPath = '/admin/users') {
  return { meta, fullPath }
}

describe('accessRedirect', () => {
  it('lets anyone onto an open page', () => {
    expect(accessRedirect(to({}, '/lists'), anon)).toBeNull()
  })

  it('sends a signed-out visitor to sign in, then back', () => {
    const expected = { name: 'login', query: { redirect: '/admin/users' } }
    expect(accessRedirect(to({ requiresAdmin: true }), anon)).toEqual(expected)
    expect(accessRedirect(to({ requiresAuth: true }), anon)).toEqual(expected)
  })

  it('sends a signed-in non-admin home from the admin area', () => {
    expect(accessRedirect(to({ requiresAdmin: true }), member)).toEqual({ name: 'home' })
    expect(accessRedirect(to({ requiresAuth: true }), member)).toBeNull()
  })

  it('lets the admin in', () => {
    expect(accessRedirect(to({ requiresAdmin: true }), owner)).toBeNull()
  })
})
