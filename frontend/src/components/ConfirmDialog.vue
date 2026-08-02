<script setup lang="ts">
/**
 * Generic confirm-before-destructive-action overlay (Interaction 4,
 * docs/LISTS_CRUD_PLAN.md) — first use of this pattern in the app, kept free of
 * any list-specific knowledge (title/message/labels are all props) so it's
 * reusable later for deleting items/comments. It never calls an API itself:
 * `confirm` only fires the event, and the caller reports back `pending`/`error`
 * as props so this stays a dumb, easily-testable shell around the decision.
 */
import BaseButton from './BaseButton.vue'

withDefaults(
  defineProps<{
    /** Dialog heading, e.g. "Delete 'Best sandwiches'?" */
    title: string
    /** Supporting copy, e.g. "This can't be undone." */
    message: string
    confirmLabel?: string
    cancelLabel?: string
    /** Shown on the confirm button instead of confirmLabel while the caller's action is in flight. */
    pendingLabel?: string
    /** True while the caller's confirm handler is in flight — disables both buttons. */
    pending?: boolean
    /** Surfaced inline (e.g. after a failed API call) without closing the dialog. */
    error?: string | null
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    pendingLabel: 'Working…',
    pending: false,
    error: null,
  },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

function cancel(): void {
  emit('cancel')
}

function confirm(): void {
  emit('confirm')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-canvas/50 px-4"
    @click.self="cancel"
    @keydown.escape="cancel"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-heading"
      class="w-full max-w-sm rounded-2xl border border-border bg-elevated p-6 shadow-xl"
    >
      <h2 id="confirm-dialog-heading" class="font-display text-xl font-bold text-ink">
        {{ title }}
      </h2>
      <p class="mt-2 text-sm text-muted">{{ message }}</p>

      <p v-if="error" role="alert" class="mt-2 text-sm text-accent">{{ error }}</p>

      <div class="mt-6 flex justify-end gap-3">
        <BaseButton variant="secondary" size="sm" type="button" :disabled="pending" @click="cancel">
          {{ cancelLabel }}
        </BaseButton>
        <BaseButton size="sm" type="button" :disabled="pending" @click="confirm">
          {{ pending ? pendingLabel : confirmLabel }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
