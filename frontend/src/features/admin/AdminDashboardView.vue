<script setup lang="ts">
/**
 * Admin → Dashboard (docs/ADMIN_AND_ANALYTICS_PLAN.md §Dashboards): product
 * numbers from Postgres, sessions and events from `POST /events` (anonymous
 * visitors included), the last 24 hours of requests from the app's own counters,
 * and the latest daily cost snapshot. Aggregates only, never content.
 * The server caches it for ~5 minutes; Refresh skips that.
 */
import { computed, onMounted, ref } from 'vue'

import BaseButton from '@/components/BaseButton.vue'
import AdminProblem from './AdminProblem.vue'
import BarChart, { type Bar } from './BarChart.vue'
import {
  adminApi,
  adminProblem,
  formatWhen,
  type AdminProblem as Problem,
  type Dashboard,
} from './adminApi'

const data = ref<Dashboard | null>(null)
const loading = ref(false)
const problem = ref<Problem | null>(null)

async function load(refresh = false): Promise<void> {
  loading.value = true
  problem.value = null
  try {
    data.value = await adminApi.dashboard(refresh)
  } catch (error) {
    problem.value = adminProblem(error)
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
const hourLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

type DailyKey = 'users_created' | 'lists_created' | 'items_created'
function daily(key: DailyKey): Bar[] {
  return (data.value?.product.daily ?? []).map((d) => ({ label: dayLabel(d.day), value: d[key] }))
}
type SessionKey = 'anonymous_sessions' | 'signed_in_sessions'
function sessions(key: SessionKey): Bar[] {
  return (data.value?.analytics.daily ?? []).map((d) => ({ label: dayLabel(d.day), value: d[key] }))
}
/** `import_succeeded` → `Import succeeded`. */
const eventLabel = (name: string) => {
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const hourly = computed<Bar[]>(() =>
  (data.value?.health.hourly ?? []).map((h) => ({ label: hourLabel(h.hour), value: h.requests })),
)

function money(amount: string, currency: string): string {
  return Number(amount).toLocaleString(undefined, { style: 'currency', currency })
}

const services = computed(() =>
  Object.entries(data.value?.cost?.by_service ?? {}).sort((a, b) => Number(b[1]) - Number(a[1])),
)

function percent(part: number, whole: number): string {
  if (whole === 0) return '0%'
  return `${((part / whole) * 100).toFixed(part / whole < 0.01 ? 1 : 0)}%`
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="font-display text-3xl font-extrabold text-ink">Dashboard</h1>
    <BaseButton variant="secondary" size="sm" :disabled="loading" @click="load(true)">
      {{ loading ? 'Refreshing…' : 'Refresh' }}
    </BaseButton>
  </div>

  <AdminProblem v-if="problem" :problem="problem" />
  <p v-else-if="!data" class="mt-6 text-sm text-muted" role="status">Loading…</p>

  <template v-if="data">
    <p class="mt-1 text-xs text-muted">As of {{ formatWhen(data.generated_at) }}</p>

    <!-- Product -->
    <section class="mt-8" aria-labelledby="dash-product">
      <h2 id="dash-product" class="font-display text-xl font-bold text-ink">Product</h2>
      <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Accounts</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.product.users_total.toLocaleString() }}
          </dd>
          <dd class="text-xs text-muted">
            +{{ data.product.users_new_7d }} this week · +{{ data.product.users_new_30d }} in 30
            days
          </dd>
        </div>
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Signed in, last 7 days</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.product.users_signed_in_7d.toLocaleString() }}
          </dd>
          <dd v-if="data.product.users_locked" class="text-xs text-muted">
            {{ data.product.users_locked }} locked
          </dd>
        </div>
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Lists</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.product.lists_live.toLocaleString() }}
          </dd>
        </div>
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Items</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.product.items_live.toLocaleString() }}
          </dd>
        </div>
      </dl>
      <p class="mt-2 text-xs text-muted">
        Signed-in accounts only. Anonymous visitors are under Analytics.
      </p>

      <div class="mt-6 grid gap-6 sm:grid-cols-3">
        <div>
          <h3 class="text-sm font-medium text-ink">New accounts per day</h3>
          <BarChart class="mt-2" title="New accounts" :bars="daily('users_created')" />
        </div>
        <div>
          <h3 class="text-sm font-medium text-ink">Lists created per day</h3>
          <BarChart class="mt-2" title="Lists created" :bars="daily('lists_created')" />
        </div>
        <div>
          <h3 class="text-sm font-medium text-ink">Items added per day</h3>
          <BarChart class="mt-2" title="Items added" :bars="daily('items_created')" />
        </div>
      </div>
    </section>

    <!-- Analytics -->
    <section class="mt-10" aria-labelledby="dash-analytics">
      <h2 id="dash-analytics" class="font-display text-xl font-bold text-ink">
        Analytics, last {{ data.analytics.window_days }} days
      </h2>
      <p v-if="!data.analytics.enabled" class="mt-2 text-sm text-muted">
        Event collection is off, so nothing new is being recorded. Turn on
        <RouterLink
          :to="{ name: 'admin-settings' }"
          class="font-medium text-ink underline hover:text-accent"
          >Events enabled</RouterLink
        >
        in Settings.
      </p>

      <div class="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 class="text-sm font-medium text-ink">Anonymous sessions per day</h3>
          <BarChart
            class="mt-2"
            title="Anonymous sessions"
            :bars="sessions('anonymous_sessions')"
          />
        </div>
        <div>
          <h3 class="text-sm font-medium text-ink">Signed-in sessions per day</h3>
          <BarChart
            class="mt-2"
            title="Signed-in sessions"
            :bars="sessions('signed_in_sessions')"
          />
        </div>
      </div>

      <table class="mt-6 w-full text-sm">
        <caption class="text-left text-sm font-medium text-ink">
          Events
        </caption>
        <thead>
          <tr class="text-left text-xs text-muted">
            <th scope="col" class="py-1 font-medium">Event</th>
            <th scope="col" class="py-1 text-right font-medium">Anonymous</th>
            <th scope="col" class="py-1 text-right font-medium">Signed in</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="row in data.analytics.by_name" :key="row.name" class="text-ink">
            <th scope="row" class="py-1 text-left font-normal">{{ eventLabel(row.name) }}</th>
            <td class="py-1 text-right tabular-nums">{{ row.anonymous.toLocaleString() }}</td>
            <td class="py-1 text-right tabular-nums">{{ row.signed_in.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
      <p class="mt-2 text-xs text-muted">
        A session is one browser tab, from opening the site until the tab closes. Page views and
        referrers are in Cloudflare Web Analytics.
      </p>
    </section>

    <!-- Health -->
    <section class="mt-10" aria-labelledby="dash-health">
      <h2 id="dash-health" class="font-display text-xl font-bold text-ink">
        Health, last {{ data.health.window_hours }} hours
      </h2>
      <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Requests</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.health.totals.requests.toLocaleString() }}
          </dd>
        </div>
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Server errors (5xx)</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.health.totals.server_errors.toLocaleString() }}
          </dd>
          <dd class="text-xs text-muted">
            {{ percent(data.health.totals.server_errors, data.health.totals.requests) }}
          </dd>
        </div>
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Rate-limited (429)</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.health.totals.rate_limited.toLocaleString() }}
          </dd>
        </div>
        <div class="rounded-xl border border-border p-3">
          <dt class="text-xs text-muted">Other 4xx</dt>
          <dd class="font-display text-2xl font-bold text-ink tabular-nums">
            {{ data.health.totals.client_errors.toLocaleString() }}
          </dd>
        </div>
      </dl>

      <h3 class="mt-6 text-sm font-medium text-ink">Requests per hour</h3>
      <BarChart class="mt-2" title="Requests" :bars="hourly" />

      <table v-if="data.health.by_route.length" class="mt-6 w-full text-sm">
        <caption class="text-left text-sm font-medium text-ink">
          By route
        </caption>
        <thead>
          <tr class="text-left text-xs text-muted">
            <th scope="col" class="py-1 font-medium">Route</th>
            <th scope="col" class="py-1 text-right font-medium">Requests</th>
            <th scope="col" class="py-1 text-right font-medium">5xx</th>
            <th scope="col" class="py-1 text-right font-medium">429</th>
            <th scope="col" class="py-1 text-right font-medium">Other 4xx</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="row in data.health.by_route" :key="row.route_class" class="text-ink">
            <th scope="row" class="py-1 text-left font-normal">{{ row.route_class }}</th>
            <td class="py-1 text-right tabular-nums">{{ row.requests.toLocaleString() }}</td>
            <td class="py-1 text-right tabular-nums">{{ row.server_errors.toLocaleString() }}</td>
            <td class="py-1 text-right tabular-nums">{{ row.rate_limited.toLocaleString() }}</td>
            <td class="py-1 text-right tabular-nums">{{ row.client_errors.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>

      <p class="mt-4 text-sm">
        <a
          v-if="data.cloudwatch_dashboard_url"
          :href="data.cloudwatch_dashboard_url"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-ink underline hover:text-accent"
          >CloudWatch dashboard</a
        >
        <span v-else class="text-muted"
          >CloudWatch (edge, Lambda and box metrics) gets linked here after the first deploy.</span
        >
      </p>
    </section>

    <!-- Cost -->
    <section class="mt-10" aria-labelledby="dash-cost">
      <h2 id="dash-cost" class="font-display text-xl font-bold text-ink">AWS cost</h2>
      <p v-if="!data.cost" class="mt-2 text-sm text-muted">
        No snapshot yet. The daily job records one once Cost Explorer access is set up.
      </p>
      <template v-else>
        <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-xl border border-border p-3">
            <dt class="text-xs text-muted">This month so far</dt>
            <dd class="font-display text-2xl font-bold text-ink tabular-nums">
              {{ money(data.cost.month_to_date, data.cost.currency) }}
            </dd>
          </div>
          <div class="rounded-xl border border-border p-3">
            <dt class="text-xs text-muted">On pace for</dt>
            <dd class="font-display text-2xl font-bold text-ink tabular-nums">
              {{ data.cost.forecast ? money(data.cost.forecast, data.cost.currency) : '—' }}
            </dd>
          </div>
        </dl>
        <ul v-if="services.length" class="mt-3 divide-y divide-border text-sm">
          <li
            v-for="[service, amount] in services"
            :key="service"
            class="flex justify-between py-1"
          >
            <span class="text-ink">{{ service }}</span>
            <span class="text-ink tabular-nums">{{ money(amount, data.cost.currency) }}</span>
          </li>
        </ul>
        <p class="mt-2 text-xs text-muted">Snapshot taken {{ formatWhen(data.cost.taken_at) }}.</p>
      </template>
    </section>
  </template>
</template>
