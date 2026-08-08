<script setup lang="ts">
/**
 * The add/edit item overlay (Interactions 1 + 2, docs/ITEMS_CRUD_PLAN.md). One
 * component covers both modes — the form (text / note / image URL), validation,
 * and error handling are identical; only the heading, endpoint, and initial
 * values differ, all driven by whether an `item` prop is present. The plan doc
 * sketched these as two components mirroring Create/EditListModal, but unlike
 * those two (different hosting, navigation, and store wiring), these would have
 * been byte-for-byte duplicates.
 *
 * Client-side checks mirror the backend's (`backend/app/schemas/list_item.py`)
 * for fast feedback, but the backend stays the source of truth — its 409s
 * (duplicate text / list full) surface inline without closing the modal.
 */
import { computed, nextTick, onMounted, ref } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import type { ListItem, ListItemDraft } from './types'
import { useCreateItem } from './useCreateItem'
import { useUpdateItem } from './useUpdateItem'

const props = defineProps<{
  listId: string
  /** The item being edited, or null/absent to add a new one. */
  item?: ListItem | null
}>()

const emit = defineEmits<{ saved: [item: ListItem]; cancel: [] }>()

const isEdit = computed(() => props.item != null)

const text = ref(props.item?.text ?? '')
const note = ref(props.item?.note ?? '')
const imageUrl = ref(props.item?.image_url ?? '')
const clientError = ref<string | null>(null)
const textInputRef = ref<HTMLInputElement | null>(null)

const create = useCreateItem()
const update = useUpdateItem()

const pending = computed(() => create.pending.value || update.pending.value)
const error = computed(() => clientError.value ?? create.error.value ?? update.error.value)
const canSave = computed(() => text.value.trim().length > 0 && !pending.value)

function cancel(): void {
  emit('cancel')
}

/** Same trim/blank-to-null shaping the backend applies, so drafts match `ItemRead`. */
function buildDraft(): ListItemDraft | null {
  const trimmedText = text.value.trim()
  if (!trimmedText) {
    clientError.value = 'Text is required.'
    return null
  }
  const trimmedImage = imageUrl.value.trim()
  if (trimmedImage && !/^https?:\/\//.test(trimmedImage)) {
    clientError.value = 'Image URL must start with http:// or https://.'
    return null
  }
  return {
    text: trimmedText,
    note: note.value.trim() || null,
    image_url: trimmedImage || null,
  }
}

async function save(): Promise<void> {
  clientError.value = null
  const draft = buildDraft()
  if (!draft) return

  const saved = props.item
    ? await update.updateItem(props.listId, props.item.id, draft)
    : await create.createItem(props.listId, draft)
  if (saved) {
    emit('saved', saved)
  }
}

onMounted(async () => {
  await nextTick()
  textInputRef.value?.focus()
})
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
      aria-labelledby="item-form-heading"
      class="w-full max-w-md rounded-2xl border border-border bg-elevated p-6 shadow-xl motion-safe:animate-rise-in"
    >
      <h2 id="item-form-heading" class="font-display text-xl font-bold text-ink">
        {{ isEdit ? 'Edit item' : 'Add an item' }}
      </h2>

      <form class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label for="item-text" class="mb-1 block text-sm font-medium text-muted">Name</label>
          <input
            id="item-text"
            ref="textInputRef"
            v-model="text"
            type="text"
            placeholder="e.g. The Empire Strikes Back"
            maxlength="500"
            class="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-ink transition-colors focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>

        <div>
          <label for="item-note" class="mb-1 block text-sm font-medium text-muted">
            Note <span class="font-normal">(optional)</span>
          </label>
          <textarea
            id="item-note"
            v-model="note"
            rows="2"
            placeholder="Why it deserves the spot…"
            maxlength="2000"
            class="w-full resize-y rounded-lg border border-border bg-transparent px-4 py-2 text-ink transition-colors focus-visible:outline-2 focus-visible:outline-accent"
          ></textarea>
        </div>

        <div>
          <label for="item-image-url" class="mb-1 block text-sm font-medium text-muted">
            Image URL <span class="font-normal">(optional)</span>
          </label>
          <input
            id="item-image-url"
            v-model="imageUrl"
            type="url"
            placeholder="https://…"
            maxlength="2048"
            class="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-ink transition-colors focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>

        <p v-if="error" role="alert" class="text-sm text-accent">{{ error }}</p>

        <div class="flex justify-end gap-3 pt-2">
          <BaseButton variant="secondary" size="sm" type="button" @click="cancel">
            Cancel
          </BaseButton>
          <BaseButton size="sm" type="submit" :disabled="!canSave">
            {{ pending ? 'Saving…' : isEdit ? 'Save' : 'Add item' }}
          </BaseButton>
        </div>
      </form>
    </div>
  </div>
</template>
