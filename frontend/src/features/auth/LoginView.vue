<script setup lang="ts">
// Placeholder login page. The real Google -> Cognito flow lands on a dedicated
// auth branch (see docs/NEXT_STEPS.md, Phase 1). For now this just proves the
// route + intent-preserving redirect work: `?redirect=` is where we send the
// user after a successful sign-in.
import { useRoute } from 'vue-router'

const route = useRoute()
const redirect = route.query.redirect as string | undefined
</script>

<template>
  <section class="mx-auto grid min-h-[60vh] max-w-md place-items-center px-6 text-center">
    <div>
      <h1 class="font-display text-3xl font-extrabold text-ink">Welcome back</h1>
      <p class="mt-3 text-muted">Sign in to build and save your lists.</p>

      <div class="mt-8">
        <button
          type="button"
          disabled
          class="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-border px-6 py-3 font-semibold text-ink opacity-60"
        >
          Continue with Google
        </button>
        <p class="mt-3 text-xs text-muted">🚧 Sign-in wiring comes next.</p>
      </div>

      <p v-if="redirect" class="mt-6 text-xs text-muted">
        You'll be taken to <span class="text-accent">{{ redirect }}</span> after signing in.
      </p>
    </div>
  </section>
</template>
