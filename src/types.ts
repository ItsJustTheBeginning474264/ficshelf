export type Status = 'Unread' | 'Currently Reading' | 'Read' | 'On Hold' | 'Abandoned'
export const STATUSES: Status[] = ['Unread', 'Currently Reading', 'Read', 'On Hold', 'Abandoned']
export type Format = 'epub' | 'pdf' | 'html' | 'txt'
export interface Meta {
  title?: string; author?: string; fandoms?: string[]; characters?: string[]; relationships?: string[]
  rating?: string; warnings?: string[]; tags?: string[]; words?: number; chapters?: number
  complete?: boolean; sourceUrl?: string; published?: string; updated?: string; description?: string; language?: string
}
export interface Work {
  id?: number; original: Meta; edits: Meta; fields: Record<string, 'auto' | 'manual'>
  format: Format; size: number; hash: string; fileName: string; addedAt: number; openedAt?: number
  personalTagIds: number[]; personalRating?: number; status: Status; progress?: number
  favourite: boolean; favouritedAt?: number; notes: string; hasLocalCopy: boolean; resumeCfi?: string
}
export interface PTag { id?: number; name: string }
export interface SavedFilter { id?: number; name: string; filter: Filter }
export interface Filter {
  q: string; fandoms: string[]; authors: string[]; characters: string[]; relationships: string[]
  ratings: string[]; warnings: string[]; tags: string[]; personalTagIds: number[]
  exclude: { characters: string[]; relationships: string[]; warnings: string[]; tags: string[]; personalTagIds: number[] }
  minWords?: number; maxWords?: number; minChapters?: number; maxChapters?: number
  complete?: boolean; statuses: Status[]; minRating?: number; favouriteOnly: boolean
  formats: Format[]; addedAfter?: number
}
export const emptyFilter = (): Filter => ({ q: '', fandoms: [], authors: [], characters: [], relationships: [], ratings: [], warnings: [], tags: [],
  personalTagIds: [], exclude: { characters: [], relationships: [], warnings: [], tags: [], personalTagIds: [] }, statuses: [], favouriteOnly: false, formats: [] })
export interface StoredFile { workId: number; blob: Blob; mime: string; size: number; storedAt: number }
