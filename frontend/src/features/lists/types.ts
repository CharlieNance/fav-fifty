/**
 * A list as the API returns it (`GET /api/lists`, `GET /api/lists/:id`) — mirrors
 * the backend's `ListRead` schema (`backend/app/schemas/list.py`) field-for-field,
 * including its snake_case JSON keys.
 */
export interface ListSummary {
  id: string
  title: string
  status: string
  tags: string[]
  created_at: string
  updated_at: string
}

/**
 * A ranked item as the API returns it (`GET /api/lists/:id/items` and friends) —
 * mirrors the backend's `ItemRead` schema (`backend/app/schemas/list_item.py`)
 * field-for-field, including its snake_case JSON keys. `position` is the 1-based
 * rank, always contiguous `1..N` (the backend repacks on delete/reorder).
 */
export interface ListItem {
  id: string
  list_id: string
  position: number
  text: string
  note: string | null
  image_url: string | null
  created_at: string
  updated_at: string
}

/** The editable fields of an item — the body of both `POST` (create) and `PATCH` (edit). */
export interface ListItemDraft {
  text: string
  note: string | null
  image_url: string | null
}
