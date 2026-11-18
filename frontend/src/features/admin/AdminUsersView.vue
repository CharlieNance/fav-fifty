<script setup lang="ts">
/** Admin → Users: search by name or email, newest first, page with "Load more". */
import { onMounted, onUnmounted, ref, watch } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import AdminProblem from './AdminProblem.vue'
import {
  adminApi,
  adminProblem,
  formatWhen,
  SEARCH_DEBOUNCE_MS,
  USER_PAGE_SIZE,
  type AdminProblem as Problem,
  type AdminUserSummary,
} from './adminApi'

const query = ref('')
const users = ref<AdminUserSummary[]>([])
const loading = ref(false)
const hasMore = ref(false)
const problem = ref<Problem | null>(null)

// Each search gets a number; a slow, stale response can't overwrite a newer one.
let latest = 0

async function load(append = false): Promise<void> {
  const run = ++latest
  loading.value = true
  problem.value = null
  try {
    const page = await adminApi.searchUsers(query.value, append ? users.value.length : 0)
    if (run !== latest) return
    users.value = append ? [...users.value, ...page] : page
    hasMore.value = page.length === USER_PAGE_SIZE
  } catch (error) {
    if (run === latest) problem.value = adminProblem(error)
  } finally {
    if (run === latest) loading.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(timer)
  timer = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS)
})
onUnmounted(() => clearTimeout(timer))
onMounted(() => void load())
</script>

<template>
  <h1 class="font-display text-3xl font-extrabold text-ink">Users</h1>

  <form class="mt-4" role="search" @submit.prevent="load()">
    <label for="admin-user-search" class="sr-only">Search users</label>
    <input
      id="admin-user-search"
      v-model="query"
      type="search"
      maxlength="100"
      placeholder="Search by name or email"
      class="w-full rounded-lg border border-control bg-transparent px-4 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
    />
  </form>

  <AdminProblem v-if="problem" :problem="problem" />

  <p v-else-if="!loading && users.length === 0" class="mt-6 text-sm text-muted">No users found.</p>

  <ul v-if="users.length" class="mt-6 divide-y divide-border" aria-label="Users">
    <li v-for="user in users" :key="user.id" class="py-3">
      <RouterLink
        :to="{ name: 'admin-user', params: { id: user.id } }"
        class="group flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded"
      >
        <span class="font-medium text-ink group-hover:text-accent">{{ user.display_name }}</span>
        <span class="text-sm text-muted">{{ user.email ?? 'no email' }}</span>
        <span
          v-if="!user.is_active"
          class="rounded-full border border-error-border bg-error px-2 py-0.5 text-xs font-semibold text-error-ink"
          >Locked</span
        >
        <span
          v-if="user.role === 'admin'"
          class="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
          >Admin</span
        >
        <span class="ml-auto text-xs text-muted">
          {{ user.list_count }} {{ user.list_count === 1 ? 'list' : 'lists' }} · joined
          {{ formatWhen(user.created_at) }}
        </span>
      </RouterLink>
    </li>
  </ul>

  <p v-if="loading" class="mt-4 text-sm text-muted" role="status">Loading…</p>

  <div v-if="hasMore && !loading" class="mt-4">
    <BaseButton variant="secondary" size="sm" @click="load(true)">Load more</BaseButton>
  </div>
</template>
