<script setup lang="ts">
/**
 * "Bring your lists with you?" (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Claim on
 * sign-in). Mounted once in App.vue. When someone signs in with lists still saved
 * on this device, it offers to add them to the account, every list checked to
 * start with. The work and the rules live in `useListClaimStore`.
 *
 * On success the user lands on their lists, now holding the claimed ones. Pages
 * already showing lists reload through `useListsRefresh`.
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useClientConfigStore } from '@/stores/clientConfig'
import { useListClaimStore } from './useListClaim'

const auth = useAuthStore()
const claim = useListClaimStore()
const config = useClientConfigStore()
const router = useRouter()

/** `local_id`s of the checked lists. */
const selected = ref<string[]>([])

const userId = computed(() => auth.user?.id ?? null)

// Signing in (or loading a page while signed in) offers the device's lists;
// signing out closes the dialog and forgets "Not now".
watch(
  userId,
  (id, previous) => {
    if (id) claim.offer(id)
    else if (previous) claim.reset()
  },
  { immediate: true },
)

// Everything starts checked each time the dialog opens.
watch(
  () => claim.isOpen,
  (open) => {
    if (open) selected.value = claim.candidates.map((list) => list.local_id)
  },
  { immediate: true },
)

const count = computed(() => selected.value.length)
const max = computed(() => config.limits.max_lists_per_import)
const tooMany = computed(() => count.value > max.value)

const confirmLabel = computed(() => {
  if (claim.pending) return 'Adding…'
  if (count.value === 0) return 'Add lists'
  return count.value === 1 ? 'Add 1 list' : `Add ${count.value} lists`
})

function itemCount(n: number): string {
  return n === 1 ? '1 item' : `${n} items`
}

function dismiss(): void {
  claim.dismiss(userId.value)
}

async function confirm(): Promise<void> {
  if (!userId.value) return
  if (await claim.claim(selected.value, userId.value)) {
    await router.push({ name: 'lists' })
  }
}
</script>

<template>
  <div
    v-if="claim.isOpen"
    class="fixed inset-0 z-50 grid place-items-center bg-canvas/50 px-4"
    @click.self="dismiss"
    @keydown.escape="dismiss"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-lists-heading"
      aria-describedby="claim-lists-message"
      class="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-elevated p-6 shadow-xl motion-safe:animate-rise-in"
    >
      <h2 id="claim-lists-heading" class="font-display text-xl font-bold text-ink">
        Bring your lists with you?
      </h2>
      <p id="claim-lists-message" class="mt-2 text-sm text-muted">
        These lists are saved on this device only. Add them to your account to keep them safe and
        see them wherever you sign in.
      </p>

      <fieldset class="mt-4 min-h-0 overflow-y-auto" :disabled="claim.pending">
        <legend class="sr-only">Lists to add to your account</legend>
        <ul class="divide-y divide-border/70 rounded-xl border border-border/70">
          <li v-for="list in claim.candidates" :key="list.local_id">
            <label class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface/40">
              <input
                v-model="selected"
                type="checkbox"
                :value="list.local_id"
                class="size-4 shrink-0 accent-accent"
              />
              <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ list.title }}</span>
              <span class="shrink-0 text-xs text-muted">{{ itemCount(list.items.length) }}</span>
            </label>
          </li>
        </ul>
      </fieldset>

      <p class="mt-3 text-xs text-muted">
        Lists you leave unchecked stay on this device, and we'll ask again next time you sign in.
      </p>

      <p v-if="tooMany" role="alert" class="mt-2 text-sm text-accent">
        You can add up to {{ max }} lists at a time. Uncheck a few, then add the rest next time.
      </p>
      <p v-else-if="claim.error" role="alert" class="mt-2 text-sm text-accent">
        {{ claim.error }}
      </p>

      <div class="mt-6 flex justify-end gap-3">
        <BaseButton
          variant="secondary"
          size="sm"
          type="button"
          :disabled="claim.pending"
          @click="dismiss"
        >
          Not now
        </BaseButton>
        <BaseButton
          size="sm"
          type="button"
          :disabled="claim.pending || count === 0 || tooMany"
          @click="confirm"
        >
          {{ confirmLabel }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
