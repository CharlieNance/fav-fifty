<script setup lang="ts">
/** An admin page's error, with a way back in when the session is too old. */
import { useRoute } from 'vue-router'

import type { AdminProblem } from './adminApi'

defineProps<{ problem: AdminProblem }>()

const route = useRoute()
</script>

<template>
  <p
    role="alert"
    class="mt-6 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-ink"
  >
    {{ problem.message }}
    <RouterLink
      v-if="problem.reauth"
      :to="{ name: 'login', query: { redirect: route.fullPath } }"
      class="ml-1 font-medium underline hover:text-accent"
      >Sign in again</RouterLink
    >
  </p>
</template>
