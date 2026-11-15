import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalizedGeneric,
  type RouteRecordRaw,
} from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { setPageTitle } from './pageTitle'

declare module 'vue-router' {
  interface RouteMeta {
    /** Tab title (see pageTitle.ts); omitted = just the site name. */
    title?: string
    requiresAuth?: boolean
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

  // If the route requires auth and the user isn't logged in, redirect to login.
  if (isRouteRequiresAuth(to, auth)) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  return true
})

router.afterEach((to) => {
  setPageTitle(to.meta.title)
})

function isRouteRequiresAuth(
  to: RouteLocationNormalizedGeneric,
  auth: ReturnType<typeof useAuthStore>,
): boolean {
  const requiresAuth = to.meta.requiresAuth === true

  if (requiresAuth && !auth.isAuthenticated) {
    return true
  }

  return false
}
