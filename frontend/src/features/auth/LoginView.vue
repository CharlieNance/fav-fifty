<script setup lang="ts">
// Login page. "Continue with Google" hands off to the backend, which brokers the
// real Google→Cognito flow (see docs/DECISIONS.md §Auth seam). In development a
// second button uses the dev-login stub so the app is usable before Cognito exists.
// `?redirect=` is where we send the user after a successful sign-in; without one
// they go to DEFAULT_POST_LOGIN_PATH.
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { DEFAULT_POST_LOGIN_PATH } from './postLogin'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const rawRedirect = route.query.redirect
const redirect = typeof rawRedirect === 'string' ? rawRedirect : undefined
// Only the dev stub is offered locally; the real button is always available.
const isDev = import.meta.env.DEV

const busy = ref(false)

// The backend bounces a failed OAuth round-trip back here as `?error=` (details
// stay in its logs, never in the URL). Without surfacing it the user just lands
// on the login page again with no idea why, so say something — generic, since
// that flag is deliberately the only thing we're told. Presence is what matters,
// not the value: `?error=` or a bare `?error` still means the round-trip failed.
//
// Derived from the route rather than snapshotted at setup: the header's "Log in"
// link points at a bare `/login`, so navigating there from an errored `/login`
// reuses this instance without re-running setup — a snapshot would leave a stale
// alert on a URL that no longer claims anything failed.
const oauthError = computed(() =>
  'error' in route.query ? 'Sign-in didn’t complete. Please try again.' : null,
)

// The dev stub fails locally, not via the URL, so this one is genuinely state.
const devLoginError = ref<string | null>(null)

// A just-attempted dev login is the more specific story, so it wins.
const error = computed(() => devLoginError.value ?? oauthError.value)

function signInWithGoogle(): void {
  busy.value = true
  auth.loginWithGoogle(redirect)
}

async function signInAsDev(): Promise<void> {
  busy.value = true
  devLoginError.value = null
  try {
    await auth.devLogin()
    await router.push(redirect ?? DEFAULT_POST_LOGIN_PATH)
  } catch {
    devLoginError.value = 'Dev login failed. Is the backend running with APP_ENV=development?'
    busy.value = false
  }
}
</script>

<template>
  <section class="mx-auto grid min-h-[60vh] max-w-md place-items-center px-6 text-center">
    <div>
      <h1 class="font-display text-3xl font-extrabold text-ink">Welcome back</h1>
      <p class="mt-3 text-muted">Sign in to build and save your lists.</p>

      <div class="mt-8 space-y-3">
        <button
          type="button"
          :disabled="busy"
          class="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-6 py-3 font-semibold text-ink transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
          @click="signInWithGoogle"
        >
          Continue with Google
        </button>

        <button
          v-if="isDev"
          type="button"
          :disabled="busy"
          class="inline-flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-border px-6 py-3 text-sm font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          @click="signInAsDev"
        >
          🧪 Dev login (stub)
        </button>
      </div>

      <p v-if="error" role="alert" class="mt-4 text-sm text-accent">{{ error }}</p>

      <p v-if="redirect" class="mt-6 text-xs text-muted">
        You'll be taken to <span class="text-accent">{{ redirect }}</span> after signing in.
      </p>
    </div>
  </section>
</template>
