import type { FicDB } from './db'
import { sha256 } from './extract'
import type { Format, Work } from './types'

export const STORABLE: Format[] = ['epub', 'pdf']
export const MIME: Record<string, string> = { epub: 'application/epub+zip', pdf: 'application/pdf' }
export class StorageError extends Error {}
export interface StorageInfo { usage: number; quota: number; persisted: boolean }
const MB = 1024 * 1024
export const fmtSize = (n: number) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Browser estimate. Returns null where the Storage API is missing (the estimate is approximate even where present). */
export async function storageInfo(): Promise<StorageInfo | null> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!s?.estimate) return null
  const e = await s.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted: (await s.persisted?.()) ?? false }
}
/** Throws a readable error when the estimate says the file will not fit. 10% plus 5 MB is kept as headroom for IndexedDB overhead. */
export function checkRoom(info: StorageInfo | null, size: number) {
  if (!info || !info.quota) return // unknown: attempt the write and handle quota errors instead
  const free = info.quota - info.usage, need = size * 1.1 + 5 * MB
  if (free < need) throw new StorageError(`Not enough browser storage: this file needs about ${fmtSize(need)} but about ${fmtSize(Math.max(0, free))} is free. Remove other stored copies or free device space, or import it as metadata only.`)
}
export async function requestPersistence() { return (await navigator.storage?.persist?.()) ?? false }

/** Stores the file's bytes untouched. Rejects other files (hash mismatch), full storage, and failed write-backs. */
export async function storeCopy(d: FicDB, work: Work, blob: Blob, info?: StorageInfo | null) {
  if (!STORABLE.includes(work.format)) throw new StorageError('Only EPUB and PDF files can be stored in FicShelf for now.')
  if (!work.id) throw new StorageError('Save the fic to your library first.')
  if (await sha256(blob) !== work.hash) throw new StorageError('That is not the same file you imported (its contents differ), so it was not stored.')
  checkRoom(info === undefined ? await storageInfo() : info, blob.size)
  const keep = new Blob([blob], { type: MIME[work.format] })
  try { await d.files.put({ workId: work.id, blob: keep, mime: keep.type, size: keep.size, storedAt: Date.now() }) }
  catch (e: any) {
    await d.files.delete(work.id).catch(() => {})
    throw new StorageError(e?.name === 'QuotaExceededError' ? 'The browser ran out of storage while saving this file. Nothing was stored.' : 'The browser refused to store this file (private browsing or restricted storage can cause this). Your metadata was kept.')
  }
  const back = await d.files.get(work.id)
  if (!back || back.size !== blob.size) { await d.files.delete(work.id); throw new StorageError('The stored copy could not be verified and was discarded.') }
  await d.works.update(work.id, { hasLocalCopy: true })
}
/** Loads a stored copy, checking it exists and still matches the imported file. Fixes the flag when the file has gone missing. */
export async function loadCopy(d: FicDB, work: Work): Promise<Blob> {
  const rec = work.id ? await d.files.get(work.id) : undefined
  if (!rec) { if (work.id) await d.works.update(work.id, { hasLocalCopy: false }); throw new StorageError('The stored copy is missing. The browser may have cleared it. Re-add the file from your device to restore it.') }
  if (rec.size !== work.size || rec.blob.size !== work.size || await sha256(rec.blob) !== work.hash)
    throw new StorageError('The stored copy is damaged and does not match the imported file. Remove it and add the file again.')
  return rec.blob
}
export async function removeCopy(d: FicDB, workId: number) {
  await d.transaction('rw', d.files, d.works, async () => { await d.files.delete(workId); await d.works.update(workId, { hasLocalCopy: false }) })
}
export async function removeAllCopies(d: FicDB) {
  await d.transaction('rw', d.files, d.works, async () => { await d.files.clear(); await d.works.toCollection().modify({ hasLocalCopy: false }) })
}
export async function copiesSize(d: FicDB) { let n = 0; await d.files.each(f => { n += f.size }); return n }
export const autoStoreEnabled = () => { try { return localStorage.getItem('ficshelf.autoStore') === 'on' } catch { return false } }
export const setAutoStoreEnabled = (on: boolean) => { try { localStorage.setItem('ficshelf.autoStore', on ? 'on' : 'off') } catch {} }
