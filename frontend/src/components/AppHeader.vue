<script setup lang="ts">
/**
 * Global site header: wordmark on the left, auth-aware controls on the right.
 *
 * Mobile-first: it lays out for a narrow screen (compact wordmark, the beta pill
 * hidden) and expands at `sm:`. Marketing/discovery nav (Browse, Categories, How
 * it works) is intentionally omitted until those pages exist (Phase 3–4) so we
 * don't ship dead links.
 */
import { storeToRefs } from 'pinia'

import BaseButton from '@/components/BaseButton.vue'
import { useStartList } from '@/features/lists/useStartList'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { user, isAuthenticated } = storeToRefs(auth)
const { startList } = useStartList()

// First letter of the display name, for the avatar fallback when there's no
// picture from the social provider.
const initial = () => user.value?.displayName?.trim().charAt(0).toUpperCase() || '?'
</script>

<template>
  <header
    class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-8 sm:py-4"
  >
    <!-- Wordmark -->
    <RouterLink to="/" class="flex items-center gap-2" aria-label="Fav Fifty home">
      <span class="font-display text-xl font-extrabold tracking-tight sm:text-2xl">
        <span class="text-ink">fav</span><span class="text-accent">fifty</span>
      </span>
      <span
        class="hidden rounded-full border border-border px-2 py-0.5 text-xs text-muted sm:inline-block"
      >
        beta, obviously
      </span>
    </RouterLink>

    <!-- Auth-aware controls -->
    <nav class="flex items-center gap-3 sm:gap-4">
      <template v-if="isAuthenticated">
        <RouterLink
          to="/lists"
          class="text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          My lists
        </RouterLink>
        <div class="flex items-center gap-2">
          <img
            v-if="user?.avatarUrl"
            :src="user.avatarUrl"
            :alt="user.displayName"
            class="h-8 w-8 rounded-full object-cover"
          />
          <span
            v-else
            class="grid h-8 w-8 place-items-center rounded-full bg-elevated font-display text-sm font-bold text-ink"
            aria-hidden="true"
          >
            {{ initial() }}
          </span>
          <span class="hidden text-sm font-medium text-ink sm:inline">{{ user?.displayName }}</span>
        </div>
        <button
          type="button"
          class="cursor-pointer text-sm font-medium text-muted transition-colors hover:text-ink"
          @click="auth.logout()"
        >
          Log out
        </button>
      </template>

      <RouterLink
        v-else
        to="/login"
        class="text-sm font-medium text-muted transition-colors hover:text-ink"
      >
        Log in
      </RouterLink>

      <BaseButton size="sm" @click="startList">Start a list</BaseButton>
    </nav>
  </header>
</template>
