<script setup lang="ts">
/**
 * Global site header: wordmark on the left, auth-aware controls on the right.
 *
 * Mobile-first: it lays out for a narrow screen (compact wordmark, the beta pill
 * hidden) and expands at `sm:`. Marketing/discovery nav (Browse, Categories, How
 * it works) is intentionally omitted until those pages exist (Phase 3–4) so we
 * don't ship dead links.
 */
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import BaseButton from '@/components/BaseButton.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useLogout } from '@/features/auth/useLogout'
import { useStartList } from '@/features/lists/useStartList'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { user, isAuthenticated } = storeToRefs(auth)
const { startList } = useStartList()
// Logging out is more than clearing the session (navigate + confirm) — see useLogout.
const { logout } = useLogout()

// First letter of the display name, for the avatar fallback when there's no
// picture from the social provider.
const initial = () => user.value?.display_name?.trim().charAt(0).toUpperCase() || '?'

// Provider-hosted avatars can fail to load (expired URL, rate limit, offline);
// fall back to the initial rather than a broken image. Reset when the URL changes.
const avatarFailed = ref(false)
watch(
  () => user.value?.avatar_url,
  () => (avatarFailed.value = false),
)
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

    <!-- Auth-aware controls. `aria-current="page"` (set by RouterLink on the
         exact route) is what screen readers announce as "current page"; the
         same attribute drives the visible state, so the two can't disagree. -->
    <nav aria-label="Main" class="flex items-center gap-2 sm:gap-4">
      <!-- Everyone has lists: the account's, or this device's when anonymous. -->
      <RouterLink
        to="/lists"
        class="rounded text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline aria-[current=page]:decoration-accent aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8"
      >
        My lists
      </RouterLink>

      <template v-if="isAuthenticated">
        <div class="flex items-center gap-2">
          <img
            v-if="user?.avatar_url && !avatarFailed"
            :src="user.avatar_url"
            alt=""
            referrerpolicy="no-referrer"
            class="h-8 w-8 rounded-full object-cover"
            @error="avatarFailed = true"
          />
          <span
            v-else
            class="grid h-8 w-8 place-items-center rounded-full bg-elevated font-display text-sm font-bold text-ink"
            aria-hidden="true"
          >
            {{ initial() }}
          </span>
          <!-- The signed-in name: visible from sm:, always read out (the
             avatar beside it is decorative, so it isn't read twice). -->
          <span class="sr-only text-sm font-medium text-ink sm:not-sr-only">{{
            user?.display_name
          }}</span>
        </div>
        <button
          type="button"
          class="cursor-pointer rounded text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-ink"
          @click="logout()"
        >
          Log out
        </button>
      </template>

      <RouterLink
        v-else
        to="/login"
        class="rounded text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-ink aria-[current=page]:text-ink"
      >
        Log in
      </RouterLink>

      <ThemeToggle />

      <BaseButton size="sm" class="whitespace-nowrap" @click="startList">Start a list</BaseButton>
    </nav>
  </header>
</template>
