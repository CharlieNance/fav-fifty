/**
 * The Export / Import buttons on the lists page
 * (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Export/import a file). The rules live in
 * `localListTransfer.ts`; this does the I/O around them: reading the lists, saving
 * a file, reading a picked file, and saying how it went with a toast.
 *
 * - **Export works for everyone.** It reads through the active repository, so a
 *   signed-in user exports their account's lists and an anonymous visitor the
 *   device's. Either file imports anywhere.
 * - **Import is anonymous-only for now** and writes to device storage directly.
 *   Importing into an account needs the atomic, idempotent `POST /lists/import`
 *   (PR 6). Creating lists and items one request at a time could leave half a
 *   file imported, and Q12 says an import is all or nothing.
 */
import { ref } from 'vue'

import { useClientConfigStore } from '@/stores/clientConfig'
import { useToastStore } from '@/stores/toasts'
import { toListError } from './listErrors'
import type { ListRepository } from './listRepository'
import { createDocumentStore, type DocumentStore, emptyDocument } from './localListDocument'
import { requestPersistentStorage } from './localListRepository'
import {
  collectExport,
  exportFileName,
  IMPORT_TOO_LARGE_DETAIL,
  importSummaryMessage,
  MAX_IMPORT_FILE_BYTES,
  mergeImportedLists,
  parseImportFile,
  serializeExport,
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
  /** Where an import writes to. Defaults to this device's storage. */
  store?: DocumentStore
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

  /** Add the lists in `file` to this device. Resolves to true if anything was added. */
  async function importFile(file: File): Promise<boolean> {
    importing.value = true
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        toasts.show(IMPORT_TOO_LARGE_DETAIL, { variant: 'error', duration: ERROR_TOAST_MS })
        return false
      }
      const parsed = parseImportFile(await file.text(), { limits: config.limits, now, newId })

      // Read, merge, write in one synchronous step, like every repository call.
      const doc = store.load() ?? emptyDocument(newId())
      const summary = mergeImportedLists(doc, parsed, { newId, limits: config.limits })
      store.save(doc)

      requestPersistentStorage()
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
