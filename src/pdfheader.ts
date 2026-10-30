import type { Meta } from './types'

// Reads ONLY the labelled header block on page 1 of a PDF (Rating:, Fandom:, Stats: ...), the way AO3 prints it.
// The page text is parsed in memory and discarded. Nothing after the Stats line is read, and no other page is opened.
const LABELS = /(Rating|Archive Warnings?|Category|Fandoms?|Relationships?|Characters?|Additional Tags|Language|Stats|Series)\s*:/g
const list = (s: string) => { const a = s.split(/\s*,\s*/).map(x => x.trim()).filter(Boolean); return a.length ? a : undefined }
const toNum = (s?: string) => (s ? parseInt(s.replace(/,/g, ''), 10) : undefined)

export function parsePageOne(text: string): Meta {
  const t = text.replace(/\s+/g, ' ').trim(); const m: Meta = {}
  const all = [...t.matchAll(LABELS)]; if (!all.length) return m
  const end = all.findIndex(h => /^stats$/i.test(h[1]))
  const hits = end === -1 ? all : all.slice(0, end + 1)          // never look past Stats
  const url = t.slice(0, hits[0].index).match(/https?:\/\/(?:www\.)?archiveofourown\.org\/works\/\d+/)    // title block only, before the first label
  if (url) m.sourceUrl = url[0]
  hits.forEach((h, i) => {
    const key = h[1].toLowerCase(), from = h.index! + h[0].length
    if (key === 'stats') {
      // anchored: only the expected stat fields in order, so following prose cannot match
      const s = t.slice(from).match(/^\s*(?:Published:\s*(\d{4}-\d{2}-\d{2}))?\s*(?:(?:Completed|Updated):\s*(\d{4}-\d{2}-\d{2}))?\s*(?:Words:\s*([\d,]+))?\s*(?:Chapters:\s*([\d,]+)\s*\/\s*([\d,]+|\?))?/)
      if (s) { if (s[1]) m.published = s[1]; if (s[2]) m.updated = s[2]; if (s[3]) m.words = toNum(s[3]); if (s[4]) { m.chapters = toNum(s[4]); m.complete = s[5] !== '?' && toNum(s[5]) === toNum(s[4]) } }
      return
    }
    const next = hits[i + 1]; if (!next) return                    // a value must end at another label, otherwise it could be prose
    const raw = t.slice(from, next.index).trim(); if (!raw) return
    if (/^rating$/.test(key) && !m.rating) m.rating = raw
    else if (/^archive warning/.test(key) && !m.warnings) m.warnings = list(raw)
    else if (/^fandom/.test(key) && !m.fandoms) m.fandoms = list(raw)
    else if (/^relationship/.test(key) && !m.relationships) m.relationships = list(raw)
    else if (/^character/.test(key) && !m.characters) m.characters = list(raw)
    else if (key === 'additional tags' && !m.tags) m.tags = list(raw)
    else if (key === 'language' && !m.language) m.language = raw.length <= 30 ? raw : undefined
  })
  return m
}
export async function firstPageText(f: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof document !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise
  try { return (await (await doc.getPage(1)).getTextContent()).items.map((i: any) => i.str ?? '').join(' ') } finally { await doc.destroy() }
}
export const pdfHeaderEnabled = () => { try { return localStorage.getItem('ficshelf.pdfHeader') !== 'off' } catch { return true } }
export const setPdfHeaderEnabled = (on: boolean) => { try { localStorage.setItem('ficshelf.pdfHeader', on ? 'on' : 'off') } catch {} }
