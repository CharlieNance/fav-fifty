<script setup lang="ts">
/**
 * Admin → Settings: every runtime setting (backend app/core/runtime_settings.py)
 * with its value, default and bounds. Change one, or reset it to its default,
 * without a deploy. Each change is confirmed with an optional audit reason. It
 * applies on this server at once and everywhere within ~30 s.
 *
 * The bounds are checked here for quick feedback; the backend checks them again
 * and is the one that counts.
 */
import { computed, onMounted, reactive, ref } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import { useToastStore } from '@/stores/toasts'
import AdminActionDialog from './AdminActionDialog.vue'
import AdminProblem from './AdminProblem.vue'
import {
  adminApi,
  adminProblem,
  formatWhen,
  type AdminProblem as Problem,
  type Setting,
} from './adminApi'
import { settingGroups, settingLabel, validateDraft, type Draft } from './settingsForm'

const toasts = useToastStore()

const settings = ref<Setting[]>([])
const loading = ref(true)
const problem = ref<Problem | null>(null)
/** What's in each row's control right now, by key. */
const drafts = reactive<Record<string, Draft>>({})

function resetDraft(setting: Setting): void {
  drafts[setting.key] = setting.kind === 'bool' ? Boolean(setting.value) : String(setting.value)
}

async function load(): Promise<void> {
  loading.value = true
  problem.value = null
  try {
    settings.value = await adminApi.listSettings()
    settings.value.forEach(resetDraft)
  } catch (error) {
    problem.value = adminProblem(error)
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())

const groups = computed(() => settingGroups(settings.value))

function check(setting: Setting) {
  return validateDraft(setting, drafts[setting.key] ?? '')
}

// ─── Confirm + save ────────────────────────────────────────────────────────────

interface Pending {
  setting: Setting
  /** null = reset to the default. */
  value: number | boolean | null
}

const pending = ref<Pending | null>(null)
const saving = ref(false)
const saveError = ref<string | null>(null)

function show(value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return value.toLocaleString()
}

const dialog = computed(() => {
  if (!pending.value) return null
  const { setting, value } = pending.value
  const label = settingLabel(setting.key)
  if (value === null) {
    return {
      title: `Reset “${label}”?`,
      message: `Back to its default, ${show(setting.default)}. Applies everywhere within about 30 seconds.`,
      confirmLabel: 'Reset',
    }
  }
  return {
    title: `Change “${label}”?`,
    message: `From ${show(setting.value)} to ${show(value)}. Applies everywhere within about 30 seconds.`,
    confirmLabel: 'Save',
  }
})

function askSave(setting: Setting): void {
  const result = check(setting)
  if (result.error !== null || result.value === null) return
  saveError.value = null
  pending.value = { setting, value: result.value }
}

function askReset(setting: Setting): void {
  saveError.value = null
  pending.value = { setting, value: null }
}

function closeDialog(): void {
  if (!saving.value) pending.value = null
}

async function confirm(reason: string): Promise<void> {
  if (!pending.value) return
  const { setting, value } = pending.value
  saving.value = true
  saveError.value = null
  try {
    const updated =
      value === null
        ? await adminApi.resetSetting(setting.key, reason)
        : await adminApi.updateSetting(setting.key, value, reason)
    settings.value = settings.value.map((s) => (s.key === updated.key ? updated : s))
    resetDraft(updated)
    pending.value = null
    toasts.show(`“${settingLabel(updated.key)}” is now ${show(updated.value)}.`)
  } catch (error) {
    saveError.value = adminProblem(error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <h1 class="font-display text-3xl font-extrabold text-ink">Settings</h1>
  <p class="mt-2 text-sm text-muted">
    Limits and switches you can change without a deploy. Unchanged settings use their default.
  </p>

  <AdminProblem v-if="problem" :problem="problem" />
  <p v-else-if="loading" class="mt-6 text-sm text-muted" role="status">Loading…</p>

  <section v-for="group in groups" :key="group.name" class="mt-8">
    <h2 class="font-display text-xl font-bold text-ink">{{ group.title }}</h2>
    <ul class="mt-2 divide-y divide-border">
      <li v-for="setting in group.settings" :key="setting.key" class="py-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <label :for="`setting-${setting.key}`" class="font-medium text-ink">
              {{ settingLabel(setting.key) }}
            </label>
            <p :id="`setting-${setting.key}-help`" class="text-sm text-muted">
              {{ setting.description }}
              <span class="whitespace-nowrap">
                Default {{ show(setting.default)
                }}<template v-if="setting.minimum !== null"
                  >, {{ setting.minimum.toLocaleString() }}–{{
                    setting.maximum?.toLocaleString()
                  }}</template
                >.
              </span>
            </p>
            <p class="font-mono text-xs text-muted">{{ setting.key }}</p>
          </div>

          <div class="flex items-center gap-2">
            <input
              v-if="setting.kind === 'int'"
              :id="`setting-${setting.key}`"
              v-model="drafts[setting.key]"
              type="number"
              inputmode="numeric"
              step="1"
              :min="setting.minimum ?? undefined"
              :max="setting.maximum ?? undefined"
              :aria-describedby="`setting-${setting.key}-help`"
              :aria-invalid="check(setting).error ? 'true' : undefined"
              class="w-32 rounded-lg border border-control bg-transparent px-3 py-1.5 text-right text-ink focus-visible:outline-2 focus-visible:outline-accent"
            />
            <input
              v-else
              :id="`setting-${setting.key}`"
              v-model="drafts[setting.key]"
              type="checkbox"
              :aria-describedby="`setting-${setting.key}-help`"
              class="size-5 accent-accent"
            />
            <BaseButton
              size="sm"
              :disabled="!check(setting).changed || check(setting).error !== null"
              :aria-label="`Save ${settingLabel(setting.key)}`"
              @click="askSave(setting)"
              >Save</BaseButton
            >
            <BaseButton
              v-if="setting.override !== null"
              variant="secondary"
              size="sm"
              :aria-label="`Reset ${settingLabel(setting.key)}`"
              @click="askReset(setting)"
              >Reset</BaseButton
            >
          </div>
        </div>

        <p v-if="check(setting).error" class="mt-1 text-sm text-accent">
          {{ check(setting).error }}
        </p>
        <p v-if="setting.override_invalid" class="mt-1 text-sm text-accent">
          The stored value “{{ setting.override }}” isn’t valid, so the default is in use.
        </p>
        <p v-if="setting.last_change" class="mt-1 text-xs text-muted">
          Last changed {{ formatWhen(setting.last_change.created_at)
          }}<template v-if="setting.last_change.reason"
            >: “{{ setting.last_change.reason }}”</template
          >
        </p>
      </li>
    </ul>
  </section>

  <AdminActionDialog
    v-if="dialog"
    :title="dialog.title"
    :message="dialog.message"
    :confirm-label="dialog.confirmLabel"
    :pending="saving"
    :error="saveError"
    @confirm="confirm"
    @cancel="closeDialog"
  />
</template>
