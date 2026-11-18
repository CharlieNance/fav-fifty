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
/** The Users search waits for typing to pause this long. */
export const SEARCH_DEBOUNCE_MS = 300

function post<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export const adminApi = {
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
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}
