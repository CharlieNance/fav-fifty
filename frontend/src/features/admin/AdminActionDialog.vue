<script setup lang="ts">
/**
 * Confirm an admin action, with an optional reason for the audit log. Like
 * ConfirmDialog, it never calls the API itself: it emits `confirm` with the reason,
 * and the caller reports `pending`/`error` back as props.
 */
import { ref } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import BaseDialog from '@/components/BaseDialog.vue'

/** Matches the backend's cap (app/schemas/admin.py MAX_REASON_LENGTH). */
const MAX_REASON_LENGTH = 500

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel: string
    pending?: boolean
    error?: string | null
    /** The action can't go ahead without a reason (e.g. removing someone's list). */
    reasonRequired?: boolean
  }>(),
  { pending: false, error: null, reasonRequired: false },
)

const emit = defineEmits<{ confirm: [reason: string]; cancel: [] }>()

const reason = ref('')

function cancel(): void {
  emit('cancel')
}

function submit(): void {
  const trimmed = reason.value.trim()
  if (props.pending || (props.reasonRequired && !trimmed)) return
  emit('confirm', trimmed)
}
</script>

<template>
  <BaseDialog
    labelledby="admin-action-heading"
    describedby="admin-action-message"
    panel-class="max-w-md"
    @close="cancel"
  >
    <form @submit.prevent="submit">
      <h2 id="admin-action-heading" class="font-display text-xl font-bold text-ink">
        {{ title }}
      </h2>
      <p id="admin-action-message" class="mt-2 text-sm text-muted">{{ message }}</p>

      <label for="admin-action-reason" class="mt-4 block text-sm font-medium text-ink">
        Reason
        <span class="font-normal text-muted"
          >({{ reasonRequired ? 'required' : 'optional' }}, kept in the audit log)</span
        >
      </label>
      <textarea
        id="admin-action-reason"
        v-model="reason"
        rows="2"
        :maxlength="MAX_REASON_LENGTH"
        :required="reasonRequired"
        class="mt-1 w-full rounded-lg border border-control bg-transparent px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
      ></textarea>

      <p v-if="error" role="alert" class="mt-2 text-sm text-accent">{{ error }}</p>

      <div class="mt-6 flex justify-end gap-3">
        <BaseButton variant="secondary" size="sm" type="button" :disabled="pending" @click="cancel">
          Cancel
        </BaseButton>
        <BaseButton
          size="sm"
          type="submit"
          :disabled="pending || (reasonRequired && !reason.trim())"
        >
          {{ pending ? 'Working…' : confirmLabel }}
        </BaseButton>
      </div>
    </form>
  </BaseDialog>
</template>
