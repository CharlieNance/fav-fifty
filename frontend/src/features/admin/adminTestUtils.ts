/** Fixtures shared by the admin specs. */
import type { AdminListDetail, AdminUserDetail, Setting } from './adminApi'

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

export function makeListDetail(overrides: Partial<AdminListDetail> = {}): AdminListDetail {
  const item = {
    list_id: 'list-1',
    note: null,
    image_url: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  }
  return {
    id: 'list-1',
    title: 'Secret sandwiches',
    status: 'draft',
    tags: ['food'],
    item_count: 2,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    deleted_at: null,
    removed_by_admin: false,
    user_id: 'user-2',
    owner_display_name: 'Scooby',
    items: [
      { ...item, id: 'i1', position: 1, text: 'Cubano' },
      {
        ...item,
        id: 'i2',
        position: 2,
        text: 'Reuben',
        image_url: 'https://example.com/reuben.png',
      },
    ],
    recent_actions: [],
    ...overrides,
  }
}
