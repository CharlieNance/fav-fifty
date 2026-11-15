/**
 * A list as the API returns it (`GET /api/v1/lists`, `GET /api/v1/lists/:id`) — mirrors
 * the backend's `ListRead` schema (`backend/app/schemas/list.py`) field-for-field,
 * including its snake_case JSON keys.
 */
export interface ListSummary {
  id: string
  title: string
  status: string
  tags: string[]
  /** Number of ranked items the list holds (0–50). */
  item_count: number
  created_at: string
  updated_at: string
}

/**
 * A ranked item as the API returns it (`GET /api/v1/lists/:id/items` and friends) —
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

/**
 * What became of one uploaded list in `POST /api/v1/lists/import` — mirrors the
 * backend's `ImportedListRead` (`backend/app/schemas/list_import.py`).
 */
export interface ImportedListOutcome {
  /** The `local_id` the list was uploaded with. */
  local_id: string
  /**
   * `created` by this request, or `already_imported` by an earlier one (e.g. a
   * retry after a dropped response), in which case nothing was changed.
   */
  outcome: 'created' | 'already_imported'
  /** The list in the account; `null` if it was already imported and has since been deleted. */
  list: ListSummary | null
  /** The title the upload asked for, when it clashed and was renamed; else `null`. */
  renamed_from: string | null
}

/** The response of `POST /api/v1/lists/import`: one outcome per uploaded list, in order. */
export interface ListsImportResult {
  lists: ImportedListOutcome[]
}
