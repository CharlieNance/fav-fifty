/**
 * The one error type the lists feature deals in, whichever storage is active.
 *
 * Repositories throw `ListError`; nothing above the repository knows about HTTP
 * status codes or `ApiError`. The API repository translates at its boundary
 * (`toListError`), and on-device storage throws `ListError` directly — it has no
 * HTTP, so it shouldn't have to fake status codes.
 */
import { ApiError } from '@/api/client'

export type ListErrorKind =
  /** The list or item doesn't exist (or isn't yours — indistinguishable by design). */
  | 'not-found'
  /** A rule the user can fix: duplicate item text, or the list is already at 50. */
  | 'conflict'
  /** The input failed validation (too long, too many tags, too much to upload at once, …). */
  | 'invalid'
  /**
   * On-device storage only: the browser won't let us read or write (private mode,
   * blocked site data, quota full, or data saved by a newer version of the app).
   * `detail` always says which, in user-facing copy.
   */
  | 'storage'
  /**
   * A `429`: too many requests too fast (or too many changes today). `detail` is
   * always the server's user-facing copy; waiting a moment fixes it.
   */
  | 'rate-limited'
  /** A `401`: the session ended (or was never there). Signing in again fixes it. */
  | 'unauthenticated'
  /** Anything else: network failure, server error. */
  | 'unknown'

export class ListError extends Error {
  readonly kind: ListErrorKind
  /** User-facing copy explaining what went wrong, when the storage layer wrote some. */
  readonly detail: string | null

  constructor(kind: ListErrorKind, detail: string | null = null, options?: ErrorOptions) {
    super(detail ?? `List operation failed (${kind})`, options)
    this.name = 'ListError'
    this.kind = kind
    this.detail = detail
  }
}

const KIND_BY_STATUS: Record<number, ListErrorKind> = {
  401: 'unauthenticated',
  404: 'not-found',
  409: 'conflict',
  // Only `POST /lists/import` sends one: too many lists, or too large a body.
  // The user fixes it by sending less, so it's a validation failure.
  413: 'invalid',
  422: 'invalid',
  429: 'rate-limited',
}

/** Translate whatever the API layer threw into a `ListError` (keeping the original as `cause`). */
export function toListError(error: unknown): ListError {
  if (error instanceof ListError) return error
  if (error instanceof ApiError) {
    return new ListError(KIND_BY_STATUS[error.status] ?? 'unknown', error.detail, { cause: error })
  }
  return new ListError('unknown', null, { cause: error })
}
