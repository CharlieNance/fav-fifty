/**
 * A list as the API returns it (`GET /api/lists`, `GET /api/lists/:id`) — mirrors
 * the backend's `ListRead` schema (`backend/app/schemas/list.py`) field-for-field,
 * including its snake_case JSON keys.
 */
export interface ListSummary {
  id: string
  title: string
  status: string
  created_at: string
  updated_at: string
}
