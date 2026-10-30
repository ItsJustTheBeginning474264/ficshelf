import { useEffect, useMemo, useState } from 'react'
import { addWork, clearLibrary, db, deleteTag, DuplicateError, exportBackup, importBackup, removeWork } from './db'
import Reader from './Reader'
import { pdfHeaderEnabled, setPdfHeaderEnabled } from './pdfheader'
import { checkRoom, copiesSize, fmtSize, loadCopy, removeAllCopies, removeCopy, requestPersistence, STORABLE, storageInfo, storeCopy, StorageError, type StorageInfo } from './storage'
import { extract, sha256, ImportError } from './extract'
import { applyFilter, effective } from './filter'
import { emptyFilter, STATUSES, type Filter, type Meta, type PTag, type SavedFilter, type Work } from './types'

type Tab = 'home' | 'library' | 'collections' | 'favourites' | 'settings'
type Draft = { file: File; hash: string; format: Work['format']; meta: Meta; auto: string[] }
const initials = (t = '?') => t.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
const inp = 'w-full rounded-xl bg-ink border border-line px-3 py-3 text-base'
const btn = 'min-h-12 rounded-xl px-4 bg-acc text-ink font-medium'
const ghost = 'min-h-12 rounded-xl px-4 border border-line text-fg'

export default function App() {
  const [works, setWorks] = useState<Work[]>([]); const [tags, setTags] = useState<PTag[]>([]); const [saved, setSaved] = useState<SavedFilter[]>([])
  const [tab, setTab] = useState<Tab>('home'); const [f, setF] = useState<Filter>(emptyFilter()); const [showF, setShowF] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set()); const [open, setOpen] = useState<Work | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([]); const [msgs, setMsgs] = useState<string[]>([]); const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState<{ work: Work; blob: Blob } | null>(null)
  const [sort, setSort] = useState<'added' | 'title' | 'words'>('added')
  const reload = async () => { setWorks(await db.works.toArray()); setTags(await db.tags.toArray()); setSaved(await db.filters.toArray()) }
  useEffect(() => { reload() }, [])
  const tagName = (id: number) => tags.find(t => t.id === id)?.name ?? ''
  const base = tab === 'favourites' ? { ...f, favouriteOnly: true } : f
  const shown = useMemo(() => applyFilter(works, base, tagName).sort((a, b) =>
    sort === 'title' ? (effective(a).title ?? a.fileName).localeCompare(effective(b).title ?? b.fileName)
    : sort === 'words' ? (effective(b).words ?? -1) - (effective(a).words ?? -1) : b.addedAt - a.addedAt), [works, f, tab, sort, tags])
  const all = (k: 'fandoms' | 'characters' | 'relationships' | 'tags') => [...new Set(works.flatMap(w => effective(w)[k] ?? []))].sort()

  async function pick(files: FileList | null) {
    if (!files) return; setBusy(true); const out: Draft[] = []; const errs: string[] = []
    for (const file of Array.from(files)) {
      try {
        const hash = await sha256(file)
        if (await db.works.where('hash').equals(hash).count()) { errs.push(`${file.name}: already in your library.`); continue }
        const { format, meta } = await extract(file, { pdfHeader: pdfHeaderEnabled() })
        out.push({ file, hash, format, meta, auto: Object.keys(meta) })
      } catch (e) { errs.push(`${file.name}: ${e instanceof ImportError ? e.message : 'could not be read.'}`) }
      await new Promise(r => setTimeout(r)) // yield so the UI stays responsive
    }
    setDrafts(out); setMsgs(errs); setBusy(false)
  }
  async function saveDraft(d: Draft, m: Meta, manual: string[], store: boolean) {
    const fields: Work['fields'] = {}; d.auto.forEach(k => fields[k] = 'auto'); manual.forEach(k => fields[k] = 'manual')
    const note: string[] = []
    try {
      const id = await addWork(db, { original: d.meta, edits: diff(d.meta, m), fields, format: d.format, size: d.file.size, hash: d.hash, fileName: d.file.name,
        addedAt: Date.now(), personalTagIds: [], status: 'Unread', favourite: false, notes: '', hasLocalCopy: false })
      if (store) {
        try { await storeCopy(db, (await db.works.get(id))!, d.file) }
        catch (e) { note.push(`${d.file.name} was added as metadata only. ${e instanceof StorageError ? e.message : 'Storing the file failed.'}`) }
      }
    } catch (e) { note.push(e instanceof DuplicateError ? `${d.file.name}: already in your library.` : `${d.file.name}: could not be saved.`) }
    if (note.length) setMsgs(x => [...x, ...note])
    setDrafts(x => x.filter(y => y !== d)); reload()
  }
  async function openFic(w: Work) {
    try {
      const blob = await loadCopy(db, w); const n = Date.now()
      await db.works.update(w.id!, { openedAt: n }); setReading({ work: { ...w, openedAt: n }, blob }); reload()
    } catch (e) { setMsgs([e instanceof StorageError ? e.message : 'The stored file could not be opened.']); setOpen(o => o && o.id === w.id ? { ...o, hasLocalCopy: false } : o); reload() }
  }
  async function addCopy(w: Work, file: File | undefined) {
    if (!file) return
    try { await storeCopy(db, w, file); setOpen({ ...w, hasLocalCopy: true }); setMsgs(['Copy stored. You can now open this fic inside FicShelf.']) }
    catch (e) { setMsgs([e instanceof StorageError ? e.message : 'Storing the file failed.']) }
    reload()
  }
  const dropCopy = async (w: Work) => { if (confirm('Remove the stored copy? Your metadata stays and the original file on your device is untouched.')) { await removeCopy(db, w.id!); setOpen({ ...w, hasLocalCopy: false }); reload() } }
  const update = async (w: Work, p: Partial<Work>) => { await db.works.update(w.id!, p); const n = { ...w, ...p }; setOpen(o => (o?.id === w.id ? n : o)); reload() }
  const random = (pool: Work[]) => pool.length ? setOpen(pool[Math.floor(Math.random() * pool.length)]) : setMsgs(['No fics match that pool yet. Import some or loosen your filters.'])
  const bulkTag = async (id: number, add: boolean) => {
    for (const wid of sel) { const w = works.find(x => x.id === wid)!; const s = new Set(w.personalTagIds); add ? s.add(id) : s.delete(id); await db.works.update(wid, { personalTagIds: [...s] }) }
    reload()
  }

  const Card = ({ w }: { w: Work }) => { const m = effective(w); const on = sel.has(w.id!)
    return <button onClick={() => (sel.size ? setSel(s => { const n = new Set(s); on ? n.delete(w.id!) : n.add(w.id!); return n }) : setOpen(w))}
      onContextMenu={e => { e.preventDefault(); setSel(new Set([w.id!])) }}
      className={`flex gap-3 text-left w-full rounded-2xl bg-pane p-3 border ${on ? 'border-acc' : 'border-line'}`}>
      <div aria-hidden className="shrink-0 w-14 h-20 rounded-lg grid place-items-center font-serif text-xl" style={{ background: `hsl(${hue(m.title ?? w.fileName)} 28% 28%)` }}>{initials(m.title ?? w.fileName)}</div>
      <div className="min-w-0">
        <div className="font-serif text-lg leading-snug truncate">{m.title ?? w.fileName}</div>
        <div className="text-dim text-sm truncate">{m.author ?? 'Unknown author'}{m.fandoms?.length ? `, ${m.fandoms[0]}` : ''}</div>
        {m.relationships?.[0] && <div className="text-sm truncate text-moss">{m.relationships[0]}</div>}
        <div className="text-xs text-dim mt-1">{m.words !== undefined ? `${m.words.toLocaleString()} words, ` : ''}{w.status}{w.personalRating ? `, ${'★'.repeat(w.personalRating)}` : ''}{w.favourite ? ', favourite' : ''}</div>
      </div></button> }
  const List = ({ ws }: { ws: Work[] }) => ws.length ? <div className="grid gap-3">{ws.slice(0, 200).map(w => <Card key={w.id} w={w} />)}{ws.length > 200 && <p className="text-dim text-sm">Showing 200 of {ws.length}. Narrow with filters.</p>}</div>
    : <p className="text-dim py-8">Nothing here yet. Tap Import to add EPUB, PDF, HTML or TXT files from your phone.</p>
  const chips: [string, () => void][] = [
    ...f.fandoms.map(x => [x, () => setF({ ...f, fandoms: f.fandoms.filter(y => y !== x) })] as [string, () => void]),
    ...f.statuses.map(x => [x, () => setF({ ...f, statuses: f.statuses.filter(y => y !== x) })] as [string, () => void]),
    ...f.tags.map(x => ['+' + x, () => setF({ ...f, tags: f.tags.filter(y => y !== x) })] as [string, () => void]),
    ...f.exclude.tags.map(x => ['−' + x, () => setF({ ...f, exclude: { ...f.exclude, tags: f.exclude.tags.filter(y => y !== x) } })] as [string, () => void]),
    ...f.personalTagIds.map(x => ['♥ ' + tagName(x), () => setF({ ...f, personalTagIds: f.personalTagIds.filter(y => y !== x) })] as [string, () => void])]

  return <div className="min-h-screen max-w-2xl mx-auto pb-28 px-4 pt-4">
    <header className="flex items-center justify-between mb-4"><h1 className="font-serif text-3xl text-acc">FicShelf</h1>
      <label className={btn + ' grid place-items-center cursor-pointer'}>Import<input type="file" multiple hidden accept=".epub,.pdf,.html,.htm,.txt" onChange={e => { pick(e.target.files); e.target.value = '' }} /></label></header>
    {busy && <p role="status" className="text-dim mb-2">Reading file metadata…</p>}
    {msgs.map((m, i) => <p key={i} role="alert" className="text-sm bg-pane border border-line rounded-xl p-3 mb-2" onClick={() => setMsgs(x => x.filter((_, j) => j !== i))}>{m}</p>)}
    {drafts[0] && <DraftForm key={drafts[0].hash} d={drafts[0]} onSave={saveDraft} onSkip={() => setDrafts(x => x.slice(1))} />}

    {(tab === 'home' || tab === 'library' || tab === 'favourites') && <>
      <input aria-label="Search library metadata" className={inp + ' mb-3'} placeholder="Search title, author, fandom, pairing, tags" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
      {tab === 'home' && !f.q ? <>
        <p className="text-dim mb-4">{works.length} fics, {works.filter(w => w.status === 'Unread').length} unread, {tags.length} personal tags</p>
        <div className="flex gap-2 mb-6"><button className={btn} onClick={() => random(works)}>Random fic</button><button className={ghost} onClick={() => random(works.filter(w => w.status === 'Unread'))}>Random unread</button></div>
        <h2 className="font-serif text-xl mb-2">Recently added</h2><List ws={[...works].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5)} />
        <h2 className="font-serif text-xl mt-6 mb-2">Recently opened</h2><List ws={works.filter(w => w.openedAt).sort((a, b) => b.openedAt! - a.openedAt!).slice(0, 5)} />
      </> : <>
        <div className="flex gap-2 mb-2"><button className={ghost} onClick={() => setShowF(!showF)}>Filters</button>
          <select aria-label="Sort" className={inp + ' !w-auto'} value={sort} onChange={e => setSort(e.target.value as any)}><option value="added">Newest</option><option value="title">Title</option><option value="words">Longest</option></select>
          <button className={ghost} onClick={() => random(shown)}>Random</button></div>
        {showF && <FilterPanel f={f} setF={setF} fandoms={all('fandoms')} chars={all('characters')} rels={all('relationships')} otags={all('tags')} ptags={tags} />}
        <div className="flex flex-wrap gap-2 my-2">{chips.map(([l, rm]) => <button key={l} onClick={rm} className="px-3 min-h-9 rounded-full bg-line text-sm">{l} ✕</button>)}</div>
        <div className="flex items-center justify-between text-dim text-sm mb-2"><span>{shown.length} results</span>
          {JSON.stringify(f) !== JSON.stringify(emptyFilter()) && <><button className="underline min-h-9" onClick={() => { const n = prompt('Name this filter'); if (n) db.filters.add({ name: n, filter: f }).then(reload) }}>Save filter</button><button className="underline min-h-9" onClick={() => setF(emptyFilter())}>Clear all</button></>}</div>
        {sel.size > 0 && <div className="sticky top-0 z-10 bg-pane border border-line rounded-xl p-2 mb-2 flex flex-wrap gap-2 items-center"><span>{sel.size} selected</span>
          {tags.map(t => <span key={t.id} className="flex"><button className="px-2 min-h-9 rounded-l-lg bg-line" onClick={() => bulkTag(t.id!, true)}>+{t.name}</button><button className="px-2 min-h-9 rounded-r-lg bg-ink border border-line" aria-label={`Remove ${t.name}`} onClick={() => bulkTag(t.id!, false)}>−</button></span>)}
          <button className="min-h-9 px-2 underline" onClick={() => setSel(new Set())}>Done</button></div>}
        <List ws={shown} /></>}
    </>}

    {tab === 'collections' && <Collections saved={saved} tags={tags} reload={reload} apply={x => { setF(x); setTab('library') }} works={works} />}
    {tab === 'settings' && <section className="grid gap-3">
      <h2 className="font-serif text-xl">Backup</h2>
      <p className="text-dim text-sm">Metadata backups hold tags, ratings, notes and statuses. They do not contain your story files.</p>
      <button className={btn} onClick={async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([await exportBackup(db)], { type: 'application/json' })); a.download = 'ficshelf-metadata.json'; a.click() }}>Export metadata backup</button>
      <label className={ghost + ' grid place-items-center'}>Restore metadata backup<input hidden type="file" accept=".json" onChange={async e => { const t = await e.target.files?.[0]?.text(); if (!t || !confirm('Restoring replaces your current library records. Continue?')) return; try { await importBackup(db, t); reload() } catch (x: any) { setMsgs([x.message]) } }} /></label>
      <button className={ghost + ' text-red-300'} onClick={async () => { if (confirm('Clear all library records and stored copies in FicShelf? Your original files on the device are not touched.')) { await clearLibrary(db); reload() } }}>Clear library and stored copies</button>
      <PdfHeaderToggle />
      <StorageCard works={works} onChange={reload} />
      <h2 className="font-serif text-xl mt-4">Privacy</h2>
      <p className="text-dim text-sm">Everything stays on this device. No accounts, analytics, uploads or AI. Story text is never read or analyzed. FicShelf keeps metadata only, so reopening a file means picking it again from your device.</p></section>}

    {open && <Detail w={open} tags={tags} onClose={() => setOpen(null)} update={update} onRemove={async () => { if (confirm('Remove from library? This also removes any copy stored in FicShelf. The original file on your device is not touched.')) { await removeWork(db, open.id!); setOpen(null); reload() } }} onOpenFic={() => openFic(open)} onAddCopy={f => addCopy(open, f)} onDropCopy={() => dropCopy(open)} />}
    {reading && <Reader work={reading.work} blob={reading.blob} title={effective(reading.work).title ?? reading.work.fileName} onClose={() => setReading(null)} onProgress={c => db.works.update(reading.work.id!, { resumeCfi: c })} />}
    <nav className="fixed bottom-0 inset-x-0 bg-pane border-t border-line grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
      {(['home', 'library', 'collections', 'favourites', 'settings'] as Tab[]).map(t => <button key={t} aria-current={tab === t} onClick={() => setTab(t)} className={`min-h-14 capitalize text-sm ${tab === t ? 'text-acc' : 'text-dim'}`}>{t}</button>)}</nav>
  </div>
}
function diff(a: Meta, b: Meta): Meta { const o: any = {}; for (const k of Object.keys(b)) if (JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k])) o[k] = (b as any)[k]; return o }
const csv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
function DraftForm({ d, onSave, onSkip }: { d: Draft; onSave: (d: Draft, m: Meta, manual: string[], store: boolean) => void; onSkip: () => void }) {
  const [m, setM] = useState<Meta>({ ...d.meta, title: d.meta.title ?? d.file.name.replace(/\.\w+$/, '') })
  const [store, setStore] = useState(false); const [room, setRoom] = useState<string | null>(null); const [info, setInfo] = useState<StorageInfo | null>(null)
  const canStore = STORABLE.includes(d.format)
  useEffect(() => { storageInfo().then(i => { setInfo(i); try { checkRoom(i, d.file.size) } catch (e: any) { setRoom(e.message) } }) }, [])
  const L = (label: string, k: keyof Meta, list = false, number = false) => <label className="block text-sm">{label} <span className="text-dim">{d.auto.includes(k) ? '(from file)' : '(enter manually)'}</span>
    <input className={inp} inputMode={number ? 'numeric' : undefined} value={list ? ((m[k] as string[]) ?? []).join(', ') : (m[k] as any) ?? ''}
      onChange={e => setM({ ...m, [k]: number ? (e.target.value ? Number(e.target.value) : undefined) : list ? csv(e.target.value) : e.target.value || undefined })} /></label>
  return <div role="dialog" aria-label="Review metadata" className="fixed inset-0 z-20 bg-ink/95 overflow-auto p-4"><div className="max-w-2xl mx-auto grid gap-3">
    <h2 className="font-serif text-2xl">Review {d.file.name}</h2>
    {L('Title', 'title')}{L('Author', 'author')}{L('Fandoms (comma separated)', 'fandoms', true)}{L('Relationships', 'relationships', true)}{L('Characters', 'characters', true)}{L('Rating', 'rating')}{L('Archive warnings', 'warnings', true)}{L('Additional tags', 'tags', true)}{L('Word count', 'words', false, true)}{L('Chapters', 'chapters', false, true)}{L('Source URL', 'sourceUrl')}
    <fieldset className="rounded-xl border border-line p-3 text-sm"><legend className="px-1">File</legend>
      <label className="flex items-start gap-2 min-h-10"><input type="checkbox" className="mt-1" disabled={!canStore || !!room} checked={store && canStore} onChange={e => setStore(e.target.checked)} />
        <span>Store a copy inside FicShelf ({fmtSize(d.file.size)}) so you can open it here</span></label>
      <p className="text-dim mt-1">{!canStore ? 'Only EPUB and PDF can be stored for now. This file will be added as metadata only.' : room ?? 'Off by default. The file is saved unchanged in this browser and may be cleared if the browser or device clears site data. Keep your original file as the master copy.'}{info && info.quota ? ` Free space: about ${fmtSize(Math.max(0, info.quota - info.usage))} (browser estimate).` : ''}</p></fieldset>
    <div className="flex gap-2"><button className={btn} onClick={() => onSave(d, m, Object.keys(m).filter(k => !d.auto.includes(k)), store && canStore && !room)}>Save to library</button><button className={ghost} onClick={onSkip}>Skip</button></div></div></div>
}
function Chips({ opts, on, toggle }: { opts: string[]; on: string[]; toggle: (x: string) => void }) {
  return <div className="flex flex-wrap gap-2">{opts.map(o => <button key={o} aria-pressed={on.includes(o)} onClick={() => toggle(o)} className={`px-3 min-h-10 rounded-full text-sm ${on.includes(o) ? 'bg-acc text-ink' : 'bg-line'}`}>{o}</button>)}</div> }
function FilterPanel({ f, setF, fandoms, chars, rels, otags, ptags }: { f: Filter; setF: (f: Filter) => void; fandoms: string[]; chars: string[]; rels: string[]; otags: string[]; ptags: PTag[] }) {
  const tg = (arr: string[], x: string) => arr.includes(x) ? arr.filter(y => y !== x) : [...arr, x]
  const n = (v: string) => v ? Number(v) : undefined
  return <div className="bg-pane border border-line rounded-2xl p-3 grid gap-3 mb-2">
    <p className="text-dim text-xs">Choices inside one group match any of them. Different groups must all match. Required tags must all be present. Excluded tags hide a fic if any is present.</p>
    <b>Fandom</b><Chips opts={fandoms} on={f.fandoms} toggle={x => setF({ ...f, fandoms: tg(f.fandoms, x) })} />
    <b>Relationship</b><Chips opts={rels} on={f.relationships} toggle={x => setF({ ...f, relationships: tg(f.relationships, x) })} />
    <b>Require original tags</b><Chips opts={otags} on={f.tags} toggle={x => setF({ ...f, tags: tg(f.tags, x) })} />
    <b>Exclude original tags</b><Chips opts={otags} on={f.exclude.tags} toggle={x => setF({ ...f, exclude: { ...f.exclude, tags: tg(f.exclude.tags, x) } })} />
    <b>Personal tags</b><Chips opts={ptags.map(t => t.name)} on={ptags.filter(t => f.personalTagIds.includes(t.id!)).map(t => t.name)} toggle={x => { const id = ptags.find(t => t.name === x)!.id!; setF({ ...f, personalTagIds: f.personalTagIds.includes(id) ? f.personalTagIds.filter(y => y !== id) : [...f.personalTagIds, id] }) }} />
    <b>Reading status</b><Chips opts={STATUSES} on={f.statuses} toggle={x => setF({ ...f, statuses: tg(f.statuses, x) as any })} />
    <b>Words</b><div className="flex gap-2"><input aria-label="Minimum words" className={inp} inputMode="numeric" placeholder="Min" value={f.minWords ?? ''} onChange={e => setF({ ...f, minWords: n(e.target.value) })} /><input aria-label="Maximum words" className={inp} inputMode="numeric" placeholder="Max" value={f.maxWords ?? ''} onChange={e => setF({ ...f, maxWords: n(e.target.value) })} /></div>
    <b>Completion</b><Chips opts={['Complete', 'In progress']} on={f.complete === undefined ? [] : [f.complete ? 'Complete' : 'In progress']} toggle={x => setF({ ...f, complete: f.complete === (x === 'Complete') ? undefined : x === 'Complete' })} />
    <b>Format</b><Chips opts={['epub', 'pdf', 'html', 'txt']} on={f.formats} toggle={x => setF({ ...f, formats: tg(f.formats, x) as any })} />
    <label className="flex items-center gap-2 min-h-10"><input type="checkbox" checked={f.minRating === 4} onChange={e => setF({ ...f, minRating: e.target.checked ? 4 : undefined })} />My rating 4 stars or more</label>
  </div>
}
function Collections({ saved, tags, reload, apply, works }: { saved: SavedFilter[]; tags: PTag[]; reload: () => void; apply: (f: Filter) => void; works: Work[] }) {
  const [name, setName] = useState('')
  return <section className="grid gap-3"><h2 className="font-serif text-xl">Saved filters</h2>
    {!saved.length && <p className="text-dim">Build a filter in Library, then tap Save filter.</p>}
    {saved.map(s => <div key={s.id} className="flex gap-2"><button className={ghost + ' flex-1 text-left'} onClick={() => apply(s.filter)}>{s.name}</button><button className={ghost} aria-label={`Delete ${s.name}`} onClick={() => confirm('Delete this saved filter?') && db.filters.delete(s.id!).then(reload)}>✕</button></div>)}
    <h2 className="font-serif text-xl mt-4">Personal tags</h2>
    <div className="flex gap-2"><input aria-label="New tag name" className={inp} placeholder="e.g. Comfort Fic" value={name} onChange={e => setName(e.target.value)} />
      <button className={btn} onClick={async () => { const n = name.trim(); if (n && !(await db.tags.where('name').equals(n).count())) { await db.tags.add({ name: n }); setName(''); reload() } }}>Add</button></div>
    {tags.map(t => <div key={t.id} className="flex gap-2 items-center"><span className="flex-1">{t.name} <span className="text-dim text-sm">({works.filter(w => w.personalTagIds.includes(t.id!)).length})</span></span>
      <button className={ghost} onClick={async () => { const n = prompt('Rename tag', t.name)?.trim(); if (n) { await db.tags.update(t.id!, { name: n }); reload() } }}>Rename</button>
      <button className={ghost} onClick={async () => { if (confirm(`Delete "${t.name}"? Fics are kept.`)) { await deleteTag(db, t.id!); reload() } }}>Delete</button></div>)}</section>
}
function Detail({ w, tags, onClose, update, onRemove, onOpenFic, onAddCopy, onDropCopy }: { w: Work; tags: PTag[]; onClose: () => void; update: (w: Work, p: Partial<Work>) => void; onRemove: () => void; onOpenFic: () => void; onAddCopy: (f: File | undefined) => void; onDropCopy: () => void }) {
  const m = effective(w)
  return <div role="dialog" aria-label="Fic details" className="fixed inset-0 z-20 bg-ink overflow-auto p-4"><div className="max-w-2xl mx-auto grid gap-3">
    <button className={ghost + ' justify-self-start'} onClick={onClose}>Back</button>
    <h2 className="font-serif text-2xl">{m.title ?? w.fileName}</h2><p className="text-dim">{m.author ?? 'Unknown author'}</p>
    <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {([['Fandoms', m.fandoms?.join(', ')], ['Relationships', m.relationships?.join(', ')], ['Characters', m.characters?.join(', ')], ['Rating', m.rating], ['Warnings', m.warnings?.join(', ')], ['Words', m.words?.toLocaleString()], ['Chapters', m.chapters], ['Status', m.complete === undefined ? undefined : m.complete ? 'Complete' : 'In progress'], ['Format', `${w.format.toUpperCase()}, ${(w.size / 1024).toFixed(0)} KB`], ['Original tags', m.tags?.join(', ')], ['Source', m.sourceUrl]] as [string, any][]).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => <><dt className="text-dim">{k}</dt><dd key={k}>{String(v)}</dd></>)}</dl>
    <section className="rounded-xl border border-line p-3 grid gap-2" aria-label="File availability">
      <p className="text-sm"><b>{w.hasLocalCopy ? 'Stored in FicShelf' : 'Metadata only'}</b> <span className="text-dim">({w.fileName}, {fmtSize(w.size)})</span></p>
      {w.hasLocalCopy ? <><button className={btn} onClick={onOpenFic}>Open Fic</button><button className={ghost} onClick={onDropCopy}>Remove stored copy</button></>
        : STORABLE.includes(w.format) ? <><p className="text-dim text-sm">No copy is stored here. Pick the same file again from your device to store it. Files that differ from the imported one are rejected.</p>
          <label className={btn + ' grid place-items-center cursor-pointer'}>Store a copy<input hidden type="file" accept={w.format === 'pdf' ? '.pdf' : '.epub'} onChange={e => { onAddCopy(e.target.files?.[0]); e.target.value = '' }} /></label></>
        : <p className="text-dim text-sm">{w.format.toUpperCase()} files can't be stored yet. Open the file from your device's Files app.</p>}</section>
    <b>My tags</b><div className="flex flex-wrap gap-2">{tags.map(t => { const on = w.personalTagIds.includes(t.id!); return <button key={t.id} aria-pressed={on} className={`px-3 min-h-10 rounded-full text-sm border ${on ? 'bg-moss text-ink border-moss' : 'border-line'}`} onClick={() => update(w, { personalTagIds: on ? w.personalTagIds.filter(x => x !== t.id) : [...w.personalTagIds, t.id!] })}>{t.name}</button> })}{!tags.length && <span className="text-dim text-sm">Create tags under Collections.</span>}</div>
    <label className="text-sm">Reading status<select className={inp} value={w.status} onChange={e => update(w, { status: e.target.value as any })}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
    <div role="group" aria-label="My rating" className="flex gap-1">{[1, 2, 3, 4, 5].map(n => <button key={n} aria-label={`${n} stars`} className="min-h-12 min-w-12 text-2xl" onClick={() => update(w, { personalRating: w.personalRating === n ? undefined : n })}>{(w.personalRating ?? 0) >= n ? '★' : '☆'}</button>)}</div>
    <label className="text-sm">Notes<textarea className={inp} rows={4} defaultValue={w.notes} onBlur={e => update(w, { notes: e.target.value })} /></label>
    <div className="flex gap-2"><button className={btn} onClick={() => update(w, { favourite: !w.favourite, favouritedAt: w.favourite ? undefined : Date.now() })}>{w.favourite ? 'Remove favourite' : 'Add favourite'}</button><button className={ghost} onClick={onRemove}>Remove from library</button></div>
  </div></div>
}

function StorageCard({ works, onChange }: { works: Work[]; onChange: () => void }) {
  const [info, setInfo] = useState<StorageInfo | null | undefined>(undefined); const [used, setUsed] = useState(0); const [note, setNote] = useState('')
  const refresh = () => { storageInfo().then(setInfo); copiesSize(db).then(setUsed) }
  useEffect(refresh, [works])
  const n = works.filter(w => w.hasLocalCopy).length
  return <section className="grid gap-2"><h2 className="font-serif text-xl mt-4">Stored copies</h2>
    <p className="text-sm">{n} stored, {fmtSize(used)} used by copies.{info?.quota ? ` Browser estimate: ${fmtSize(info.usage)} used of about ${fmtSize(info.quota)} available.` : info === null ? ' This browser does not report storage usage.' : ''}</p>
    <p className="text-dim text-sm">Browser storage is limited and shared with other site data. The browser can clear it when the device runs low on space, and clearing site data or uninstalling the app removes it. Backups never include stored files, so keep your original files.</p>
    {info && !info.persisted && <button className={ghost} onClick={async () => setNote((await requestPersistence()) ? 'Persistent storage granted. The browser is less likely to clear your copies, but this is not a guarantee.' : 'The browser declined persistent storage. Installing the app to your home screen can help.')}>Ask browser to keep storage</button>}
    {info?.persisted && <p className="text-sm text-moss">Persistent storage is on, which makes automatic clearing less likely.</p>}
    {note && <p role="status" className="text-sm">{note}</p>}
    {n > 0 && <button className={ghost} onClick={async () => { if (confirm(`Remove all ${n} stored copies? Metadata and your original files stay.`)) { await removeAllCopies(db); onChange(); refresh() } }}>Remove all stored copies</button>}
  </section>
}

function PdfHeaderToggle() {
  const [on, setOn] = useState(pdfHeaderEnabled())
  return <section className="grid gap-1"><h2 className="font-serif text-xl mt-4">PDF import</h2>
    <label className="flex items-start gap-2 min-h-10"><input type="checkbox" className="mt-1" checked={on} onChange={e => { setOn(e.target.checked); setPdfHeaderEnabled(e.target.checked) }} />
      <span>Read the labelled header on a PDF's first page (Fandom, Rating, Stats and similar lines)</span></label>
    <p className="text-dim text-sm">Done on your device with no AI. Only the header lines are kept and the page text is discarded. Nothing after the Stats line and no other page is read. You can always correct the result before saving.</p></section>
}
