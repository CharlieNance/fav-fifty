<script setup lang="ts">
// Interaction 1 (docs/LISTS_CRUD_PLAN.md): the index of the signed-in user's
// own lists. Create/edit/delete affordances land on this page in later
// interactions once their modals exist — for now this is read-only.
import { onMounted } from 'vue'

import { useLists } from './useLists'

const { status, lists, load } = useLists()
onMounted(load)
</script>

<template>
  <section class="mx-auto max-w-3xl px-6 py-12">
    <h1 class="font-display text-3xl font-extrabold text-ink">My lists</h1>

    <p v-if="status === 'loading'" class="mt-6 text-muted">Loading your lists…</p>

    <p v-else-if="status === 'error'" class="mt-6 text-muted">
      Something went wrong loading your lists. Try refreshing the page.
    </p>

    <div v-else-if="lists.length === 0" class="mt-6 text-muted">
      <p>You haven't started a list yet.</p>
      <RouterLink to="/lists/new" class="mt-2 inline-block font-semibold text-accent">
        Create your first list
      </RouterLink>
    </div>

    <ul v-else class="mt-6 divide-y divide-border">
      <li v-for="list in lists" :key="list.id" class="py-3">
        <RouterLink :to="{ name: 'list-detail', params: { id: list.id } }" class="text-ink">
          {{ list.title }}
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
