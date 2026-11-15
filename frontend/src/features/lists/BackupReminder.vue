<script setup lang="ts">
/**
 * "Keep your lists safe" banner for anonymous visitors with enough on this device
 * to be worth keeping (2+ lists or 20+ items). See `useBackupReminder` for when it
 * shows and how dismissing works.
 *
 * "Sign in" / "create a FREE account" go to a plain `/login` / `/signup` (the same
 * Google flow), not back to this page: after sign-in the
 * app lands on `/lists`, where the claim dialog offers these lists. Coming back to
 * a device list's own page would show "not found", since its id isn't the
 * account's.
 */
import { CloudArrowUpIcon, XMarkIcon } from '@heroicons/vue/24/outline'

import BaseButton from '@/components/BaseButton.vue'
import { useBackupReminder } from './useBackupReminder'
import { useListTransfer } from './useListTransfer'

const { visible, totals, dismiss } = useBackupReminder()
const { exporting, exportLists } = useListTransfer()
</script>

<template>
  <aside
    v-if="visible"
    aria-labelledby="backup-reminder-heading"
    class="relative mt-4 rounded-xl border border-border bg-surface/60 p-4 pr-10"
    data-testid="backup-reminder"
  >
    <div class="flex gap-3">
      <CloudArrowUpIcon class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
      <div class="min-w-0">
        <h2 id="backup-reminder-heading" class="font-semibold text-ink">Keep your lists safe</h2>
        <p class="mt-1 text-sm text-muted">
          Your {{ totals.lists === 1 ? 'list is' : `${totals.lists} lists are` }} saved in this
          browser only. Clearing your browsing data deletes them, and Safari can too after a week
          without a visit.
          <RouterLink to="/login" class="font-medium text-ink underline hover:text-accent"
            >Sign in</RouterLink
          >
          or
          <RouterLink to="/signup" class="font-medium text-ink underline hover:text-accent"
            >create a FREE account</RouterLink
          >
          to keep them safe, or save a backup file.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <BaseButton variant="secondary" size="sm" :disabled="exporting" @click="exportLists()">
            {{ exporting ? 'Exporting…' : 'Export a backup' }}
          </BaseButton>
        </div>
      </div>
    </div>
    <button
      type="button"
      aria-label="Dismiss reminder"
      class="absolute right-2 top-2 rounded-full p-1.5 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      @click="dismiss()"
    >
      <XMarkIcon class="size-4" aria-hidden="true" />
    </button>
  </aside>
</template>
