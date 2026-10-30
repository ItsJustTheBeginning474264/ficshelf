import { useEffect, useMemo, useState } from 'react'
import { addWork, clearLibrary, db, deleteTag, DuplicateError, exportBackup, importBackup, removeWork } from './db'
import Reader from './Reader'
import { pdfHeaderEnabled, setPdfHeaderEnabled } from './pdfheader'
import { autoStoreEnabled, setAutoStoreEnabled } from './storage'
import { checkRoom, copiesSize, fmtSize, loadCopy, removeAllCopies, removeCopy, requestPersistence, STORABLE, storageInfo, storeCopy, StorageError, type StorageInfo } from './storage'
import { extract, sha256, ImportError } from './extract'
import { applyFilter, effective, norm } from './filter'
import { emptyFilter, STATUSES, type Filter, type Meta, type PTag, type SavedFilter, type Work } from './types'

type Tab = 'home' | 'library' | 'collections' | 'favourites' | 'settings'
const initials = (t = '?') => t.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
const inp = 'w-full rounded-xl bg-ink border border-line px-3 py-3 text-base'
const btn = 'min-h-12 rounded-xl px-4 bg-acc text-ink font-medium'
const ghost = 'min-h-12 rounded-xl px-4 border border-line text-fg'

export default function App() {
  const [works, setWorks] = useState<Work[]>([]); const [tags, setTags] = useState<PTag[]>([]); const [saved, setSaved] = useState<SavedFilter[]>([])
  const [tab, setTab] = useState<Tab>('home'); const [f, setF] = useState<Filter>(emptyFilter()); const [showF, setShowF] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set()); const [open, setOpen] = useState<Work | null>(null)
  const [editing, setEditing] = useState<Work | null>(null); const [msgs, setMsgs] = useState<string[]>([]); const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState<{ work: Work; blob: Blob } | null>(null)
  const [sort, setSort] = useState<'added' | 'title' | 'words'>('added')
  const reload = async () => { setWorks(await db.works.toArray()); setTags(await db.tags.toArray()); setSaved(await db.filters.toArray()) }
  useEffect(() => { reload() }, [])
  const tagName = (id: number) => tags.find(t => t.id === id)?.name ?? ''
  const base = tab === 'favourites' ? { ...f, favouriteOnly: true } : f
  const shown = useMemo(() => applyFilter(works, base, tagName).sort((a, b) =>
    sort === 'title' ? (effective(a).title ?? a.fileName).localeCompare(effective(b).title ?? b.fileName)
    : sort === 'words' ? (effective(b).words ?? -1) - (effective(a).words ?? -1) : b.addedAt - a.addedAt), [works, f, tab, sort, tags])

  async function pick(files: FileList | null) {
    if (!files?.length) return; const list = Array.from(files)       // copy before the input is reset
    setBusy(true); const notes: string[] = []; let added = 0; const store = autoStoreEnabled(), header = pdfHeaderEnabled()
    for (const file of list) {
      try {
        const hash = await sha256(file)
        if (await db.works.where('hash').equals(hash).count()) { notes.push(`${file.name}: already in your library.`); continue }
        const { format, meta } = await extract(file, { pdfHeader: header })
        const id = await addWork(db, { original: meta, edits: {}, fields: Object.fromEntries(Object.keys(meta).map(k => [k, 'auto' as const])), format, size: file.size, hash, fileName: file.name,
          addedAt: Date.now(), personalTagIds: [], status: 'Unread', favourite: false, notes: '', hasLocalCopy: false })
        added++
        if (store && STORABLE.includes(format)) {
          try { await storeCopy(db, (await db.works.get(id))!, file) }
          catch (e) { notes.push(`${file.name}: added as metadata only. ${e instanceof StorageError ? e.message : 'Storing the file failed.'}`) }
        }
      } catch (e) { notes.push(`${file.name}: ${e instanceof DuplicateError ? 'already in your library.' : e instanceof ImportError ? e.message : 'could not be read.'}`) }
      await new Promise(r => setTimeout(r))   // keep the UI responsive between files
    }
    setMsgs([`Imported ${added} of ${list.length} file${list.length === 1 ? '' : 's'}. Open a fic to edit its details.`, ...notes]); setBusy(false); reload()
  }
  const saveEdits = async (w: Work, m: Meta) => {
    const edits = diff(w.original, m); const fields = { ...w.fields }; Object.keys(edits).forEach(k => { fields[k] = 'manual' })
    await update(w, { edits, fields }); setEditing(null)
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
  const lc = (pre: string, vals: string[], set: (v: string[]) => void): [string, () => void][] => vals.map(x => [pre + x, () => set(vals.filter(y => y !== x))])
  const ex = f.exclude, setEx = (p: Partial<Filter['exclude']>) => setF({ ...f, exclude: { ...ex, ...p } })
  const chips: [string, () => void][] = [
    ...lc('', f.fandoms, v => setF({ ...f, fandoms: v })), ...lc('', f.authors, v => setF({ ...f, authors: v })), ...lc('', f.relationships, v => setF({ ...f, relationships: v })), ...lc('', f.characters, v => setF({ ...f, characters: v })),
    ...lc('+', f.tags, v => setF({ ...f, tags: v })), ...lc('', f.statuses, v => setF({ ...f, statuses: v as any })),
    ...f.personalTagIds.map(x => ['♥ ' + tagName(x), () => setF({ ...f, personalTagIds: f.personalTagIds.filter(y => y !== x) })] as [string, () => void]),
    ...lc('−', ex.tags, v => setEx({ tags: v })), ...lc('−', ex.characters, v => setEx({ characters: v })), ...lc('−', ex.relationships, v => setEx({ relationships: v })),
    ...ex.personalTagIds.map(x => ['−♥ ' + tagName(x), () => setEx({ personalTagIds: ex.personalTagIds.filter(y => y !== x) })] as [string, () => void])]

  return <div className="min-h-screen max-w-2xl mx-auto pb-28 px-4 pt-4">
    <header className="flex items-center justify-between mb-4"><h1 className="font-serif text-3xl text-acc">FicShelf</h1>
      <label className={btn + ' grid place-items-center cursor-pointer'}>Import<input type="file" multiple hidden accept=".epub,.pdf,.html,.htm,.txt" onChange={e => { pick(e.target.files); e.target.value = '' }} /></label></header>
    {busy && <p role="status" className="text-dim mb-2">Reading file metadata…</p>}
    {msgs.map((m, i) => <p key={i} role="alert" className="text-sm bg-pane border border-line rounded-xl p-3 mb-2" onClick={() => setMsgs(x => x.filter((_, j) => j !== i))}>{m}</p>)}
    {editing && <MetaForm key={editing.id} w={editing} onSave={m => saveEdits(editing, m)} onCancel={() => setEditing(null)} />}

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
        {showF && <FilterPanel f={f} setF={setF} works={works} ptags={tags} />}
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

    {open && <Detail w={open} tags={tags} onClose={() => setOpen(null)} update={update} onRemove={async () => { if (confirm('Remove from library? This also removes any copy stored in FicShelf. The original file on your device is not touched.')) { await removeWork(db, open.id!); setOpen(null); reload() } }} onOpenFic={() => openFic(open)} onEdit={() => setEditing(open)} onAddCopy={f => addCopy(open, f)} onDropCopy={() => dropCopy(open)} />}
    {reading && <Reader work={reading.work} blob={reading.blob} title={effective(reading.work).title ?? reading.work.fileName} onClose={() => setReading(null)} onProgress={c => db.works.update(reading.work.id!, { resumeCfi: c })} />}
    <nav className="fixed bottom-0 inset-x-0 bg-pane border-t border-line grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
      {(['home', 'library', 'collections', 'favourites', 'settings'] as Tab[]).map(t => <button key={t} aria-current={tab === t} onClick={() => setTab(t)} className={`min-h-14 capitalize text-sm ${tab === t ? 'text-acc' : 'text-dim'}`}>{t}</button>)}</nav>
  </div>
}
function diff(a: Meta, b: Meta): Meta { const o: any = {}; for (const k of Object.keys(b)) if (JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k])) o[k] = (b as any)[k]; return o }
const csv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
function MetaForm({ w, onSave, onCancel }: { w: Work; onSave: (m: Meta) => void; onCancel: () => void }) {
  const [m, setM] = useState<Meta>({ ...w.original, ...w.edits })
  const L = (label: string, k: keyof Meta, list = false, number = false) => <label className="block text-sm">{label} <span className="text-dim">{k in w.edits ? '(edited)' : w.original[k] !== undefined ? '(from file)' : ''}</span>
    <input className={inp} inputMode={number ? 'numeric' : undefined} value={list ? ((m[k] as string[]) ?? []).join(', ') : (m[k] as any) ?? ''}
      onChange={e => setM({ ...m, [k]: number ? (e.target.value ? Number(e.target.value) : undefined) : list ? csv(e.target.value) : e.target.value || undefined })} /></label>
  return <div role="dialog" aria-label="Edit metadata" className="fixed inset-0 z-40 bg-ink overflow-auto p-4"><div className="max-w-2xl mx-auto grid gap-3">
    <h2 className="font-serif text-2xl">Edit details</h2><p className="text-dim text-sm">Your edits are kept separately. The values read from the file are never overwritten.</p>
    {L('Title', 'title')}{L('Author', 'author')}{L('Fandoms (comma separated)', 'fandoms', true)}{L('Relationships', 'relationships', true)}{L('Characters', 'characters', true)}{L('Rating', 'rating')}{L('Archive warnings', 'warnings', true)}{L('Additional tags', 'tags', true)}{L('Word count', 'words', false, true)}{L('Chapters', 'chapters', false, true)}{L('Source URL', 'sourceUrl')}
    <label className="block text-sm">Completion<select className={inp} value={m.complete === undefined ? '' : m.complete ? 'y' : 'n'} onChange={e => setM({ ...m, complete: e.target.value === '' ? undefined : e.target.value === 'y' })}><option value="">Unknown</option><option value="y">Complete</option><option value="n">In progress</option></select></label>
    <div className="flex flex-wrap gap-2"><button className={btn} onClick={() => onSave(m)}>Save</button><button className={ghost} onClick={onCancel}>Cancel</button>
      <button className={ghost} onClick={() => confirm('Discard your edits and use the values read from the file?') && onSave({ ...w.original })}>Reset to file values</button></div></div></div>
}
function Chips({ opts, on, toggle }: { opts: string[]; on: string[]; toggle: (x: string) => void }) {
  return <div className="flex flex-wrap gap-2">{opts.map(o => <button key={o} aria-pressed={on.includes(o)} onClick={() => toggle(o)} className={`px-3 min-h-10 rounded-full text-sm ${on.includes(o) ? 'bg-acc text-ink' : 'bg-line'}`}>{o}</button>)}</div> }
/** Typeable dropdown: filters as you type, shows how many fics use each value, multi-select with removable chips. */
function Combo({ label, options, selected, onChange }: { label: string; options: [string, number][]; selected: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState(''); const [focus, setFocus] = useState(false)
  const nq = norm(q), hits = options.filter(([o]) => !selected.includes(o) && (!nq || norm(o).includes(nq)))
  return <div><label className="block text-sm font-medium">{label}
      <input role="combobox" aria-expanded={focus} aria-label={label} className={inp + ' mt-1'} value={q} placeholder={`Type to search ${options.length} option${options.length === 1 ? '' : 's'}`} autoComplete="off"
        onChange={e => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} /></label>
    {focus && <ul role="listbox" className="max-h-52 overflow-auto rounded-xl border border-line bg-ink mt-1">
      {hits.slice(0, 40).map(([o, c]) => <li key={o}><button className="w-full text-left px-3 min-h-11" onMouseDown={e => e.preventDefault()} onClick={() => { onChange([...selected, o]); setQ('') }}>{o} <span className="text-dim text-sm">({c})</span></button></li>)}
      {!hits.length && <li className="px-3 py-3 text-dim text-sm">{options.length ? 'No matches' : 'Nothing to choose from yet'}</li>}
      {hits.length > 40 && <li className="px-3 py-2 text-dim text-xs">Showing 40 of {hits.length}. Keep typing to narrow.</li>}</ul>}
    {selected.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{selected.map(x => <button key={x} className="px-3 min-h-9 rounded-full bg-acc text-ink text-sm" onClick={() => onChange(selected.filter(y => y !== x))}>{x} ✕</button>)}</div>}</div>
}
function FilterPanel({ f, setF, works, ptags }: { f: Filter; setF: (f: Filter) => void; works: Work[]; ptags: PTag[] }) {
  const tg = (arr: string[], x: string) => arr.includes(x) ? arr.filter(y => y !== x) : [...arr, x]
  const n = (v: string) => v ? Number(v) : undefined
  const O = useMemo(() => {
    const tally = (get: (m: Meta) => string[] | string | undefined) => { const c = new Map<string, number>(); for (const w of works) for (const x of ([] as string[]).concat(get(effective(w)) ?? [])) c.set(x, (c.get(x) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) }
    return { fandoms: tally(m => m.fandoms), authors: tally(m => m.author), rels: tally(m => m.relationships), chars: tally(m => m.characters), tags: tally(m => m.tags),
      mine: ptags.map(t => [t.name, works.filter(w => w.personalTagIds.includes(t.id!)).length] as [string, number]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) }
  }, [works, ptags])
  const ids = (names: string[]) => names.map(x => ptags.find(t => t.name === x)?.id).filter((x): x is number => x !== undefined)
  const nm = (idl: number[]) => idl.map(i => ptags.find(t => t.id === i)?.name).filter((x): x is string => !!x)
  const ex = f.exclude, setEx = (p: Partial<Filter['exclude']>) => setF({ ...f, exclude: { ...ex, ...p } })
  return <div className="bg-pane border border-line rounded-2xl p-3 grid gap-4 mb-2">
    <p className="text-dim text-xs">Choices inside one box match any of them. Different boxes must all match. Required tags must all be present. Excluded values hide a fic if any is present. Boxes list values already in your library.</p>
    <Combo label="Fandom" options={O.fandoms} selected={f.fandoms} onChange={v => setF({ ...f, fandoms: v })} />
    <Combo label="Author" options={O.authors} selected={f.authors} onChange={v => setF({ ...f, authors: v })} />
    <Combo label="Relationship" options={O.rels} selected={f.relationships} onChange={v => setF({ ...f, relationships: v })} />
    <Combo label="Character" options={O.chars} selected={f.characters} onChange={v => setF({ ...f, characters: v })} />
    <Combo label="Require original tags (all)" options={O.tags} selected={f.tags} onChange={v => setF({ ...f, tags: v })} />
    <Combo label="My tags (all)" options={O.mine} selected={nm(f.personalTagIds)} onChange={v => setF({ ...f, personalTagIds: ids(v) })} />
    <b>Exclude</b>
    <Combo label="Exclude original tags" options={O.tags} selected={ex.tags} onChange={v => setEx({ tags: v })} />
    <Combo label="Exclude characters" options={O.chars} selected={ex.characters} onChange={v => setEx({ characters: v })} />
    <Combo label="Exclude relationships" options={O.rels} selected={ex.relationships} onChange={v => setEx({ relationships: v })} />
    <Combo label="Exclude my tags" options={O.mine} selected={nm(ex.personalTagIds)} onChange={v => setEx({ personalTagIds: ids(v) })} />
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
function Detail({ w, tags, onClose, update, onRemove, onOpenFic, onEdit, onAddCopy, onDropCopy }: { w: Work; tags: PTag[]; onClose: () => void; update: (w: Work, p: Partial<Work>) => void; onRemove: () => void; onOpenFic: () => void; onEdit: () => void; onAddCopy: (f: File | undefined) => void; onDropCopy: () => void }) {
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
    <button className={ghost + ' justify-self-start'} onClick={onEdit}>Edit metadata</button>
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
  const [hdr, setHdr] = useState(pdfHeaderEnabled()); const [store, setStore] = useState(autoStoreEnabled())
  return <section className="grid gap-1"><h2 className="font-serif text-xl mt-4">Import options</h2>
    <p className="text-dim text-sm">Imports save straight to your library using whatever metadata was found. Open a fic and tap Edit metadata to fix or add details.</p>
    <label className="flex items-start gap-2 min-h-10"><input type="checkbox" className="mt-1" checked={hdr} onChange={e => { setHdr(e.target.checked); setPdfHeaderEnabled(e.target.checked) }} />
      <span>Read the labelled header on a PDF's first page (Fandom, Rating, Stats and similar lines)</span></label>
    <p className="text-dim text-sm">Done on your device with no AI. Only the header lines are kept and the page text is discarded. Nothing after the Stats line and no other page is read.</p>
    <label className="flex items-start gap-2 min-h-10"><input type="checkbox" className="mt-1" checked={store} onChange={e => { setStore(e.target.checked); setAutoStoreEnabled(e.target.checked) }} />
      <span>Store a copy of imported EPUB and PDF files inside FicShelf</span></label>
    <p className="text-dim text-sm">Off by default. Lets you open files here, but uses browser storage that can be cleared. Files that don't fit are added as metadata only.</p></section>
}
