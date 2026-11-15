/**
 * The backend's list/item validation rules, in TypeScript, for on-device storage
 * (docs/ARCHITECTURE.md §The device document). Each function copies one
 * backend validator, error message included:
 *
 * - `validateTitle`        ← `backend/app/schemas/list.py` `_validated_title`
 * - `validateItemDraft`    ← `backend/app/schemas/list_item.py` `_validated_*`
 * - `normalizeTagName`     ← `backend/app/services/tag_service.py` `normalize_tag_name`
 * - `normalizeTags`        ← `TagsUpdate` + `set_list_tags` (dedupe, then cap)
 *
 * The rules here only make the anonymous experience match the signed-in one. The
 * server checks everything again when local lists are imported, so it never trusts
 * these.
 *
 * Failures throw `ListError('invalid', <backend copy>)`. Lengths are counted in
 * Unicode code points, like Python's `len()` and Postgres `varchar(n)`, not UTF-16
 * units, so an emoji counts as one character here as it does on the server.
 */
import type { ClientLimits } from '@/stores/clientConfig'
import { ListError } from './listErrors'
import type { ListItemDraft } from './types'

const WHITESPACE_RE = /\s+/g

/** Length in code points (Python `len`), not UTF-16 code units (JS `.length`). */
export function charLength(value: string): number {
  return Array.from(value).length
}

function invalid(message: string): ListError {
  return new ListError('invalid', message)
}

export function validateTitle(value: string, limits: ClientLimits): string {
  const trimmed = value.trim()
  if (!trimmed) throw invalid('Title is required.')
  if (charLength(trimmed) > limits.max_title_length) {
    throw invalid(`Title must be ${limits.max_title_length} characters or fewer.`)
  }
  return trimmed
}

function validateText(value: string, limits: ClientLimits): string {
  const trimmed = value.trim()
  if (!trimmed) throw invalid('Text is required.')
  if (charLength(trimmed) > limits.max_item_text_length) {
    throw invalid(`Text must be ${limits.max_item_text_length} characters or fewer.`)
  }
  return trimmed
}

function validateNote(value: string | null, limits: ClientLimits): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (charLength(trimmed) > limits.max_note_length) {
    throw invalid(`Note must be ${limits.max_note_length} characters or fewer.`)
  }
  return trimmed
}

/**
 * True for an `http://` or `https://` URL (case-sensitive, like the backend). This is
 * what stops a `javascript:` or `data:` URL from ever reaching an `<img src>`.
 */
export function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function validateImageUrl(value: string | null, limits: ClientLimits): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!isHttpUrl(trimmed)) throw invalid('Image URL must start with http:// or https://.')
  if (charLength(trimmed) > limits.max_image_url_length) {
    throw invalid(`Image URL must be ${limits.max_image_url_length} characters or fewer.`)
  }
  return trimmed
}

/** Trim every field; blank note/URL become `null`. Same rules as `ItemCreate`/`ItemUpdate`. */
export function validateItemDraft(draft: ListItemDraft, limits: ClientLimits): ListItemDraft {
  return {
    text: validateText(draft.text, limits),
    note: validateNote(draft.note, limits),
    image_url: validateImageUrl(draft.image_url, limits),
  }
}

/** Trim, collapse inner whitespace, lower-case. `"  Sci-Fi "` and `"sci-fi"` are one tag. */
export function normalizeTagName(name: string, limits: ClientLimits): string {
  const collapsed = name.trim().replace(WHITESPACE_RE, ' ').toLowerCase()
  if (!collapsed) throw invalid('Tag is required.')
  if (charLength(collapsed) > limits.max_tag_length) {
    throw invalid(`Tag must be ${limits.max_tag_length} characters or fewer.`)
  }
  return collapsed
}

/** Normalize each tag, drop duplicates (keeping first-seen order), then apply the cap. */
export function normalizeTags(names: string[], limits: ClientLimits): string[] {
  const deduped = [...new Set(names.map((name) => normalizeTagName(name, limits)))]
  if (deduped.length > limits.max_tags_per_list) {
    throw invalid(`A list can have at most ${limits.max_tags_per_list} tags.`)
  }
  return deduped
}

/** The server's wording when an account is at `max_lists_per_user` (`POST /lists`). */
export function listQuotaDetail(max: number): string {
  return `You can have at most ${max} lists. Delete one to make room.`
}

/**
 * The server's wording when an import would take an account past
 * `max_lists_per_user` (`POST /lists/import`).
 */
export function importQuotaDetail(have: number, adding: number, max: number): string {
  return (
    `You have ${have} lists, and this would add ${adding}. The limit is ${max}, ` +
    'so delete some lists first or upload fewer.'
  )
}

/**
 * `title`, or `"title (2)"`, `"title (3)"`, … if a list already uses it. `taken`
 * holds the titles in use, lower-cased (the match ignores case). The base is
 * shortened if a suffix would push it over the title limit.
 *
 * The rename rule for imports (docs/ARCHITECTURE.md §Export and import a file). The server import
 * (`POST /lists/import`) renames the same way: keep this in step with
 * `unique_title` in `backend/app/services/list_import_service.py`.
 */
export function uniqueTitle(
  title: string,
  taken: ReadonlySet<string>,
  limits: ClientLimits,
): string {
  if (!taken.has(title.toLowerCase())) return title
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`
    const room = limits.max_title_length - charLength(suffix)
    const base = Array.from(title).slice(0, room).join('').trimEnd()
    const candidate = `${base}${suffix}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
