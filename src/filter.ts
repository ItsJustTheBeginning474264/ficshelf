import type { Filter, Meta, Work } from './types'
export const effective = (w: Work): Meta => ({ ...w.original, ...w.edits })
export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}\s/]/gu, ' ').replace(/\s+/g, ' ').trim()
const has = (have: string[] = [], want: string[]) => want.some(x => have.some(h => norm(h) === norm(x)))
/** Semantics: within a category, selected values are OR'd; categories are AND'd; excluded values remove any match. */
export function matches(w: Work, f: Filter, tagName: (id: number) => string = String): boolean {
  const m = effective(w)
  if (f.q) {
    const hay = norm([m.title, m.author, ...(m.fandoms ?? []), ...(m.characters ?? []), ...(m.relationships ?? []), ...(m.tags ?? []), ...w.personalTagIds.map(tagName)].filter(Boolean).join(' '))
    if (!norm(f.q).split(' ').every(t => hay.includes(t))) return false
  }
  if (f.fandoms.length && !has(m.fandoms, f.fandoms)) return false
  if (f.authors.length && !f.authors.some(a => norm(a) === norm(m.author ?? ''))) return false
  if (f.characters.length && !has(m.characters, f.characters)) return false
  if (f.relationships.length && !has(m.relationships, f.relationships)) return false
  if (f.ratings.length && !f.ratings.includes(m.rating ?? '')) return false
  if (f.warnings.length && !has(m.warnings, f.warnings)) return false
  if (f.tags.length && !f.tags.every(t => has(m.tags, [t]))) return false          // required tags: ALL
  if (f.personalTagIds.length && !f.personalTagIds.every(t => w.personalTagIds.includes(t))) return false
  const x = f.exclude
  if (has(m.characters, x.characters) || has(m.relationships, x.relationships) || has(m.warnings, x.warnings) || has(m.tags, x.tags)) return false
  if (x.personalTagIds.some(t => w.personalTagIds.includes(t))) return false
  // Missing values never count as 0: a work without a word count fails any word-count bound.
  if ((f.minWords !== undefined || f.maxWords !== undefined) && m.words === undefined) return false
  if (f.minWords !== undefined && m.words! < f.minWords) return false
  if (f.maxWords !== undefined && m.words! > f.maxWords) return false
  if ((f.minChapters !== undefined || f.maxChapters !== undefined) && m.chapters === undefined) return false
  if (f.minChapters !== undefined && m.chapters! < f.minChapters) return false
  if (f.maxChapters !== undefined && m.chapters! > f.maxChapters) return false
  if (f.complete !== undefined && m.complete !== f.complete) return false
  if (f.statuses.length && !f.statuses.includes(w.status)) return false
  if (f.minRating !== undefined && (w.personalRating ?? 0) < f.minRating) return false
  if (f.favouriteOnly && !w.favourite) return false
  if (f.formats.length && !f.formats.includes(w.format)) return false
  if (f.addedAfter !== undefined && w.addedAt < f.addedAfter) return false
  return true
}
export const applyFilter = (ws: Work[], f: Filter, tagName?: (id: number) => string) => ws.filter(w => matches(w, f, tagName))
