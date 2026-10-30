// Synthetic fixtures with fictional metadata. Built in memory; no real fanfiction is used.
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { JSDOM } from 'jsdom'
;(globalThis as any).DOMParser ??= new JSDOM('').window.DOMParser

export const PROSE = 'ZZPROSEMARKERZZ the lantern keeper climbed the stairs'
const file = (parts: any[], name: string) => new File(parts, name)

export async function makeEpub(o: { opf?: string; header?: string; name?: string; noContainer?: boolean } = {}) {
  const z = new JSZip()
  z.file('mimetype', 'application/epub+zip')
  if (!o.noContainer) z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${o.opf ?? ''}</metadata>
    <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`)
  z.file('OEBPS/ch1.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body>${o.header ?? ''}<p>${PROSE}. Fandom: Prose Trap. Words: 999999. Tags: should, not, appear</p></body></html>`)
  return file([await z.generateAsync({ type: 'uint8array' })], o.name ?? 'test.epub')
}
export const FULL_OPF = '<dc:title>The Lantern Test</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language><dc:description>A made-up summary.</dc:description>'
export const HEADER = '<div id="preface">Fandom: Imaginary Saga, Other Saga\nRelationships: Ada/Bo\nCharacters: Ada, Bo\nRating: Teen\nWarnings: No Archive Warnings Apply\nTags: Hurt/Comfort, Slow Burn\nWords: 12,345\nChapters: 3/3\nPublished: 2020-01-02\nSummary: Fictional.</div>'

export async function makePdf(o: { title?: string; author?: string; subject?: string; name?: string } = {}) {
  const d = await PDFDocument.create(); const p = d.addPage(); p.drawText(PROSE, { font: await d.embedFont(StandardFonts.Helvetica), size: 10 })
  if (o.title) d.setTitle(o.title); if (o.author) d.setAuthor(o.author); if (o.subject) d.setSubject(o.subject)
  return file([await d.save()], o.name ?? 'test.pdf')
}
/** Minimal PDF whose trailer points at an /Encrypt dictionary, to exercise the password-protected path. */
export const makeEncryptedPdf = () => file(['%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\n4 0 obj<</Filter/Standard/V 1/R 2/O(x)/U(x)/P -4>>endobj\ntrailer<</Root 1 0 R/Size 5/Encrypt 4 0 R>>\n%%EOF'], 'locked.pdf')
export const makeHtml = (head: string, body = '') => file([`<!doctype html><html lang="en"><head>${head}</head><body>${body}<p>${PROSE}. Fandom: Prose Trap. Words: 999999</p></body></html>`], 'test.html')
export const makeTxt = (text: string) => file([text], 'test.txt')
export const corrupt = (name: string) => file([new Uint8Array([1, 2, 3, 4, 5, 250, 251])], name)
/** Page 1 carries an AO3-style labelled header, then prose that contains decoy labels. Page 2 also has decoys. */
export async function makeHeaderPdf(o: { title?: string; author?: string } = {}) {
  const d = await PDFDocument.create(); const font = await d.embedFont(StandardFonts.Helvetica)
  const lines = ['Posted originally on the Archive of Our Own at https://archiveofourown.org/works/123456.', 'Rating: Teen And Up Audiences', 'Archive Warning: No Archive Warnings Apply', 'Fandom: Imaginary Saga, Other Saga',
    'Relationship: Ada/Bo', 'Character: Ada, Bo', 'Additional Tags: Hurt/Comfort, Slow Burn', 'Language: English', 'Stats: Published: 2020-01-02 Completed: 2020-03-04 Words: 12,345 Chapters: 3/3',
    PROSE + '. Fandom: Prose Trap Words: 999999 Rating: Explicit']
  const p = d.addPage(); lines.forEach((l, i) => p.drawText(l, { x: 20, y: 780 - i * 16, size: 8, font }))
  d.addPage().drawText('Fandom: Page Two Trap Words: 777777', { x: 20, y: 780, size: 8, font })
  if (o.title) d.setTitle(o.title); if (o.author) d.setAuthor(o.author)
  return new File([await d.save() as any], 'header.pdf')
}
