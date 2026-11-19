<script setup lang="ts">
/**
 * Admin → Abuse (docs/ARCHITECTURE.md §Abuse view): who's being rate
 * limited, the busiest client addresses, and the IP block list.
 *
 * The numbers are the app's own counts (per route per minute, per IP per hour, IPs
 * kept 7 days). The block list is the WAF's: blocking happens at the edge, so a
 * blocked visitor never reaches the app. Locally it's a file nothing enforces, and
 * the page says so. Every block and unblock is audit-logged with its reason.
 */
import { computed, onMounted, ref, watch } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import { useToastStore } from '@/stores/toasts'
import AdminActionDialog from './AdminActionDialog.vue'
import AdminProblem from './AdminProblem.vue'
import {
  ABUSE_WINDOWS,
  adminApi,
  adminProblem,
  formatWhen,
  type AbuseOverview,
  type AdminProblem as Problem,
  type BlockList,
} from './adminApi'

const toasts = useToastStore()

const WINDOW_LABELS: Record<number, string> = {
  1: 'Last hour',
  24: 'Last 24 hours',
  72: 'Last 3 days',
  168: 'Last 7 days',
}

const hours = ref<number>(24)
const overview = ref<AbuseOverview | null>(null)
const overviewProblem = ref<Problem | null>(null)
const blockList = ref<BlockList | null>(null)
const blockListProblem = ref<Problem | null>(null)

// A slow response for an older window can't overwrite a newer one.
let latest = 0

async function loadOverview(): Promise<void> {
  const run = ++latest
  overviewProblem.value = null
  try {
    const data = await adminApi.abuse(hours.value)
    if (run === latest) overview.value = data
  } catch (error) {
    if (run === latest) overviewProblem.value = adminProblem(error)
  }
}

async function loadBlockList(): Promise<void> {
  blockListProblem.value = null
  try {
    blockList.value = await adminApi.blockedIps()
  } catch (error) {
    blockListProblem.value = adminProblem(error)
  }
}

watch(hours, () => void loadOverview())
onMounted(() => {
  void loadOverview()
  void loadBlockList()
})

// ─── Block / unblock ───────────────────────────────────────────────────────────

const newNetwork = ref('')
const pending = ref<{ kind: 'block' | 'unblock'; network: string } | null>(null)
const acting = ref(false)
const actionError = ref<string | null>(null)

const dialog = computed(() => {
  if (!pending.value) return null
  const { kind, network } = pending.value
  return kind === 'block'
    ? {
        title: `Block ${network}?`,
        message: blockList.value?.enforced
          ? 'Every request from it is refused at the edge, before it reaches the app.'
          : 'Added to the local list. Nothing enforces it here; in production the WAF does.',
        confirmLabel: 'Block',
        reasonRequired: true,
      }
    : {
        title: `Unblock ${network}?`,
        message: 'Requests from it are let through again.',
        confirmLabel: 'Unblock',
        reasonRequired: false,
      }
})

function ask(kind: 'block' | 'unblock', network: string): void {
  const trimmed = network.trim()
  if (!trimmed) return
  actionError.value = null
  pending.value = { kind, network: trimmed }
}

function close(): void {
  if (!acting.value) pending.value = null
}

async function confirm(reason: string): Promise<void> {
  if (!pending.value) return
  const { kind, network } = pending.value
  acting.value = true
  actionError.value = null
  try {
    blockList.value =
      kind === 'block'
        ? await adminApi.blockIp(network, reason)
        : await adminApi.unblockIp(network, reason)
    pending.value = null
    if (kind === 'block') newNetwork.value = ''
    toasts.show(kind === 'block' ? `${network} blocked.` : `${network} unblocked.`)
    void loadOverview() // Refresh the "blocked" marks.
  } catch (error) {
    actionError.value = adminProblem(error).message
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="font-display text-3xl font-extrabold text-ink">Abuse</h1>
      <p class="mt-1 text-sm text-muted">
        Rate-limited requests and the busiest addresses, from the app’s own counts. Addresses are
        kept for 7 days.
      </p>
    </div>
    <label class="flex flex-col gap-1 text-sm text-muted">
      Window
      <select
        v-model.number="hours"
        class="rounded-lg border border-control bg-surface px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <option v-for="h in ABUSE_WINDOWS" :key="h" :value="h">{{ WINDOW_LABELS[h] }}</option>
      </select>
    </label>
  </div>

  <AdminProblem v-if="overviewProblem" :problem="overviewProblem" />
  <p v-else-if="!overview" class="mt-6 text-sm text-muted" role="status">Loading…</p>
  <template v-else>
    <!-- Rate limited -->
    <section class="mt-8" aria-labelledby="abuse-limited">
      <h2 id="abuse-limited" class="font-display text-xl font-bold text-ink">Rate limited</h2>
      <p class="mt-1 text-sm text-muted">
        {{ overview.rate_limited_total.toLocaleString() }}
        {{ overview.rate_limited_total === 1 ? 'request' : 'requests' }} got a 429.
      </p>
      <div v-if="overview.by_route.length" class="mt-3 overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Rate limited by route
          </caption>
          <thead>
            <tr class="text-left text-xs text-muted">
              <th scope="col" class="py-1 font-medium">Route</th>
              <th scope="col" class="py-1 text-right font-medium">Requests</th>
              <th scope="col" class="py-1 text-right font-medium">429</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="row in overview.by_route" :key="row.route_class" class="text-ink">
              <th scope="row" class="py-1 text-left font-normal">{{ row.route_class }}</th>
              <td class="py-1 text-right tabular-nums">{{ row.requests.toLocaleString() }}</td>
              <td class="py-1 text-right tabular-nums">{{ row.rate_limited.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Busiest addresses -->
    <section class="mt-10" aria-labelledby="abuse-ips">
      <h2 id="abuse-ips" class="font-display text-xl font-bold text-ink">Busiest addresses</h2>
      <p v-if="overview.top_ips.length === 0" class="mt-2 text-sm text-muted">
        No requests in this window.
      </p>
      <div v-else class="mt-3 overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Busiest addresses, most rate limited first
          </caption>
          <thead>
            <tr class="text-left text-xs text-muted">
              <th scope="col" class="py-1 font-medium">Address</th>
              <th scope="col" class="py-1 text-right font-medium">Requests</th>
              <th scope="col" class="py-1 text-right font-medium">429</th>
              <th scope="col" class="py-1 pl-4 font-medium"><span class="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="row in overview.top_ips" :key="row.ip" class="text-ink">
              <th scope="row" class="py-1.5 text-left font-mono text-xs font-normal break-all">
                {{ row.ip }}
              </th>
              <td class="py-1.5 text-right tabular-nums">{{ row.requests.toLocaleString() }}</td>
              <td class="py-1.5 text-right tabular-nums">
                {{ row.rate_limited.toLocaleString() }}
              </td>
              <td class="py-1.5 pl-4 text-right whitespace-nowrap">
                <span v-if="row.ip === overview.your_ip" class="text-xs text-muted">You</span>
                <span
                  v-else-if="row.blocked_by"
                  class="rounded-full border border-error-border bg-error px-2 py-0.5 text-xs font-semibold text-error-ink"
                  >Blocked</span
                >
                <BaseButton
                  v-else-if="blockList"
                  variant="secondary"
                  size="sm"
                  :aria-label="`Block ${row.ip}`"
                  @click="ask('block', row.ip)"
                  >Block</BaseButton
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- Block list -->
  <section class="mt-10" aria-labelledby="abuse-blocklist">
    <h2 id="abuse-blocklist" class="font-display text-xl font-bold text-ink">Block list</h2>
    <AdminProblem v-if="blockListProblem" :problem="blockListProblem" />
    <p v-else-if="!blockList" class="mt-2 text-sm text-muted" role="status">Loading…</p>
    <template v-else>
      <p
        v-if="!blockList.enforced"
        class="mt-2 rounded-lg border border-warning-border bg-warning px-3 py-2 text-sm text-warning-ink"
      >
        Not enforced here: this is a local file. In production this list is the WAF’s, and it
        refuses these addresses at the edge.
      </p>
      <p v-else class="mt-1 text-sm text-muted">
        The WAF refuses these at the edge. Changes take effect within a minute or so.
      </p>

      <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="ask('block', newNetwork)">
        <label class="flex grow flex-col gap-1 text-sm text-muted">
          Address or range
          <input
            v-model="newNetwork"
            type="text"
            maxlength="64"
            autocomplete="off"
            spellcheck="false"
            placeholder="203.0.113.7 or 203.0.113.0/24"
            class="rounded-lg border border-control bg-transparent px-3 py-2 font-mono text-ink focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <BaseButton type="submit" :disabled="!newNetwork.trim()">Block…</BaseButton>
      </form>
      <p class="mt-1 text-xs text-muted">At most a /24 (IPv4) or /48 (IPv6) at once.</p>

      <p v-if="blockList.entries.length === 0" class="mt-4 text-sm text-muted">
        Nothing is blocked.
      </p>
      <ul v-else class="mt-4 divide-y divide-border text-sm" aria-label="Blocked addresses">
        <li
          v-for="entry in blockList.entries"
          :key="entry.network"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
        >
          <span class="font-mono text-xs text-ink">{{ entry.network }}</span>
          <span class="text-xs text-muted">
            <template v-if="entry.blocked_at"
              >by {{ entry.blocked_by ?? 'a deleted account' }} ·
              {{ formatWhen(entry.blocked_at) }}</template
            >
            <template v-else>added outside the app</template>
          </span>
          <BaseButton
            class="ml-auto"
            variant="secondary"
            size="sm"
            :aria-label="`Unblock ${entry.network}`"
            @click="ask('unblock', entry.network)"
            >Unblock</BaseButton
          >
          <p v-if="entry.reason" class="w-full break-words text-muted">“{{ entry.reason }}”</p>
        </li>
      </ul>
    </template>
  </section>

  <AdminActionDialog
    v-if="dialog"
    :title="dialog.title"
    :message="dialog.message"
    :confirm-label="dialog.confirmLabel"
    :reason-required="dialog.reasonRequired"
    :pending="acting"
    :error="actionError"
    @confirm="confirm"
    @cancel="close"
  />
</template>
