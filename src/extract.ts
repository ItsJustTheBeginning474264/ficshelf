import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import type { Format, Meta } from './types'
import { firstPageText, parsePageOne } from './pdfheader'

export class ImportError extends Error {}
export const detectFormat = (f: File): Format | null => {
  const e = f.name.split('.').pop()?.toLowerCase()
  return e === 'epub' || e === 'pdf' || e === 'txt' ? e : e === 'html' || e === 'htm' ? 'html' : null
}
export async function sha256(f: Blob) {
  const b = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}
const list = (s?: string | null) => (s ? s.split(/\s*,\s*/).map(x => x.trim()).filter(Boolean) : undefined)
const num = (s?: string | null) => { const n = parseInt((s ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : undefined }

/** Parses only an explicit labelled header ("Fandom: ...") from a metadata block. Never touches prose. */
export function parseHeader(block: string): Meta {
  const m: Meta = {}
  for (const line of block.split(/\r?\n/)) {
    const i = line.indexOf(':'); if (i < 1) continue
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim(); if (!v) continue
    if (/^fandoms?$/.test(k)) m.fandoms = list(v)
    else if (/^relationships?$/.test(k)) m.relationships = list(v)
    else if (/^characters?$/.test(k)) m.characters = list(v)
    else if (/^(additional )?tags$/.test(k)) m.tags = list(v)
    else if (/^(archive )?warnings?$/.test(k)) m.warnings = list(v)
    else if (k === 'rating') m.rating = v
    else if (k === 'words') m.words = num(v)
    else if (k === 'chapters') { m.chapters = num(v.split('/')[0]); const t = v.split('/')[1]?.trim(); if (t) m.complete = t !== '?' && num(t) === num(v.split('/')[0]) }
    else if (k === 'published') m.published = v
    else if (k === 'updated' || k === 'completed') m.updated = v
    else if (k === 'summary') m.description = v
  }
  return m
}
const clean = (m: Meta): Meta => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as Meta

export async function extractEpub(f: File): Promise<Meta> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(await f.arrayBuffer()) } catch { throw new ImportError('This EPUB is corrupt or not a valid zip archive.') }
  if (zip.file('META-INF/encryption.xml') && !zip.file('mimetype')) throw new ImportError('This EPUB appears protected.')
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container && new DOMParser().parseFromString(container, 'text/xml').querySelector('rootfile')?.getAttribute('full-path')
  const opfFile = opfPath ? zip.file(opfPath) : null
  if (!opfFile) throw new ImportError('EPUB package file (OPF) is missing.')
  const doc = new DOMParser().parseFromString(await opfFile.async('string'), 'text/xml')
  const t = (n: string) => doc.getElementsByTagNameNS('*', n)[0]?.textContent?.trim() || undefined
  const m: Meta = { title: t('title'), author: t('creator'), language: t('language'), description: t('description') }
  // Optional explicit AO3-style header: only the first spine item, only the labelled lines at its start.
  const spineRef = doc.getElementsByTagNameNS('*', 'itemref')[0]?.getAttribute('idref')
  const href = [...doc.getElementsByTagNameNS('*', 'item')].find(i => i.getAttribute('id') === spineRef)?.getAttribute('href')
  const base = opfPath!.includes('/') ? opfPath!.slice(0, opfPath!.lastIndexOf('/') + 1) : ''
  const first = href ? zip.file(decodeURI(base + href)) : null
  if (first) {
    const html = new DOMParser().parseFromString(await first.async('string'), 'text/html')
    const blk = html.querySelector('#preface, .meta, .tags, dl.tags')
    if (blk) Object.assign(m, parseHeader(blk.textContent?.replace(/\s*\n\s*/g, '\n') ?? ''))
  }
  return clean(m)
}
export async function extractPdf(f: File): Promise<Meta> {
  try {
    const d = await PDFDocument.load(await f.arrayBuffer(), { updateMetadata: false })
    return clean({ title: d.getTitle() || undefined, author: d.getAuthor() || undefined, language: undefined, description: d.getSubject() || undefined })
  } catch (e: any) {
    throw new ImportError(/encrypt/i.test(String(e?.message)) ? 'This PDF is password-protected.' : 'This PDF is corrupt or unreadable.')
  }
}
export async function extractHtml(f: File): Promise<Meta> {
  const d = new DOMParser().parseFromString(await f.text(), 'text/html')
  const meta = (n: string) => d.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || undefined
  const m: Meta = { title: d.querySelector('title')?.textContent?.trim() || undefined, author: meta('author'), description: meta('description'), language: d.documentElement.lang || undefined }
  const blk = d.querySelector('#preface, .meta, .tags, dl.tags')
  if (blk) Object.assign(m, parseHeader(blk.textContent?.replace(/\s*\n\s*/g, '\n') ?? ''))
  return clean(m)
}
/** TXT: only a header fenced by lines of `---` at the very top of the file. */
export async function extractTxt(f: File): Promise<Meta> {
  const head = await f.slice(0, 8192).text()
  const mt = head.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const m = mt ? parseHeader(mt[1]) : {}
  const t = mt && mt[1].match(/^title:\s*(.+)$/im)?.[1], a = mt && mt[1].match(/^author:\s*(.+)$/im)?.[1]
  return clean({ ...m, title: t || undefined, author: a || undefined })
}
export async function extract(f: File, opts: { pdfHeader?: boolean } = {}): Promise<{ format: Format; meta: Meta }> {
  const format = detectFormat(f)
  if (!format) throw new ImportError(`Unsupported file type: ${f.name}`)
  const meta = format === 'epub' ? await extractEpub(f) : format === 'pdf' ? await extractPdfWithHeader(f, opts.pdfHeader) : format === 'html' ? await extractHtml(f) : await extractTxt(f)
  return { format, meta }
}
/** Document info always; the labelled first-page header only when enabled. Document info wins on conflicts. A header that cannot be read is skipped. */
export async function extractPdfWithHeader(f: File, header = false): Promise<Meta> {
  const info = await extractPdf(f)
  if (!header) return info
  try { return clean({ ...parsePageOne(await firstPageText(f)), ...info }) } catch { return info }
}
