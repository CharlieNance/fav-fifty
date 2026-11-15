/**
 * Export and import of the on-device lists as a `.json` file
 * (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Export/import a file). It's the only
 * backup an anonymous visitor has, and the way to move lists between browsers
 * without an account.
 *
 * `useListTransfer` does the file and storage I/O around these.
 *
 * - **The file uses the on-device document format** (see `localListDocument.ts`),
 *   whichever storage it was exported from: device lists or a signed-in account's.
 *   A file goes through the same `parseDocument` as storage, migrations included,
 *   so an export from months ago still imports.
 * - **Import adds; it never replaces.** Each list in the file becomes a new list on
 *   this device. Entries the parser can't read (no id, no title or text) are
 *   skipped, and the visitor is told how many.
 * - **The whole file or nothing (Q12):** every list is checked against the same
 *   rules as a normal create, and one that fails rejects the file, with a message
 *   saying which list and why. Nothing is written, so the user can fix the file and
 *   retry. The server import (PR 7's claim) would reject the same list anyway.
 * - **Title clashes are renamed** `"Title (2)"` (Q12, `uniqueTitle`), against the
 *   device's lists and the file's earlier lists alike.
 * - **Imported lists get fresh ids** (lists and items). A backup re-imported while
 *   its originals are still here then can't collide with them, and each list keeps
 *   a unique `device_id:local_id` key for the claim upload. Timestamps are kept.
 */
import type { ClientLimits } from '@/stores/clientConfig'
import { ListError } from './listErrors'
import type { ListRepository } from './listRepository'
import type { ListsImportResult } from './types'
import {
  charLength,
  normalizeTags,
  uniqueTitle,
  validateItemDraft,
  validateTitle,
} from './listRules'
import {
  emptyDocument,
  type LocalItem,
  type LocalList,
  type LocalListsDocument,
  parseDocument,
} from './localListDocument'

/**
 * Larger than any real export (a full 50-item list is 10–20 KB) and about the size
 * of a whole `localStorage` quota, so a file this big couldn't be saved anyway.
 */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

export const IMPORT_TOO_LARGE_DETAIL = 'This file is too large to be a Fav Fifty lists export.'
export const IMPORT_UNREADABLE_DETAIL = "This file isn't a Fav Fifty lists export."
export const IMPORT_NEWER_VERSION_DETAIL =
  'This file was saved by a newer version of Fav Fifty. Reload the page and try again.'
export const IMPORT_EMPTY_DETAIL = "This file doesn't have any lists in it."
export const IMPORT_ALL_SKIPPED_DETAIL =
  'None of the lists in this file could be read. It may have been damaged or edited by hand.'

/** `fav-fifty-lists-2026-11-14.json`, in the visitor's local date. */
export function exportFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `fav-fifty-lists-${day}.json`
}

/**
 * Everything `repository` holds, as an export document: every list, items in rank
 * order. Works for device storage and the API alike.
 *
 * Ids are fresh, not the storage's own: an import replaces them anyway, and a file
 * sent to a friend shouldn't carry the account's server ids. So is the
 * `device_id`, since the file isn't tied to a device.
 */
export async function collectExport(
  repository: ListRepository,
  newId: () => string,
): Promise<LocalListsDocument> {
  const document = emptyDocument(newId())
  // One request per list when signed in. Sequential, so a long account doesn't
  // fire a burst of requests at once.
  for (const summary of await repository.getLists()) {
    const items = await repository.getItems(summary.id)
    document.lists.push({
      local_id: newId(),
      title: summary.title,
      tags: [...summary.tags],
      created_at: summary.created_at,
      updated_at: summary.updated_at,
      items: items.map((item) => ({
        local_id: newId(),
        text: item.text,
        note: item.note,
        image_url: item.image_url,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
    })
  }
  return document
}

/** The export file's contents: the document, indented so it's readable in an editor. */
export function serializeExport(document: LocalListsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/** A list's title for an error message: quoted, and shortened if it's long. */
function label(title: string): string {
  const shown = charLength(title) > 40 ? `${Array.from(title).slice(0, 40).join('')}…` : title
  return `'${shown.trim()}'`
}

function rejectList(title: string, reason: string): ListError {
  return new ListError('invalid', `${label(title)}: ${reason}`)
}

/** Apply `validate`, re-throwing a rule failure with the list's name in front. */
function forList<T>(title: string, validate: () => T): T {
  try {
    return validate()
  } catch (error) {
    if (error instanceof ListError && error.detail) throw rejectList(title, error.detail)
    throw error
  }
}

/** Check one list against the create rules; return it trimmed and normalized. */
function validateList(list: LocalList, limits: ClientLimits): LocalList {
  const title = forList(list.title, () => validateTitle(list.title, limits))
  const tags = forList(title, () => normalizeTags(list.tags, limits))

  if (list.items.length > limits.max_items_per_list) {
    throw new ListError(
      'invalid',
      `${label(title)} has ${list.items.length} items; the limit is ${limits.max_items_per_list}.`,
    )
  }

  const seen = new Set<string>()
  const items: LocalItem[] = list.items.map((item) => {
    const valid = forList(title, () => validateItemDraft(item, limits))
    const key = valid.text.toLowerCase()
    if (seen.has(key)) {
      throw new ListError('invalid', `${label(title)} has '${valid.text}' more than once.`)
    }
    seen.add(key)
    return { ...item, ...valid }
  })

  return { ...list, title, tags, items }
}

export interface ParsedImport {
  lists: LocalList[]
  /** Lists and items in the file that couldn't be read, and were left out. */
  skipped: number
}

export interface ParseImportOptions {
  limits: ClientLimits
  now: () => string
  newId: () => string
}

/**
 * Read an import file's text into the lists to add. Throws `ListError('invalid')`
 * with user-facing copy if the file isn't an export, is empty, or has a list that
 * breaks a rule. Ids in the result are still the file's; `mergeImportedLists`
 * replaces them.
 */
export function parseImportFile(text: string, options: ParseImportOptions): ParsedImport {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ListError('invalid', IMPORT_UNREADABLE_DETAIL)
  }

  const result = parseDocument(json, { now: options.now, newId: options.newId })
  if (!result.ok) {
    throw new ListError(
      'invalid',
      result.reason === 'newer-version' ? IMPORT_NEWER_VERSION_DETAIL : IMPORT_UNREADABLE_DETAIL,
    )
  }
  if (result.document.lists.length === 0) {
    throw new ListError(
      'invalid',
      result.skipped > 0 ? IMPORT_ALL_SKIPPED_DETAIL : IMPORT_EMPTY_DETAIL,
    )
  }

  return {
    lists: result.document.lists.map((list) => validateList(list, options.limits)),
    skipped: result.skipped,
  }
}

export interface ImportSummary {
  imported: number
  /** Lists whose title clashed with one already here, and what they're called now. */
  renamed: { from: string; to: string }[]
  /** Entries in the file that couldn't be read (see `ParsedImport`). */
  skipped: number
}

/**
 * Add `lists` to `document` (in place), each with fresh ids and a title no other
 * list on the device has.
 */
export function mergeImportedLists(
  document: LocalListsDocument,
  { lists, skipped }: ParsedImport,
  options: { newId: () => string; limits: ClientLimits },
): ImportSummary {
  const taken = new Set(document.lists.map((list) => list.title.toLowerCase()))
  const renamed: ImportSummary['renamed'] = []

  for (const list of lists) {
    const title = uniqueTitle(list.title, taken, options.limits)
    if (title !== list.title) renamed.push({ from: list.title, to: title })
    taken.add(title.toLowerCase())

    document.lists.push({
      ...list,
      local_id: options.newId(),
      title,
      items: list.items.map((item) => ({ ...item, local_id: options.newId() })),
    })
  }

  return { imported: lists.length, renamed, skipped }
}

/**
 * The server's wording for an upload over `max_lists_per_import`, so the claim
 * dialog and a file import can say it before sending anything.
 */
export function tooManyListsDetail(max: number): string {
  return `You can upload at most ${max} lists at a time.`
}

/**
 * The `ImportSummary` for an upload to an account (`POST /lists/import`), so it
 * reads the same as a device import. A list the server already had (a retry) still
 * counts as imported: it's in the account either way.
 */
export function summarizeAccountImport(result: ListsImportResult, skipped = 0): ImportSummary {
  const renamed: ImportSummary['renamed'] = []
  for (const { list, renamed_from } of result.lists) {
    if (list && renamed_from !== null) renamed.push({ from: renamed_from, to: list.title })
  }
  return { imported: result.lists.length, renamed, skipped }
}

function listCount(n: number): string {
  return n === 1 ? '1 list' : `${n} lists`
}

/** The sentence saying which lists were renamed on the way in, if any. */
function renamedSentence(renamed: ImportSummary['renamed']): string[] {
  if (renamed.length === 1) {
    const [{ from, to }] = renamed as [{ from: string; to: string }]
    return [`${label(from)} is now ${label(to)}, since you already had one by that name.`]
  }
  if (renamed.length > 1) {
    return [`${renamed.length} were renamed, since you already had lists with those titles.`]
  }
  return []
}

/** The toast after a successful import, e.g. "Imported 2 lists. 'Albums' is now 'Albums (2)'." */
export function importSummaryMessage(summary: ImportSummary): string {
  const parts = [`Imported ${listCount(summary.imported)}.`, ...renamedSentence(summary.renamed)]

  if (summary.skipped === 1) {
    parts.push("1 entry in the file couldn't be read and was skipped.")
  } else if (summary.skipped > 1) {
    parts.push(`${summary.skipped} entries in the file couldn't be read and were skipped.`)
  }

  return parts.join(' ')
}

/** The toast after the claim dialog's upload, e.g. "Added 2 lists to your account." */
export function claimSummaryMessage(summary: ImportSummary): string {
  return [
    `Added ${listCount(summary.imported)} to your account.`,
    ...renamedSentence(summary.renamed),
  ].join(' ')
}
