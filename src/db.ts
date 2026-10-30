import Dexie, { type Table } from 'dexie'
import type { Work, PTag, SavedFilter, StoredFile } from './types'
// Migrations: add a new `this.version(n+1).stores({...}).upgrade(tx => ...)` block; never edit old versions.
export class FicDB extends Dexie {
  works!: Table<Work, number>; files!: Table<StoredFile, number>; tags!: Table<PTag, number>; filters!: Table<SavedFilter, number>
  constructor(name = 'ficshelf') {
    super(name)
    this.version(1).stores({ works: '++id, hash, addedAt, status, favourite', tags: '++id, &name', filters: '++id, name' })
    // v2: optional local copies. Blobs live in their own table so list queries never load file bytes.
    this.version(2).stores({ files: 'workId' })
  }
}
export const db = new FicDB()
export async function deleteTag(d: FicDB, id: number) {
  await d.transaction('rw', d.works, d.tags, async () => {
    await d.works.toCollection().modify(w => { w.personalTagIds = w.personalTagIds.filter(t => t !== id) })
    await d.tags.delete(id)
  })
}
export async function exportBackup(d: FicDB) {
  return JSON.stringify({ kind: 'ficshelf-metadata-backup', note: 'Metadata only. Contains no story files.', version: 1,
    works: await d.works.toArray(), tags: await d.tags.toArray(), filters: await d.filters.toArray() })
}
export async function importBackup(d: FicDB, text: string) {
  let o: any
  try { o = JSON.parse(text) } catch { throw new Error('Backup is not valid JSON.') }
  if (o?.kind !== 'ficshelf-metadata-backup' || !Array.isArray(o.works) || !Array.isArray(o.tags) || !Array.isArray(o.filters))
    throw new Error('This file is not a FicShelf metadata backup.')
  await d.transaction('rw', d.works, d.tags, d.filters, d.files, async () => {
    await d.works.clear(); await d.tags.clear(); await d.filters.clear(); await d.files.clear()
    await d.works.bulkAdd(o.works.map((w: Work) => ({ ...w, hasLocalCopy: false }))); await d.tags.bulkAdd(o.tags); await d.filters.bulkAdd(o.filters)
  })
}
export class DuplicateError extends Error {}
export async function addWork(d: FicDB, w: Omit<Work, 'id'>): Promise<number> {
  return d.transaction('rw', d.works, async () => {
    if (await d.works.where('hash').equals(w.hash).count()) throw new DuplicateError('This file is already in your library.')
    return d.works.add(w)
  })
}
export async function removeWork(d: FicDB, id: number) {
  await d.transaction('rw', d.works, d.files, async () => { await d.files.delete(id); await d.works.delete(id) })
}
export async function clearLibrary(d: FicDB) {
  await d.transaction('rw', d.works, d.tags, d.filters, d.files, async () => { await d.works.clear(); await d.tags.clear(); await d.filters.clear(); await d.files.clear() })
}
