import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalizedGeneric,
  type RouteRecordRaw,
} from 'vue-router'

import { useAuthStore } from '@/stores/auth'

// Views are lazy-loaded (`() => import(...)`) so each page becomes its own
// bundle chunk — the pattern to copy as pages are added.
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
  },
  {
    path: '/lists/new',
    name: 'create-list',
    component: () => import('@/features/lists/CreateListView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lists',
    name: 'lists',
    component: () => import('@/features/lists/ListsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lists/:id',
    name: 'list-detail',
    component: () => import('@/features/lists/ListDetailView.vue'),
    meta: { requiresAuth: true },
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// Provisional auth guard. It (a) resolves the session once on first navigation
// and (b) sends unauthenticated users away from `requiresAuth` routes, keeping
// their intended destination in `redirect`. The real login flow on the auth
// branch will build on this; the network-error swallow keeps the frontend
// usable in dev when the backend isn't running.
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
