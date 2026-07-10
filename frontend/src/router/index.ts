import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

// One route today. Views are lazy-loaded (`() => import(...)`) so each page
// becomes its own bundle chunk — the pattern to copy as pages are added.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/features/home/HomeView.vue'),
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
