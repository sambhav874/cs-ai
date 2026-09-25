/**
 * The original PDF, opened at a cited passage with the passage highlighted.
 *
 * A verified citation links to /contracts/:id?page=N&quote=…. The browser's
 * own viewer (the iframe the page uses otherwise) can open a page but cannot
 * mark text, so the reader landed on the right page and had to find the
 * sentence. This renders the document with pdf.js, finds the quote in the
 * page's text (whitespace, case, quote and dash style ignored — the same
 * normalisation the citation check uses), and draws a highlight over it.
 *
 * pdf.js is the bundled 4.10 build (`pdfjs-v4`) with its worker bundled
 * beside it, so nothing is fetched from a CDN. If it cannot load the file the
 * caller falls back to the browser viewer.
 */
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-v4'
import { Loader2 } from 'lucide-react'

type PdfJs = typeof import('pdfjs-v4')
let pdfjs: Promise<PdfJs> | null = null
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-v4').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-v4/build/pdf.worker.min.mjs', import.meta.url).toString()
    return lib
  })
  return pdfjs
}

/** Lower-case, one space, straight quotes, plain hyphens — per character, so offsets map back. */
function normChar(c: string): string {
  if (/\s/.test(c)) return ' '
  if ('‘’‚‛′'.includes(c)) return "'"
  if ('“”„‟″'.includes(c)) return '"'
  if ('‐‑‒–—―−'.includes(c)) return '-'
  return c.toLowerCase()
}

export function normalizeQuote(q: string): string {
  return Array.from(q).map(normChar).join('').replace(/ +/g, ' ').trim()
}

interface TextItem { str: string; transform: number[]; width: number; height: number }

/**
 * Where `quote` sits in a page's text items: [item index, char offset] for
 * its start and end, or null. Items are joined with a space (pdf.js splits
 * lines and runs into separate items), and runs of spaces are collapsed as
 * the quote's are, keeping a map from each normalised character back to its
 * item and offset.
 */
export function locateInItems(items: TextItem[], quote: string): { start: [number, number]; end: [number, number] } | null {
  const needle = normalizeQuote(quote)
  if (!needle) return null
  let text = ''
  const map: Array<[number, number]> = []
  items.forEach((item, i) => {
    const chars = Array.from(item.str)
    chars.forEach((c, j) => {
      const n = normChar(c)
      if (n === ' ' && text.endsWith(' ')) return
      text += n
      map.push([i, j])
    })
    if (!text.endsWith(' ')) { text += ' '; map.push([i, chars.length]) }
  })
  const at = text.indexOf(needle)
  if (at < 0) return null
  return { start: map[at], end: map[at + needle.length - 1] }
}

interface Rect { left: number; top: number; width: number; height: number }

let measureCtx: CanvasRenderingContext2D | null = null
/** How much of `whole`'s rendered width `prefix` takes, in a proportional sans font. */
function widthShare(whole: string, prefix: string): number {
  if (!prefix) return 0
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return prefix.length / Math.max(1, whole.length)
  measureCtx.font = '100px Helvetica, Arial, sans-serif'
  const total = measureCtx.measureText(whole).width
  return total ? Math.min(1, measureCtx.measureText(prefix).width / total) : 0
}

function highlightRects(lib: PdfJs, page: PDFPageProxy, items: TextItem[], hit: NonNullable<ReturnType<typeof locateInItems>>, scale: number): Rect[] {
  const viewport = page.getViewport({ scale })
  const rects: Rect[] = []
  for (let i = hit.start[0]; i <= hit.end[0]; i++) {
    const item = items[i]
    if (!item || !item.str.trim()) continue
    const tx = lib.Util.transform(viewport.transform, item.transform)
    const height = Math.hypot(tx[2], tx[3])
    const width = item.width * scale
    // The first and last items are cut to the quoted characters, by measured
    // width (a proportional font), not character count.
    const chars = Array.from(item.str)
    const from = i === hit.start[0] ? widthShare(item.str, chars.slice(0, hit.start[1]).join('')) : 0
    const to = i === hit.end[0] ? widthShare(item.str, chars.slice(0, hit.end[1] + 1).join('')) : 1
    rects.push({ left: tx[4] + width * from, top: tx[5] - height, width: Math.max(2, width * (to - from)), height: height * 1.15 })
  }
  return rects
}

interface PageView { number: number; width: number; height: number }

export function PdfQuoteViewer({ url, page, quote, onFail }: { url: string; page: number | null; quote: string; onFail: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  // Page sizes at scale 1; the scale fits the widest page to the container.
  const [sizes, setSizes] = useState<Array<{ width: number; height: number }>>([])
  const [width, setWidth] = useState(0)
  const [found, setFound] = useState<{ page: number; rects: Rect[] } | null | 'missing'>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Load the document and read every page's size.
  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    ;(async () => {
      try {
        const lib = await loadPdfJs()
        loaded = await lib.getDocument({ url, isEvalSupported: false }).promise
        const out: Array<{ width: number; height: number }> = []
        for (let n = 1; n <= loaded.numPages; n++) {
          const v = (await loaded.getPage(n)).getViewport({ scale: 1 })
          out.push({ width: v.width, height: v.height })
        }
        if (cancelled) return
        setSizes(out)
        setDoc(loaded)
      } catch {
        if (!cancelled) onFail()
      }
    })()
    return () => { cancelled = true; void loaded?.destroy() }
  }, [url, onFail])

  const widest = sizes.reduce((m, p) => Math.max(m, p.width), 0)
  // Quantised so a resize by a pixel does not re-render every page.
  const scale = widest && width ? Math.round(Math.min(2, Math.max(0.5, (width - 32) / widest)) * 20) / 20 : 0
  const pages: PageView[] = scale ? sizes.map((p, i) => ({ number: i + 1, width: p.width * scale, height: p.height * scale })) : []

  // Find the quote: the cited page first, then its neighbours, then the rest.
  useEffect(() => {
    if (!doc || !scale) return
    let cancelled = false
    ;(async () => {
      const lib = await loadPdfJs()
      const order = page ? [page, page + 1, page - 1] : []
      for (let n = 1; n <= doc.numPages; n++) if (!order.includes(n)) order.push(n)
      for (const n of order) {
        if (n < 1 || n > doc.numPages) continue
        const p = await doc.getPage(n)
        const items: TextItem[] = (await p.getTextContent()).items.flatMap(it => ('str' in it ? [it] : []))
        const hit = locateInItems(items, quote)
        if (hit) {
          if (!cancelled) setFound({ page: n, rects: highlightRects(lib, p, items, hit, scale) })
          return
        }
      }
      if (!cancelled) setFound('missing')
    })()
    return () => { cancelled = true }
  }, [doc, page, quote, scale])

  // Bring the passage (or the cited page, if the text layer has no match) into view.
  useEffect(() => {
    const target = found && found !== 'missing' ? found.page : page
    if (!target || !pages.length) return
    const box = scrollRef.current
    const el = box?.querySelector<HTMLElement>(`[data-page="${target}"]`)
    if (!box || !el) return
    const pageTop = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    const offset = found && found !== 'missing' && found.rects[0] ? Math.max(0, found.rects[0].top - 120) : 0
    box.scrollTo({ top: pageTop + offset, behavior: 'smooth' })
  }, [found, page, pages.length])

  return (
    <div className="h-full flex flex-col" data-testid="pdf-quote-viewer">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-200 bg-card text-dense">
        {found === null && <><Loader2 className="size-3.5 animate-spin text-fg-400" /><span className="text-fg-500">Finding the cited passage…</span></>}
        {found && found !== 'missing' && <span className="text-fg-700">Cited passage highlighted on page {found.page}</span>}
        {found === 'missing' && <span className="text-fg-500">The quote could not be located in this file's text layer{page ? `; showing page ${page}` : ''}.</span>}
        <a href={page ? `${url}#page=${page}` : url} target="_blank" rel="noopener noreferrer" className="ml-auto text-fg-700 hover:text-primary-700 underline underline-offset-2">
          Open in browser viewer
        </a>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto bg-surface-50 p-4">
        {(!doc || !scale) && <div className="flex items-center justify-center h-64"><Loader2 className="size-6 animate-spin text-fg-400" /></div>}
        {doc && pages.map(p => (
          <PageCanvas key={p.number} doc={doc} view={p} scale={scale}
            rects={found && found !== 'missing' && found.page === p.number ? found.rects : []} />
        ))}
      </div>
    </div>
  )
}

/** One page, rendered when it scrolls near the viewport. */
function PageCanvas({ doc, view, scale, rects }: { doc: PDFDocumentProxy; view: PageView; scale: number; rects: Rect[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let task: { cancel: () => void } | null = null
    ;(async () => {
      const page = await doc.getPage(view.number)
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: scale * ratio })
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const render = page.render({ canvasContext: ctx, viewport })
      task = render
      await render.promise.catch(() => undefined)
    })()
    return () => task?.cancel()
  }, [visible, doc, view.number, scale])

  return (
    <div ref={wrapRef} data-page={view.number} className="relative mx-auto mb-3 bg-white shadow-page"
         style={{ width: view.width, height: view.height }}>
      <canvas ref={canvasRef} style={{ width: view.width, height: view.height }} />
      {rects.map((r, i) => (
        <div key={i} data-testid="pdf-quote-highlight" className="absolute rounded-[2px] bg-attention-200/70 mix-blend-multiply ring-1 ring-attention-600/40 pointer-events-none"
             style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
      ))}
    </div>
  )
}
