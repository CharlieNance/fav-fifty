<script setup lang="ts">
/**
 * Admin → one list, any user's, deleted or not (docs/ARCHITECTURE.md
 * §Content). Opening it is an audit-logged read. Remove (reason required) is the
 * owner's own soft delete, so it's reversible; Restore only undoes an admin's
 * removal, never the owner's own delete.
 *
 * Item images are shown as their URL, never loaded: a user-supplied URL shouldn't
 * be able to make the admin's browser fetch anything.
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import { useToastStore } from '@/stores/toasts'
import AdminActionDialog from './AdminActionDialog.vue'
import AdminProblem from './AdminProblem.vue'
import {
  actionLabel,
  adminApi,
  adminProblem,
  formatWhen,
  type AdminListDetail,
  type AdminProblem as Problem,
} from './adminApi'

const route = useRoute()
const toasts = useToastStore()

const list = ref<AdminListDetail | null>(null)
const problem = ref<Problem | null>(null)

async function load(id: string): Promise<void> {
  list.value = null
  problem.value = null
  try {
    list.value = await adminApi.getList(id)
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

const state = computed(() => {
  if (!list.value?.deleted_at) return null
  return list.value.removed_by_admin ? 'Removed by admin' : 'Deleted by its owner'
})

type ListAction = 'remove' | 'restore'
const pendingAction = ref<ListAction | null>(null)
const acting = ref(false)
const actionError = ref<string | null>(null)

const dialog = computed(() => {
  if (!pendingAction.value || !list.value) return null
  const title = list.value.title
  return pendingAction.value === 'remove'
    ? {
        title: `Remove “${title}”?`,
        message: 'Its owner won’t see it any more. You can restore it from here later.',
        confirmLabel: 'Remove list',
        reasonRequired: true,
      }
    : {
        title: `Restore “${title}”?`,
        message: 'It goes back to its owner’s lists, as it was.',
        confirmLabel: 'Restore list',
        reasonRequired: false,
      }
})

function open(action: ListAction): void {
  actionError.value = null
  pendingAction.value = action
}

function close(): void {
  if (!acting.value) pendingAction.value = null
}

async function confirm(reason: string): Promise<void> {
  if (!list.value || !pendingAction.value) return
  const action = pendingAction.value
  acting.value = true
  actionError.value = null
  try {
    list.value =
      action === 'remove'
        ? await adminApi.removeList(list.value.id, reason)
        : await adminApi.restoreList(list.value.id, reason)
    pendingAction.value = null
    toasts.show(action === 'remove' ? 'List removed.' : 'List restored.')
  } catch (error) {
    actionError.value = adminProblem(error).message
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <AdminProblem v-if="problem" :problem="problem" />
  <p v-else-if="!list" class="text-sm text-muted" role="status">Loading…</p>

  <template v-else>
    <RouterLink
      :to="{ name: 'admin-user', params: { id: list.user_id } }"
      class="text-sm text-muted hover:text-ink"
      >← {{ list.owner_display_name }}</RouterLink
    >

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <h1 class="font-display text-3xl font-extrabold break-words text-ink">{{ list.title }}</h1>
      <span
        v-if="state"
        class="rounded-full border border-error-border bg-error px-2 py-0.5 text-xs font-semibold text-error-ink"
        >{{ state }}</span
      >
    </div>
    <p class="mt-1 text-sm text-muted">
      {{ list.item_count }} items · created {{ formatWhen(list.created_at) }}
      <template v-if="list.deleted_at"> · deleted {{ formatWhen(list.deleted_at) }}</template>
    </p>
    <p v-if="list.tags.length" class="mt-1 text-sm text-muted">Tags: {{ list.tags.join(', ') }}</p>

    <div class="mt-4 flex flex-wrap gap-3">
      <BaseButton v-if="!list.deleted_at" variant="secondary" size="sm" @click="open('remove')"
        >Remove list</BaseButton
      >
      <BaseButton
        v-else-if="list.removed_by_admin"
        variant="secondary"
        size="sm"
        @click="open('restore')"
        >Restore list</BaseButton
      >
    </div>

    <h2 class="mt-8 font-display text-xl font-bold text-ink">Items</h2>
    <p v-if="list.items.length === 0" class="mt-2 text-sm text-muted">No items.</p>
    <ol v-else class="mt-2 divide-y divide-border text-sm" aria-label="Items">
      <li v-for="item in list.items" :key="item.id" class="flex gap-3 py-2">
        <span class="w-6 shrink-0 text-right text-muted tabular-nums">{{ item.position }}</span>
        <div class="min-w-0">
          <p class="break-words text-ink">{{ item.text }}</p>
          <p v-if="item.note" class="break-words text-muted">{{ item.note }}</p>
          <p v-if="item.image_url" class="font-mono text-xs break-all text-muted">
            Image: {{ item.image_url }}
          </p>
        </div>
      </li>
    </ol>

    <h2 class="mt-8 font-display text-xl font-bold text-ink">Admin actions</h2>
    <ul class="mt-2 divide-y divide-border text-sm">
      <li v-for="entry in list.recent_actions" :key="entry.id" class="flex flex-wrap gap-x-3 py-2">
        <span class="font-medium text-ink">{{ actionLabel(entry.action) }}</span>
        <span class="text-muted">{{ formatWhen(entry.created_at) }}</span>
        <span v-if="entry.reason" class="w-full text-muted">“{{ entry.reason }}”</span>
      </li>
    </ul>
  </template>

  <AdminActionDialog
    v-if="dialog"
    :title="dialog.title"
    :message="dialog.message"
    :confirm-label="dialog.confirmLabel"
    :reason-required="dialog.reasonRequired"
    :pending="acting"
    :error="actionError"
    @confirm="confirm"
    @cancel="close"
  />
</template>
