import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { corrupt, FULL_OPF, HEADER, makeEncryptedPdf, makeEpub, makeHtml, makePdf, makeTxt, PROSE } from './fixtures'
import { detectFormat, extract, extractEpub, extractHtml, extractPdf, extractTxt, ImportError, sha256 } from './extract'
import { addWork, DuplicateError, FicDB } from './db'
import type { Work } from './types'

describe('EPUB', () => {
  it('reads standard OPF metadata', async () => {
    const m = await extractEpub(await makeEpub({ opf: FULL_OPF }))
    expect(m).toMatchObject({ title: 'The Lantern Test', author: 'Test Author', language: 'en', description: 'A made-up summary.' })
  })
  it('reads a labelled header and lets it add AO3-style fields', async () => {
    const m = await extractEpub(await makeEpub({ opf: FULL_OPF, header: HEADER }))
    expect(m.fandoms).toEqual(['Imaginary Saga', 'Other Saga']); expect(m.relationships).toEqual(['Ada/Bo']); expect(m.tags).toEqual(['Hurt/Comfort', 'Slow Burn'])
    expect(m.words).toBe(12345); expect(m.chapters).toBe(3); expect(m.complete).toBe(true); expect(m.rating).toBe('Teen')
  })
  it('keeps missing fields missing and never reads prose', async () => {
    const m = await extractEpub(await makeEpub({ opf: '<dc:title>Only Title</dc:title>' }))
    expect(m).toEqual({ title: 'Only Title' })
    expect(JSON.stringify(m)).not.toContain('ZZPROSE'); expect(m.words).toBeUndefined(); expect(m.fandoms).toBeUndefined()
  })
  it('does not fabricate metadata from prose when there is no header', async () => {
    const m = await extractEpub(await makeEpub({ opf: '' })); expect(m).toEqual({})
  })
  it('reports corrupt and structurally broken EPUBs', async () => {
    await expect(extractEpub(corrupt('bad.epub'))).rejects.toThrow(ImportError)
    await expect(extractEpub(await makeEpub({ noContainer: true }))).rejects.toThrow(/package file/)
  })
})
describe('PDF', () => {
  it('reads document info only, never page text', async () => {
    const m = await extractPdf(await makePdf({ title: 'PDF Tale', author: 'Pdf Author', subject: 'Fictional subject' }))
    expect(m).toEqual({ title: 'PDF Tale', author: 'Pdf Author', description: 'Fictional subject' }); expect(JSON.stringify(m)).not.toContain('ZZPROSE')
  })
  it('leaves absent info absent', async () => {
    const m = await extractPdf(await makePdf()); expect(m.author).toBeUndefined(); expect(m.language).toBeUndefined(); expect(m.words).toBeUndefined()
  })
  it('rejects corrupt PDFs with a readable message', async () => { await expect(extractPdf(corrupt('bad.pdf'))).rejects.toThrow(/corrupt|unreadable/) })
  it('rejects password-protected PDFs', async () => { await expect(extractPdf(makeEncryptedPdf())).rejects.toThrow(/password/) })
})
describe('HTML', () => {
  it('reads meta tags and an explicit header, not body prose', async () => {
    const m = await extractHtml(makeHtml('<title>Page Title</title><meta name="author" content="Html Author"><meta name="description" content="Short blurb">', HEADER))
    expect(m).toMatchObject({ title: 'Page Title', author: 'Html Author', description: 'Fictional.', language: 'en', words: 12345 })
    expect(m.words).not.toBe(999999)
  })
  it('does not extract anything from a page with no metadata', async () => {
    const m = await extractHtml(makeHtml('')); expect(m).toEqual({ language: 'en' }); expect(JSON.stringify(m)).not.toContain('ZZPROSE')
  })
})
describe('TXT', () => {
  it('parses a fenced header at the top', async () => {
    const m = await extractTxt(makeTxt('---\ntitle: Plain Tale\nauthor: Txt Author\nFandom: Imaginary Saga\nWords: 500\n---\nbody ' + PROSE))
    expect(m).toMatchObject({ title: 'Plain Tale', author: 'Txt Author', fandoms: ['Imaginary Saga'], words: 500 })
  })
  it('ignores header-like lines when no fenced header starts the file', async () => {
    expect(await extractTxt(makeTxt(`${PROSE}\nWords: 5\n---\nFandom: X\n---`))).toEqual({})
    expect(await extractTxt(makeTxt(''))).toEqual({})
  })
})
describe('dispatch and format detection', () => {
  it('routes by extension and rejects unsupported types', async () => {
    expect(detectFormat(new File([''], 'a.HTM'))).toBe('html')
    await expect(extract(new File(['x'], 'a.docx'))).rejects.toThrow(/Unsupported/)
    expect((await extract(await makePdf({ title: 'T' }))).format).toBe('pdf')
  })
})
describe('hashing and duplicates', () => {
  it('hashes deterministically from bytes alone', async () => {
    const a = new File(['same bytes'], 'one.txt'), b = new File(['same bytes'], 'two.txt'), c = new File(['other bytes'], 'one.txt')
    expect(await sha256(a)).toBe(await sha256(b)); expect(await sha256(a)).not.toBe(await sha256(c)); expect(await sha256(a)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('rejects a second work with the same hash', async () => {
    const d = new FicDB('dup'); const hash = await sha256(new File(['x'], 'x.txt'))
    const w: Omit<Work, 'id'> = { original: {}, edits: {}, fields: {}, format: 'txt', size: 1, hash, fileName: 'x.txt', addedAt: 1, personalTagIds: [], status: 'Unread', favourite: false, notes: '', hasLocalCopy: false }
    await addWork(d, w); await expect(addWork(d, { ...w, fileName: 'renamed.txt' })).rejects.toThrow(DuplicateError); expect(await d.works.count()).toBe(1)
  })
})
