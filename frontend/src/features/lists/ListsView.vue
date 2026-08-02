<script setup lang="ts">
// Interaction 1 + 2 + 3 (docs/LISTS_CRUD_PLAN.md): the index of the signed-in
// user's own lists, plus the entry points for creating and renaming one. Create
// is a modal (CreateListModal, hosted globally in App.vue) opened via the shared
// useListModalsStore; rename (EditListModal) is mounted right here per-row,
// keyed off the same store's `editingListId` — neither ever navigates away.
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PencilSquareIcon } from '@heroicons/vue/24/outline'

import BaseButton from '@/components/BaseButton.vue'
import IconButton from '@/components/IconButton.vue'
import EditListModal from './EditListModal.vue'
import type { ListSummary } from './types'
import { useLists } from './useLists'
import { useListModalsStore } from './useListModals'

const { status, lists, load, updateList } = useLists()
const modals = useListModalsStore()
const route = useRoute()
const router = useRouter()

onMounted(() => {
  void load()

  // Resuming a "Start a list" click that sent an anonymous visitor through
  // login (see useStartList) — open the modal, then drop the flag from the URL.
  if (route.query.openCreate) {
    modals.openCreate()
    void router.replace({ path: route.path, query: { ...route.query, openCreate: undefined } })
  }
})

function handleRenamed(updated: ListSummary): void {
  updateList(updated)
  modals.closeEdit()
}
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <div class="flex items-center justify-between gap-4">
      <h1 class="font-display text-3xl font-extrabold text-ink">My lists</h1>
      <BaseButton size="sm" @click="modals.openCreate()">New list</BaseButton>
    </div>

    <p v-if="status === 'loading'" class="mt-6 text-muted">Loading your lists…</p>

    <p v-else-if="status === 'error'" class="mt-6 text-muted">
      Something went wrong loading your lists. Try refreshing the page.
    </p>

    <p v-else-if="lists.length === 0" class="mt-6 text-muted">
      You haven't started a list yet — create your first one above.
    </p>

    <ul v-else class="mt-6 divide-y divide-border">
      <li v-for="list in lists" :key="list.id" class="flex items-center justify-between gap-4 py-3">
        <RouterLink :to="{ name: 'list-detail', params: { id: list.id } }" class="text-ink">
          {{ list.title }}
        </RouterLink>
        <IconButton
          :icon="PencilSquareIcon"
          :label="`Rename ${list.title}`"
          @click="modals.openEdit(list.id)"
        />

        <EditListModal
          v-if="modals.editingListId === list.id"
          :list="list"
          @saved="handleRenamed"
          @cancel="modals.closeEdit()"
        />
      </li>
    </ul>
  </section>
</template>
