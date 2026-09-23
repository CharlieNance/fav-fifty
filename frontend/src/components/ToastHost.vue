<script setup lang="ts">
/**
 * The one place toasts are rendered — mounted once in App.vue so a message can
 * survive the navigation that triggered it (see stores/toasts.ts).
 *
 * Top-center on every screen size (docs/DESIGN.md §Toasts), dropping in from
 * above the viewport: where the eye already is after clicking something in the
 * header, and clear of the thumb on mobile. Offset to clear the header rather
 * than cover it.
 *
 * Announced politely: the region is always in the DOM with `aria-live`, so a
 * screen reader reads toasts as they arrive instead of ignoring a container
 * that only appears at the same moment its content does. `polite`, not
 * `assertive` — these are confirmations, not interruptions. If a future error
 * toast ever needs to cut in, give it its own assertive region rather than
 * upgrading this one.
 */
import { storeToRefs } from 'pinia'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import type { FunctionalComponent } from 'vue'

import { useToastStore, type ToastVariant } from '@/stores/toasts'

const store = useToastStore()
const { toasts } = storeToRefs(store)

// Written out in full, never interpolated: Tailwind only ships classes it can
// see as literal strings.
const variantClasses: Record<ToastVariant, string> = {
  success: 'bg-success text-success-ink border-success-border',
  warning: 'bg-warning text-warning-ink border-warning-border',
  error: 'bg-error text-error-ink border-error-border',
}

// Color alone shouldn't carry the meaning (docs/DESIGN.md §Accessibility), so
// each variant also gets a shape. The message text says it too.
const variantIcons: Record<ToastVariant, FunctionalComponent> = {
  success: CheckCircleIcon,
  warning: ExclamationTriangleIcon,
  error: XCircleIcon,
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4 sm:top-20"
    role="status"
    aria-live="polite"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg motion-safe:animate-drop-in"
      :class="variantClasses[toast.variant]"
    >
      <component :is="variantIcons[toast.variant]" class="size-5 shrink-0" aria-hidden="true" />
      <p class="flex-1 text-sm font-medium">{{ toast.message }}</p>
      <!-- Not IconButton: that one paints its own `text-muted`, and on a filled
           chip the close control has to inherit the chip's ink instead. -->
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        class="shrink-0 cursor-pointer rounded-full p-1 opacity-70 transition-opacity duration-150 ease-out hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current motion-safe:active:scale-90"
        @click="store.dismiss(toast.id)"
      >
        <XMarkIcon class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
