/** Fixtures shared by the admin specs. */
import type { AdminUserDetail, Setting } from './adminApi'

export function makeSetting(overrides: Partial<Setting> = {}): Setting {
  return {
    key: 'limits.max_tags_per_list',
    kind: 'int',
    description: 'Tags one list can have.',
    default: 25,
    minimum: 1,
    maximum: 200,
    value: 25,
    override: null,
    override_invalid: false,
    last_change: null,
    ...overrides,
  }
}

export function makeUserDetail(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    id: 'user-2',
    display_name: 'Scooby',
    email: 'scooby@example.com',
    avatar_url: null,
    role: 'user',
    is_active: true,
    created_at: '2026-11-01T00:00:00Z',
    last_login_at: '2026-11-10T00:00:00Z',
    list_count: 3,
    item_count: 42,
    recent_actions: [],
    ...overrides,
  }
}
