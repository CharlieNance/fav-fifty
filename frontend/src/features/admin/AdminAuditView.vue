<script setup lang="ts">
/**
 * Admin → Audit log: every admin action and every read of someone's lists, newest
 * first (docs/ARCHITECTURE.md §Audit log). Filter by action, by what
 * it was done to, or (from a user's page) by everything about one user. Filters
 * live in the URL, so a filtered view can be bookmarked or linked to.
 *
 * A list shows as its owner, never its title: opening it is itself a logged read.
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import AdminProblem from './AdminProblem.vue'
import {
  actionLabel,
  adminApi,
  adminProblem,
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  formatWhen,
  settingChange,
  TARGET_TYPE_LABELS,
  type AdminProblem as Problem,
  type AuditFilters,
  type AuditLogEntry,
} from './adminApi'

const route = useRoute()
const router = useRouter()

function queryText(query: LocationQuery, key: string): string {
  const value = query[key]
  return typeof value === 'string' ? value : ''
}

const filters = computed<AuditFilters>(() => ({
  action: queryText(route.query, 'action'),
  target_type: queryText(route.query, 'target'),
  subject_user_id: queryText(route.query, 'user'),
}))

/** Change one filter in the URL; the watcher below reloads. */
function setFilter(key: 'action' | 'target' | 'user', value: string): void {
  const query = { ...route.query }
  if (value) query[key] = value
  else delete query[key]
  void router.replace({ query })
}

const entries = ref<AuditLogEntry[]>([])
const loading = ref(false)
const hasMore = ref(false)
const problem = ref<Problem | null>(null)

// A slow, stale response (filters changed meanwhile) can't overwrite a newer one.
let latest = 0
onUnmounted(() => {
  latest++
})

async function load(append = false): Promise<void> {
  const run = ++latest
  loading.value = true
  problem.value = null
  try {
    const before = append ? entries.value.at(-1)?.created_at : undefined
    const page = await adminApi.auditLog(filters.value, before)
    if (run !== latest) return
    entries.value = append ? [...entries.value, ...page] : page
    hasMore.value = page.length === AUDIT_PAGE_SIZE
  } catch (error) {
    if (run === latest) problem.value = adminProblem(error)
  } finally {
    if (run === latest) loading.value = false
  }
}

watch(filters, () => void load(), { immediate: true, deep: true })

/** The filtered user's name, once an entry about them has loaded. */
const subjectName = computed(() => {
  const id = filters.value.subject_user_id
  return entries.value.find((e) => e.subject_user_id === id)?.subject_display_name ?? null
})

function byWhom(entry: AuditLogEntry): string {
  if (entry.admin_user_id === null) return 'the CLI'
  return entry.admin_display_name ?? 'a deleted account'
}
</script>

<template>
  <h1 class="font-display text-3xl font-extrabold text-ink">Audit log</h1>
  <p class="mt-1 text-sm text-muted">
    Every admin action, and every time someone’s lists were viewed. Nothing here can be edited or
    deleted.
  </p>

  <div class="mt-4 flex flex-wrap gap-3">
    <label class="flex flex-col gap-1 text-sm text-muted">
      Action
      <select
        :value="filters.action"
        class="rounded-lg border border-control bg-surface px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
        @change="setFilter('action', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">All actions</option>
        <option v-for="action in AUDIT_ACTIONS" :key="action" :value="action">
          {{ actionLabel(action) }} ({{ action }})
        </option>
      </select>
    </label>
    <label class="flex flex-col gap-1 text-sm text-muted">
      Done to
      <select
        :value="filters.target_type"
        class="rounded-lg border border-control bg-surface px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
        @change="setFilter('target', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">Anything</option>
        <option v-for="(label, type) in TARGET_TYPE_LABELS" :key="type" :value="type">
          {{ label }}
        </option>
      </select>
    </label>
  </div>

  <p v-if="filters.subject_user_id" class="mt-3 flex flex-wrap items-center gap-x-3 text-sm">
    <span class="text-ink">
      Only entries about
      <RouterLink
        :to="{ name: 'admin-user', params: { id: filters.subject_user_id } }"
        class="font-medium text-accent hover:underline"
        >{{ subjectName ?? 'one user' }}</RouterLink
      >, their lists included.
    </span>
    <button
      type="button"
      class="rounded font-medium text-muted underline hover:text-ink"
      @click="setFilter('user', '')"
    >
      Show everyone
    </button>
  </p>

  <AdminProblem v-if="problem" :problem="problem" />

  <p v-else-if="!loading && entries.length === 0" class="mt-6 text-sm text-muted">
    Nothing matches.
  </p>

  <ul v-if="entries.length" class="mt-6 divide-y divide-border text-sm" aria-label="Audit log">
    <li v-for="entry in entries" :key="entry.id" class="py-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="font-medium text-ink">{{ actionLabel(entry.action) }}</span>

        <span
          v-if="entry.target_type === 'setting' || entry.target_type === 'ip'"
          class="font-mono text-xs text-ink"
          >{{ entry.target_id }}</span
        >
        <span v-else-if="entry.target_type === 'list'" class="text-ink">
          <RouterLink
            :to="{ name: 'admin-list', params: { id: entry.target_id } }"
            class="text-accent hover:underline"
            title="Opening it is recorded here as a view"
            >a list</RouterLink
          >
          <template v-if="entry.subject_user_id">
            of
            <RouterLink
              :to="{ name: 'admin-user', params: { id: entry.subject_user_id } }"
              class="text-accent hover:underline"
              >{{ entry.subject_display_name ?? 'a deleted account' }}</RouterLink
            >
          </template>
        </span>
        <RouterLink
          v-else-if="entry.target_type === 'user' && entry.subject_user_id"
          :to="{ name: 'admin-user', params: { id: entry.subject_user_id } }"
          class="text-accent hover:underline"
          >{{ entry.subject_display_name ?? 'a deleted account' }}</RouterLink
        >
        <span v-else class="font-mono text-xs text-muted"
          >{{ entry.target_type }} {{ entry.target_id }}</span
        >

        <span v-if="settingChange(entry.details)" class="text-muted">{{
          settingChange(entry.details)
        }}</span>

        <span class="ml-auto text-xs text-muted"
          >by {{ byWhom(entry) }} · {{ formatWhen(entry.created_at) }}</span
        >
      </div>
      <p v-if="entry.reason" class="mt-1 break-words text-muted">“{{ entry.reason }}”</p>
    </li>
  </ul>

  <p v-if="loading" class="mt-4 text-sm text-muted" role="status">Loading…</p>

  <div v-if="hasMore && !loading" class="mt-4">
    <BaseButton variant="secondary" size="sm" @click="load(true)">Load older</BaseButton>
  </div>
</template>
