import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalizedGeneric,
  type RouteLocationRaw,
  type RouteRecordRaw,
} from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { setPageTitle } from './pageTitle'

declare module 'vue-router' {
  interface RouteMeta {
    /** Tab title (see pageTitle.ts); omitted = just the site name. */
    title?: string
    requiresAuth?: boolean
    /** Owner-only (docs/ADMIN_AND_ANALYTICS_PLAN.md). UX only; the API is the gate. */
    requiresAdmin?: boolean
  }
}

// Views are lazy-loaded (`() => import(...)`) so each page becomes its own
// bundle chunk — the pattern to copy as pages are added. Give each a
// `meta.title` too.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/features/home/HomeView.vue'),
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/features/auth/LoginView.vue'),
    meta: { title: 'Sign in' },
  },
  // Same Google flow as /login (the backend creates the account on first
  // sign-in, social-only, no password); only the wording differs.
  {
    path: '/signup',
    name: 'signup',
    component: () => import('@/features/auth/LoginView.vue'),
    props: { mode: 'signup' },
    meta: { title: 'Create your account' },
  },
  // Open to everyone: signed-in users see their account's lists, anonymous
  // visitors the ones saved on this device (useListRepository picks which).
  {
    path: '/lists',
    name: 'lists',
    component: () => import('@/features/lists/ListsView.vue'),
    meta: { title: 'My lists' },
  },
  {
    path: '/lists/:id',
    name: 'list-detail',
    component: () => import('@/features/lists/ListDetailView.vue'),
    // Replaced by the list's own title once it loads (ListDetailView).
    meta: { title: 'List' },
  },
  // The admin area: its own lazy chunk, so the public bundle doesn't carry it.
  {
    path: '/admin',
    component: () => import('@/features/admin/AdminLayout.vue'),
    meta: { requiresAdmin: true },
    children: [
      { path: '', name: 'admin', redirect: { name: 'admin-users' } },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('@/features/admin/AdminUsersView.vue'),
        meta: { title: 'Admin: users' },
      },
      {
        path: 'users/:id',
        name: 'admin-user',
        component: () => import('@/features/admin/AdminUserView.vue'),
        meta: { title: 'Admin: user' },
      },
      {
        path: 'settings',
        name: 'admin-settings',
        component: () => import('@/features/admin/AdminSettingsView.vue'),
        meta: { title: 'Admin: settings' },
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// Provisional auth guard. It (a) resolves the session once on first navigation
// and (b) sends unauthenticated users away from `requiresAuth` routes, keeping
// their intended destination in `redirect`. No route needs auth today (lists
// work on-device for anonymous visitors); it's kept for pages that will, such
// as publishing. The network-error swallow keeps the frontend usable when the
// backend isn't running: the visitor is treated as anonymous.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.isReady) {
    try {
      await auth.fetchMe()
    } catch {
      // Backend unreachable, but don't block the app. The user will be treated as logged out.
      console.warn('Failed to fetch session; treating as logged out.')
    }
  }

  return accessRedirect(to, auth) ?? true
})

router.afterEach((to) => {
  setPageTitle(to.meta.title)
})

type AccessCheck = Pick<ReturnType<typeof useAuthStore>, 'isAuthenticated' | 'isAdmin'>

/**
 * Where to send someone who can't see `to`, or null if they can. Signed out on a
 * page that needs an account (admin included): sign in, then come back. Signed
 * in but not an admin: home, as if the admin area weren't there.
 */
export function accessRedirect(
  to: Pick<RouteLocationNormalizedGeneric, 'meta' | 'fullPath'>,
  auth: AccessCheck,
): RouteLocationRaw | null {
  const needsAccount = to.meta.requiresAuth === true || to.meta.requiresAdmin === true
  if (needsAccount && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin === true && !auth.isAdmin) {
    return { name: 'home' }
  }
  return null
}
