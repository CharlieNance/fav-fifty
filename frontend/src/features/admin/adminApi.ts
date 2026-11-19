/**
 * The admin API (backend/app/api/routes/admin.py), typed to match its snake_case
 * JSON. The backend is the real gate (`require_admin` on every route); nothing
 * here can grant admin, which only the CLI on the box can do.
 */
import { ApiError, apiFetch } from '@/api/client'
import type { ListItem, ListSummary } from '@/features/lists/types'

export interface AuditLogEntry {
  id: string
  admin_user_id: string | null
  action: string
  target_type: string
  target_id: string
  reason: string | null
  details: Record<string, unknown>
  created_at: string
  /** Filled in by the audit-log page's endpoint only; null for a deleted account. */
  admin_display_name?: string | null
  /** The user this is about: the target user, or a target list's owner. */
  subject_user_id?: string | null
  subject_display_name?: string | null
}

/** Filters for the audit-log page. Empty means no filter. */
export interface AuditFilters {
  action?: string
  target_type?: string
  /** Everything about one user: their account and their lists. */
  subject_user_id?: string
}

export interface AdminUserSummary {
  id: string
  display_name: string
  email: string | null
  avatar_url: string | null
  role: string
  is_active: boolean
  created_at: string
  last_login_at: string | null
  list_count: number
}

export interface AdminUserDetail extends AdminUserSummary {
  item_count: number
  recent_actions: AuditLogEntry[]
}

export interface Setting {
  key: string
  kind: 'int' | 'bool'
  description: string
  default: number | boolean
  minimum: number | null
  maximum: number | null
  /** What the app is using now: the stored override if valid, else the default. */
  value: number | boolean
  /** The stored text, or null when the setting is on its code default. */
  override: string | null
  override_invalid: boolean
  last_change: AuditLogEntry | null
}

export type UserAction = 'lock' | 'unlock' | 'revoke-sessions'

/** `GET /admin/dashboard` (backend app/schemas/admin.py `Dashboard`). */
export interface RequestCounts {
  requests: number
  /** 4xx other than 429. */
  client_errors: number
  server_errors: number
  rate_limited: number
}

export interface Dashboard {
  generated_at: string
  product: {
    users_total: number
    users_new_7d: number
    users_new_30d: number
    users_signed_in_7d: number
    users_locked: number
    lists_live: number
    items_live: number
    daily: {
      day: string
      users_created: number
      lists_created: number
      lists_imported: number
      items_created: number
    }[]
  }
  /** First-party events (`POST /events`): sessions per day and totals per event. */
  analytics: {
    /** `features.events_enabled`: off means nothing new is being recorded. */
    enabled: boolean
    window_days: number
    daily: { day: string; anonymous_sessions: number; signed_in_sessions: number }[]
    by_name: { name: string; anonymous: number; signed_in: number }[]
  }
  health: {
    window_hours: number
    totals: RequestCounts
    by_route: (RequestCounts & { route_class: string })[]
    hourly: (RequestCounts & { hour: string })[]
  }
  /** Null until the daily job has taken a snapshot. Amounts are decimal strings. */
  cost: {
    taken_at: string
    month: string
    month_to_date: string
    forecast: string | null
    currency: string
    by_service: Record<string, string>
  } | null
  cloudwatch_dashboard_url: string | null
}

/** `GET /admin/abuse` (backend app/schemas/admin.py `AbuseOverview`). */
export interface AbuseOverview {
  window_hours: number
  /** The address the admin's own requests come from: never block it. */
  your_ip: string
  rate_limited_total: number
  by_route: { route_class: string; requests: number; rate_limited: number }[]
  top_ips: IpActivity[]
}

export interface IpActivity {
  ip: string
  requests: number
  rate_limited: number
  /** The block-list entry covering this IP, if any. */
  blocked_by: string | null
}

export interface BlockedIp {
  network: string
  /** Null for an entry added outside the app (no audit row). */
  blocked_at: string | null
  blocked_by: string | null
  reason: string | null
}

/** `GET /admin/blocked-ips`. Only the WAF enforces the list; locally it's a file. */
export interface BlockList {
  source: 'waf' | 'local' | 'memory'
  enforced: boolean
  entries: BlockedIp[]
}

/** The windows the abuse view offers, in hours (the backend keeps 7 days). */
export const ABUSE_WINDOWS = [1, 24, 72, 168] as const

/** Any user's list, deleted ones included (backend AdminListSummary). */
export interface AdminListSummary extends ListSummary {
  deleted_at: string | null
  /** Deleted by an admin (restorable), not by its owner. */
  removed_by_admin: boolean
}

export interface AdminListDetail extends AdminListSummary {
  user_id: string
  owner_display_name: string
  items: ListItem[]
  recent_actions: AuditLogEntry[]
}

export const USER_PAGE_SIZE = 25
export const AUDIT_PAGE_SIZE = 50
/** The Users search waits for typing to pause this long. */
export const SEARCH_DEBOUNCE_MS = 300

function post<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export const adminApi = {
  dashboard(refresh = false): Promise<Dashboard> {
    return apiFetch(`/admin/dashboard${refresh ? '?refresh=true' : ''}`)
  },
  searchUsers(query: string, offset = 0): Promise<AdminUserSummary[]> {
    const params = new URLSearchParams({ limit: String(USER_PAGE_SIZE), offset: String(offset) })
    if (query.trim()) params.set('q', query.trim())
    return apiFetch(`/admin/users?${params}`)
  },
  getUser(id: string): Promise<AdminUserDetail> {
    return apiFetch(`/admin/users/${encodeURIComponent(id)}`)
  },
  actOnUser(id: string, action: UserAction, reason: string): Promise<AdminUserDetail> {
    return post(`/admin/users/${encodeURIComponent(id)}/${action}`, { reason: reason || null })
  },
  /** Audit-logged on the server: reading someone's lists is reading their content. */
  userLists(userId: string): Promise<AdminListSummary[]> {
    return apiFetch(`/admin/users/${encodeURIComponent(userId)}/lists`)
  },
  /** Audit-logged on the server, like {@link adminApi.userLists}. */
  getList(id: string): Promise<AdminListDetail> {
    return apiFetch(`/admin/lists/${encodeURIComponent(id)}`)
  },
  /** The reason is required for a removal. */
  removeList(id: string, reason: string): Promise<AdminListDetail> {
    return post(`/admin/lists/${encodeURIComponent(id)}/remove`, { reason })
  },
  restoreList(id: string, reason: string): Promise<AdminListDetail> {
    return post(`/admin/lists/${encodeURIComponent(id)}/restore`, { reason: reason || null })
  },
  /** Newest first; pass the last entry's `created_at` as `before` for the next page. */
  auditLog(filters: AuditFilters, before?: string): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    if (before) params.set('before', before)
    return apiFetch(`/admin/audit-log?${params}`)
  },
  abuse(hours: number): Promise<AbuseOverview> {
    return apiFetch(`/admin/abuse?hours=${hours}`)
  },
  blockedIps(): Promise<BlockList> {
    return apiFetch('/admin/blocked-ips')
  },
  /** An address or CIDR range; the reason is required. */
  blockIp(network: string, reason: string): Promise<BlockList> {
    return post('/admin/blocked-ips', { network, reason })
  },
  unblockIp(network: string, reason: string): Promise<BlockList> {
    return post('/admin/blocked-ips/remove', { network, reason: reason || null })
  },
  listSettings(): Promise<Setting[]> {
    return apiFetch('/admin/settings')
  },
  updateSetting(key: string, value: number | boolean, reason: string): Promise<Setting> {
    return apiFetch(`/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value, reason: reason || null }),
    })
  },
  resetSetting(key: string, reason: string): Promise<Setting> {
    return post(`/admin/settings/${encodeURIComponent(key)}/reset`, { reason: reason || null })
  },
}

/** What went wrong, in words for the owner, and whether signing in again fixes it. */
export interface AdminProblem {
  message: string
  /** The session is too old for admin tools (backend: 12 h): offer to sign in again. */
  reauth: boolean
}

export const REAUTH_DETAIL = 'Sign in again to use admin tools'

export function adminProblem(error: unknown): AdminProblem {
  if (error instanceof ApiError) {
    if (error.status === 403 && error.detail === REAUTH_DETAIL) {
      return { message: 'For safety, admin tools need a recent sign-in.', reauth: true }
    }
    if (error.status === 401) {
      return { message: 'You’ve been signed out.', reauth: true }
    }
    if (error.status === 403) return { message: 'Admins only.', reauth: false }
    if (error.detail) return { message: error.detail, reauth: false }
    return { message: `Something went wrong (${error.status}).`, reauth: false }
  }
  return { message: 'Couldn’t reach the server. Check your connection.', reauth: false }
}

/** A short, local date-time for tables. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** `lock_user` → `Locked`; unknown actions fall back to the raw name. */
const ACTION_LABELS: Record<string, string> = {
  lock_user: 'Locked',
  unlock_user: 'Unlocked',
  revoke_sessions: 'Signed out everywhere',
  grant_admin: 'Made admin (CLI)',
  revoke_admin: 'Admin removed (CLI)',
  read_lists: 'Viewed their lists',
  read_list: 'Viewed',
  remove_list: 'Removed',
  restore_list: 'Restored',
  update_setting: 'Changed',
  reset_setting: 'Reset to default',
  block_ip: 'Blocked',
  unblock_ip: 'Unblocked',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/** Every action the backend records, for the audit-log filter. */
export const AUDIT_ACTIONS = Object.keys(ACTION_LABELS)

export const TARGET_TYPE_LABELS: Record<string, string> = {
  user: 'Accounts',
  list: 'Lists',
  setting: 'Settings',
  ip: 'IP addresses',
}

/** A setting change as `25 → 30`; "default" stands for no override. */
export function settingChange(details: Record<string, unknown>): string | null {
  if (!('from' in details) || !('to' in details)) return null
  const show = (value: unknown) => (value === null ? 'default' : String(value))
  return `${show(details.from)} → ${show(details.to)}`
}
