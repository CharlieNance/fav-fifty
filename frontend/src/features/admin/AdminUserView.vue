<script setup lang="ts">
/**
 * Admin → one user: who they are, how much they've made, and the actions (lock,
 * unlock, sign out everywhere), each confirmed with an optional audit reason.
 * Every action is audit-logged by the backend; the log for this user is listed
 * at the bottom.
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toasts'
import AdminActionDialog from './AdminActionDialog.vue'
import AdminProblem from './AdminProblem.vue'
import {
  actionLabel,
  adminApi,
  adminProblem,
  formatWhen,
  type AdminProblem as Problem,
  type AdminUserDetail,
  type UserAction,
} from './adminApi'

const route = useRoute()
const auth = useAuthStore()
const toasts = useToastStore()

const user = ref<AdminUserDetail | null>(null)
const problem = ref<Problem | null>(null)

const isSelf = computed(() => user.value?.id === auth.user?.id)

async function load(id: string): Promise<void> {
  user.value = null
  problem.value = null
  try {
    user.value = await adminApi.getUser(id)
  } catch (error) {
    problem.value = adminProblem(error)
  }
}
watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string') void load(id)
  },
  { immediate: true },
)

interface ActionCopy {
  title: string
  message: string
  confirmLabel: string
  done: string
}

const COPY: Record<UserAction, (name: string) => ActionCopy> = {
  lock: (name) => ({
    title: `Lock ${name}?`,
    message:
      'They’re signed out everywhere and can’t sign back in until you unlock them. Their lists are kept.',
    confirmLabel: 'Lock account',
    done: `${name} is locked.`,
  }),
  unlock: (name) => ({
    title: `Unlock ${name}?`,
    message: 'They can sign in again.',
    confirmLabel: 'Unlock account',
    done: `${name} is unlocked.`,
  }),
  'revoke-sessions': (name) => ({
    title: `Sign ${name} out everywhere?`,
    message: 'Every device they’re signed in on is signed out. They can sign straight back in.',
    confirmLabel: 'Sign out everywhere',
    done: `${name} is signed out everywhere.`,
  }),
}

const pendingAction = ref<UserAction | null>(null)
const acting = ref(false)
const actionError = ref<string | null>(null)
const copy = computed(() =>
  pendingAction.value && user.value ? COPY[pendingAction.value](user.value.display_name) : null,
)

function open(action: UserAction): void {
  actionError.value = null
  pendingAction.value = action
}

function close(): void {
  if (!acting.value) pendingAction.value = null
}

async function confirm(reason: string): Promise<void> {
  if (!user.value || !pendingAction.value || !copy.value) return
  acting.value = true
  actionError.value = null
  try {
    const done = copy.value.done
    user.value = await adminApi.actOnUser(user.value.id, pendingAction.value, reason)
    pendingAction.value = null
    toasts.show(done)
  } catch (error) {
    actionError.value = adminProblem(error).message
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <RouterLink :to="{ name: 'admin-users' }" class="text-sm text-muted hover:text-ink"
    >← All users</RouterLink
  >

  <AdminProblem v-if="problem" :problem="problem" />
  <p v-else-if="!user" class="mt-6 text-sm text-muted" role="status">Loading…</p>

  <template v-else>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <h1 class="font-display text-3xl font-extrabold text-ink">{{ user.display_name }}</h1>
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
    </div>

    <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      <dt class="text-muted">Email</dt>
      <dd class="text-ink">{{ user.email ?? '—' }}</dd>
      <dt class="text-muted">Joined</dt>
      <dd class="text-ink">{{ formatWhen(user.created_at) }}</dd>
      <dt class="text-muted">Last sign-in</dt>
      <dd class="text-ink">{{ formatWhen(user.last_login_at) }}</dd>
      <dt class="text-muted">Lists</dt>
      <dd class="text-ink">{{ user.list_count }}</dd>
      <dt class="text-muted">Items</dt>
      <dd class="text-ink">{{ user.item_count }}</dd>
      <dt class="text-muted">User id</dt>
      <dd class="font-mono text-xs break-all text-ink">{{ user.id }}</dd>
    </dl>

    <div class="mt-6 flex flex-wrap gap-3">
      <BaseButton
        v-if="user.is_active && !isSelf"
        variant="secondary"
        size="sm"
        @click="open('lock')"
        >Lock account</BaseButton
      >
      <BaseButton v-if="!user.is_active" variant="secondary" size="sm" @click="open('unlock')"
        >Unlock account</BaseButton
      >
      <BaseButton variant="secondary" size="sm" @click="open('revoke-sessions')"
        >Sign out everywhere</BaseButton
      >
    </div>
    <p v-if="isSelf" class="mt-2 text-xs text-muted">This is you, so it can’t be locked here.</p>

    <h2 class="mt-10 font-display text-xl font-bold text-ink">Admin actions</h2>
    <p v-if="user.recent_actions.length === 0" class="mt-2 text-sm text-muted">None yet.</p>
    <ul v-else class="mt-2 divide-y divide-border text-sm">
      <li v-for="entry in user.recent_actions" :key="entry.id" class="flex flex-wrap gap-x-3 py-2">
        <span class="font-medium text-ink">{{ actionLabel(entry.action) }}</span>
        <span class="text-muted">{{ formatWhen(entry.created_at) }}</span>
        <span v-if="entry.reason" class="w-full text-muted">“{{ entry.reason }}”</span>
      </li>
    </ul>
  </template>

  <AdminActionDialog
    v-if="copy"
    :title="copy.title"
    :message="copy.message"
    :confirm-label="copy.confirmLabel"
    :pending="acting"
    :error="actionError"
    @confirm="confirm"
    @cancel="close"
  />
</template>
