/**
 * The Export / Import buttons on the lists page
 * (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Export/import a file). The rules live in
 * `localListTransfer.ts`; this does the I/O around them: reading the lists, saving
 * a file, reading a picked file, and saying how it went with a toast.
 *
 * - **Export works for everyone.** It reads through the active repository, so a
 *   signed-in user exports their account's lists and an anonymous visitor the
 *   device's. Either file imports anywhere.
 * - **Import works for everyone too.** Anonymous, it merges into device storage.
 *   Signed in, it goes to the account through `POST /lists/import` in one
 *   all-or-nothing request (Q12), never one list at a time, which could leave half
 *   a file imported. Either way the file is checked here first, with the same rules
 *   and the same messages, and title clashes are renamed `"Title (2)"`.
 */
import { ref } from 'vue'

import { useAuthStore } from '@/stores/auth'
import { useClientConfigStore } from '@/stores/clientConfig'
import { useToastStore } from '@/stores/toasts'
import { ListError, toListError } from './listErrors'
import { type AccountImport, apiListRepository, type ListRepository } from './listRepository'
import { createDocumentStore, type DocumentStore, emptyDocument } from './localListDocument'
import { requestPersistentStorage } from './localListRepository'
import {
  collectExport,
  exportFileName,
  IMPORT_TOO_LARGE_DETAIL,
  type ImportSummary,
  importSummaryMessage,
  MAX_IMPORT_FILE_BYTES,
  mergeImportedLists,
  type ParsedImport,
  parseImportFile,
  serializeExport,
  summarizeAccountImport,
  tooManyListsDetail,
} from './localListTransfer'
import { useListRepository } from './useListRepository'

/** Errors explain how to fix the file, so they stay up longer than a confirmation. */
const ERROR_TOAST_MS = 10_000

export const EXPORT_EMPTY_MESSAGE = "You don't have any lists to export yet."
export const EXPORT_FAILED_MESSAGE = "Couldn't export your lists. Try again."
export const IMPORT_FAILED_MESSAGE = "Couldn't import that file. Try again."

export interface ListTransferOptions {
  /** Where an export reads from. Defaults to the active repository, resolved per export. */
  repository?: () => ListRepository
  /** Where an anonymous import writes to. Defaults to this device's storage. */
  store?: DocumentStore
  /** Whether an import goes to the account. Defaults to the auth store's `isAuthenticated`. */
  isSignedIn?: () => boolean
  /** Where a signed-in import goes. Defaults to the API. */
  account?: AccountImport
  now?: () => string
  newId?: () => string
  /** Hands the file to the browser. Defaults to a download through a temporary link. */
  saveFile?: (fileName: string, contents: string) => void
}

/** Download `contents` as `fileName` without leaving the page. */
function downloadFile(fileName: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function useListTransfer(options: ListTransferOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString())
  const newId = options.newId ?? (() => crypto.randomUUID())
  const repository = options.repository ?? useListRepository
  const store = options.store ?? createDocumentStore({ now, newId })
  const saveFile = options.saveFile ?? downloadFile
  const account = options.account ?? apiListRepository
  const auth = useAuthStore()
  const isSignedIn = options.isSignedIn ?? (() => auth.isAuthenticated)
  const toasts = useToastStore()
  const config = useClientConfigStore()
  const exporting = ref(false)
  const importing = ref(false)

  function showError(caught: unknown, fallback: string): void {
    toasts.show(toListError(caught).detail ?? fallback, {
      variant: 'error',
      duration: ERROR_TOAST_MS,
    })
  }

  /** Save every list (the account's, or this device's) as a `.json` file. */
  async function exportLists(): Promise<void> {
    exporting.value = true
    try {
      const doc = await collectExport(repository(), newId)
      if (doc.lists.length === 0) {
        toasts.show(EXPORT_EMPTY_MESSAGE, { variant: 'warning' })
        return
      }
      saveFile(exportFileName(new Date(now())), serializeExport(doc))
    } catch (caught) {
      showError(caught, EXPORT_FAILED_MESSAGE)
    } finally {
      exporting.value = false
    }
  }

  /** Add `parsed` to this device's storage. */
  function importToDevice(parsed: ParsedImport): ImportSummary {
    // Read, merge, write in one synchronous step, like every repository call.
    const doc = store.load() ?? emptyDocument(newId())
    const summary = mergeImportedLists(doc, parsed, { newId, limits: config.limits })
    store.save(doc)
    requestPersistentStorage()
    return summary
  }

  /** Add `parsed` to the signed-in user's account, in one request. */
  async function importToAccount(parsed: ParsedImport): Promise<ImportSummary> {
    const max = config.limits.max_lists_per_import
    if (parsed.lists.length > max) throw new ListError('invalid', tooManyListsDetail(max))
    // A fresh device id per import, so the server keys these lists apart from any
    // earlier import of the same file: a file import adds, as it does on a device,
    // even if the lists it made last time have since been deleted.
    const result = await account.importLists({ device_id: newId(), lists: parsed.lists })
    return summarizeAccountImport(result, parsed.skipped)
  }

  /**
   * Add the lists in `file` to the account (signed in) or this device. Resolves to
   * true if anything was added.
   */
  async function importFile(file: File): Promise<boolean> {
    importing.value = true
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        toasts.show(IMPORT_TOO_LARGE_DETAIL, { variant: 'error', duration: ERROR_TOAST_MS })
        return false
      }
      const parsed = parseImportFile(await file.text(), { limits: config.limits, now, newId })
      const summary = isSignedIn() ? await importToAccount(parsed) : importToDevice(parsed)

      // Something in the file was left out, so it's worth a second look: a warning.
      toasts.show(importSummaryMessage(summary), {
        variant: summary.skipped > 0 ? 'warning' : 'success',
      })
      return true
    } catch (caught) {
      showError(caught, IMPORT_FAILED_MESSAGE)
      return false
    } finally {
      importing.value = false
    }
  }

  return { exporting, importing, exportLists, importFile }
}
