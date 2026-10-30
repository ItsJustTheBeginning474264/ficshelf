import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { applyFilter } from './filter'
import { emptyFilter, type Work } from './types'
import { parseHeader } from './extract'
import { FicDB, deleteTag, exportBackup, importBackup } from './db'

const mk = (o: Partial<Work['original']>, p: Partial<Work> = {}): Work => ({ original: o, edits: {}, fields: {}, format: 'epub', size: 1, hash: Math.random().toString(), fileName: 'x.epub',
  addedAt: 1, personalTagIds: [], status: 'Unread', favourite: false, notes: '', hasLocalCopy: false, ...p })
const A = mk({ title: 'A', fandoms: ['Marvel'], tags: ['Hurt/Comfort'], words: 60000, complete: true }, { personalTagIds: [1] })
const B = mk({ title: 'B', fandoms: ['Marvel'], tags: ['Hurt/Comfort', 'Major Character Death'], words: 70000, complete: true }, { personalTagIds: [1] })
const C = mk({ title: 'C' }, { status: 'Read' })

describe('filters', () => {
  it('combines required, excluded, personal tag, range, status', () => {
    const f = { ...emptyFilter(), fandoms: ['marvel'], tags: ['hurt/comfort'], personalTagIds: [1], minWords: 50000, complete: true, statuses: ['Unread' as const],
      exclude: { ...emptyFilter().exclude, tags: ['Major Character Death'] } }
    expect(applyFilter([A, B, C], f).map(w => w.original.title)).toEqual(['A'])
  })
  it('never treats missing word count as zero', () => expect(applyFilter([C], { ...emptyFilter(), maxWords: 10 })).toHaveLength(0))
  it('searches metadata with punctuation tolerance', () => expect(applyFilter([A], { ...emptyFilter(), q: 'hurt comfort' })).toHaveLength(1))
  it('filters by reading status', () => expect(applyFilter([A, C], { ...emptyFilter(), statuses: ['Read'] })).toEqual([C]))
})
describe('header parsing', () => {
  it('reads labelled lines only', () => { const m = parseHeader('Fandom: Test Fandom\nWords: 1,200\nChapters: 3/3\nnot a field line'); expect(m.fandoms).toEqual(['Test Fandom']); expect(m.words).toBe(1200); expect(m.complete).toBe(true) })
  it('returns empty meta when no header', () => expect(parseHeader('Once upon a time')).toEqual({}))
})
describe('storage', () => {
  it('deletes tag without deleting fic, and round-trips backup', async () => {
    const d = new FicDB('t1'); const id = await d.tags.add({ name: 'Comfort' }); const wid = await d.works.add(mk({ title: 'Z' }, { personalTagIds: [id] }))
    await deleteTag(d, id); expect((await d.works.get(wid))!.personalTagIds).toEqual([])
    const b = await exportBackup(d); await d.works.clear(); await importBackup(d, b); expect(await d.works.count()).toBe(1)
  })
  it('rejects malformed backups', async () => { const d = new FicDB('t2'); await expect(importBackup(d, '{nope')).rejects.toThrow(); await expect(importBackup(d, '{}')).rejects.toThrow() })
})
