import { useEffect, useRef, useState } from 'react'
import type { Work } from './types'

const btn = 'min-h-12 rounded-xl px-4 bg-acc text-ink font-medium'
const ghost = 'min-h-12 rounded-xl px-4 border border-line text-fg'

/** Hands the file to another app (share sheet) or downloads it. The URL is revoked shortly afterwards. */
export async function saveOrShare(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return } catch (e: any) { if (e?.name === 'AbortError') return } }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (!blob) return; const u = URL.createObjectURL(blob); setUrl(u); return () => { URL.revokeObjectURL(u); setUrl(null) } }, [blob])
  return url
}
const Shell = ({ title, onClose, children, foot }: { title: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode }) =>
  <div role="dialog" aria-label={`Reading ${title}`} className="fixed inset-0 z-30 bg-ink flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
    <div className="flex items-center gap-2 p-2 border-b border-line"><button className={ghost} onClick={onClose}>Close</button><span className="font-serif truncate">{title}</span></div>
    <div className="flex-1 min-h-0 relative">{children}</div>{foot}</div>

export default function Reader({ work, blob, title, onClose, onProgress }: { work: Work; blob: Blob; title: string; onClose: () => void; onProgress: (cfi: string) => void }) {
  return work.format === 'pdf' ? <PdfView blob={blob} name={work.fileName} title={title} onClose={onClose} /> : <EpubView work={work} blob={blob} title={title} onClose={onClose} onProgress={onProgress} />
}
function PdfView({ blob, name, title, onClose }: { blob: Blob; name: string; title: string; onClose: () => void }) {
  const url = useObjectUrl(blob)
  const inline = (navigator as any).pdfViewerEnabled === true
  return <Shell title={title} onClose={onClose}>
    {inline && url ? <iframe title={title} src={url} className="w-full h-full bg-white" /> :
      <div className="p-4 grid gap-3 max-w-md mx-auto"><p>This browser has no built-in PDF viewer (Chrome on Android usually doesn't). Open the stored copy in your PDF app instead.</p>
        <button className={btn} onClick={() => saveOrShare(blob, name)}>Open in another app</button></div>}
  </Shell>
}
function EpubView({ work, blob, title, onClose, onProgress }: { work: Work; blob: Blob; title: string; onClose: () => void; onProgress: (cfi: string) => void }) {
  const host = useRef<HTMLDivElement>(null); const rend = useRef<any>(null)
  const [err, setErr] = useState<string | null>(null); const [ready, setReady] = useState(false)
  useEffect(() => {
    let book: any, dead = false, onResize: () => void
    ;(async () => {
      try {
        const { default: ePub } = await import('epubjs')
        book = ePub(await blob.arrayBuffer())        // opens from memory; scripts inside the book stay disabled
        const r = book.renderTo(host.current!, { width: '100%', height: '100%', flow: 'paginated', spread: 'none' })
        r.themes.default({ body: { color: '#ebe6f0 !important', background: '#17141c !important', 'font-family': 'Georgia, serif !important', 'line-height': '1.6 !important' }, a: { color: '#d08fb0 !important' } })
        r.on('relocated', (l: any) => { const c = l?.start?.cfi; if (c) onProgress(c) })
        rend.current = r
        await r.display(work.resumeCfi || undefined)
        if (!dead) setReady(true)
        onResize = () => r.resize(); window.addEventListener('resize', onResize)
      } catch { if (!dead) setErr('This EPUB could not be opened in the built-in reader.') }
    })()
    return () => { dead = true; if (onResize) window.removeEventListener('resize', onResize); try { rend.current?.destroy(); book?.destroy() } catch {} rend.current = null }
  }, [blob])
  const nav = <div className="grid grid-cols-2 gap-2 p-2 border-t border-line"><button className={ghost} disabled={!ready} onClick={() => rend.current?.prev()}>Previous</button><button className={ghost} disabled={!ready} onClick={() => rend.current?.next()}>Next</button></div>
  return <Shell title={title} onClose={onClose} foot={err ? undefined : nav}>
    {err ? <div className="p-4 grid gap-3 max-w-md mx-auto"><p role="alert">{err}</p><button className={btn} onClick={() => saveOrShare(blob, work.fileName)}>Open in another app</button></div> : <div ref={host} className="absolute inset-0" />}
    {!err && !ready && <p className="absolute inset-0 grid place-items-center text-dim pointer-events-none">Opening…</p>}
  </Shell>
}
