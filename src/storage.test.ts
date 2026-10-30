import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { makeEpub, makePdf } from './fixtures'
import { addWork, FicDB, exportBackup, importBackup, removeWork } from './db'
import { sha256 } from './extract'
import { checkRoom, loadCopy, removeAllCopies, removeCopy, storeCopy, StorageError } from './storage'
import type { Work } from './types'

let n = 0
async function setup(f: File, format: Work['format'] = 'epub') {
  const d = new FicDB('s' + n++)
  const id = await addWork(d, { original: {}, edits: {}, fields: {}, format, size: f.size, hash: await sha256(f), fileName: f.name, addedAt: 1, personalTagIds: [], status: 'Unread', favourite: false, notes: '', hasLocalCopy: false })
  return { d, id, w: (await d.works.get(id))! }
}
const roomy = { usage: 0, quota: 1e12, persisted: false }
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

describe('local copies', () => {
  it('stores bytes unchanged and flags the work', async () => {
    const f = await makeEpub({ opf: '<dc:title>T</dc:title>' }); const { d, id, w } = await setup(f)
    await storeCopy(d, w, f, roomy)
    expect((await d.works.get(id))!.hasLocalCopy).toBe(true)
    expect(await bytes(await loadCopy(d, (await d.works.get(id))!))).toEqual(await bytes(f))
  })
  it('stores PDFs too', async () => {
    const f = await makePdf({ title: 'P' }); const { d, w } = await setup(f, 'pdf'); await storeCopy(d, w, f, roomy)
    expect((await d.files.get(w.id!))!.mime).toBe('application/pdf')
  })
  it('refuses unsupported formats and different files', async () => {
    const f = await makeEpub(); const { d, w } = await setup(f)
    await expect(storeCopy(d, { ...w, format: 'txt' }, f, roomy)).rejects.toThrow(/Only EPUB and PDF/)
    await expect(storeCopy(d, w, await makeEpub({ opf: '<dc:title>Other</dc:title>' }), roomy)).rejects.toThrow(/not the same file/)
    expect(await d.files.count()).toBe(0)
  })
  it('refuses when the quota estimate says there is no room', async () => {
    expect(() => checkRoom({ usage: 99, quota: 100, persisted: false }, 10)).toThrow(StorageError)
    expect(() => checkRoom(null, 1e9)).not.toThrow()
    const f = await makeEpub(); const { d, w } = await setup(f)
    await expect(storeCopy(d, w, f, { usage: 1e9, quota: 1e9 + 100, persisted: false })).rejects.toThrow(/Not enough browser storage/)
    expect((await d.works.get(w.id!))!.hasLocalCopy).toBe(false)
  })
  it('turns a quota error into a clean message and keeps the work', async () => {
    const f = await makeEpub(); const { d, w } = await setup(f)
    d.files.put = (() => Promise.reject(new DOMException('full', 'QuotaExceededError'))) as any
    await expect(storeCopy(d, w, f, roomy)).rejects.toThrow(/ran out of storage/)
    expect(await d.works.get(w.id!)).toBeTruthy(); expect((await d.works.get(w.id!))!.hasLocalCopy).toBe(false)
  })
  it('reports a missing copy and repairs the flag', async () => {
    const f = await makeEpub(); const { d, id, w } = await setup(f); await storeCopy(d, w, f, roomy)
    await d.files.delete(id)
    await expect(loadCopy(d, (await d.works.get(id))!)).rejects.toThrow(/missing/)
    expect((await d.works.get(id))!.hasLocalCopy).toBe(false)
  })
  it('detects a corrupted copy', async () => {
    const f = await makeEpub(); const { d, id, w } = await setup(f); await storeCopy(d, w, f, roomy)
    const rec = (await d.files.get(id))!; const bad = new Uint8Array(await rec.blob.arrayBuffer()); bad[10] ^= 0xff
    await d.files.put({ ...rec, blob: new Blob([bad]) })
    await expect(loadCopy(d, (await d.works.get(id))!)).rejects.toThrow(/damaged/)
  })
  it('removing a copy keeps the metadata; removing the work removes its copy', async () => {
    const f = await makeEpub(); const { d, id, w } = await setup(f); await storeCopy(d, w, f, roomy)
    await removeCopy(d, id); expect(await d.files.count()).toBe(0); expect((await d.works.get(id))!.hasLocalCopy).toBe(false)
    await storeCopy(d, (await d.works.get(id))!, f, roomy); await removeAllCopies(d); expect(await d.files.count()).toBe(0); expect(await d.works.count()).toBe(1)
    await storeCopy(d, (await d.works.get(id))!, f, roomy); await removeWork(d, id); expect(await d.files.count()).toBe(0)
  })
  it('metadata backups hold no files and restore without copy flags', async () => {
    const f = await makeEpub(); const { d, w } = await setup(f); await storeCopy(d, w, f, roomy)
    const json = await exportBackup(d); expect(json).not.toContain('"blob"')
    await importBackup(d, json); expect(await d.files.count()).toBe(0); expect((await d.works.toArray())[0].hasLocalCopy).toBe(false)
  })
})
