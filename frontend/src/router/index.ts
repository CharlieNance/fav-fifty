import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

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
      // Backend unreachable — treat as logged out rather than blocking the app.
    }
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  return true
})
