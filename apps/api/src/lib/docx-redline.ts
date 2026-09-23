/**
 * Tracked changes written into the counterparty's own Word file.
 *
 * The version-to-version export (docx-export.ts) rebuilds a document from the
 * app's HTML, so the file that goes back to the counterparty is ours, not
 * theirs: their numbering, styles, headers, footers and page setup are gone,
 * and a lawyer notices on the first page. When the base of a redline is an
 * uploaded .docx, this instead edits that file: every paragraph nobody
 * changed is left byte-for-byte as it was, and each change becomes a native
 * <w:ins>/<w:del> revision on the paragraph it belongs to, so Word's own
 * Accept/Reject works and the paragraph keeps its style and numbering.
 *
 * How it lines up the three texts:
 *   1. The .docx paragraphs are matched to the base HTML (what the Styled view
 *      was converted from) by text, in order.
 *   2. The base HTML's blocks are matched to the new HTML's blocks: equal
 *      text anchors; between anchors, similar blocks pair up as edits, the
 *      rest are insertions and deletions.
 *   3. An edited paragraph is diffed word by word against its own .docx text,
 *      and the runs are rewritten with the original run formatting carried
 *      through for every character that survives.
 *
 * Paragraphs holding fields, drawings or other structures this does not
 * rewrite are revised whole — old text deleted, new text inserted — rather
 * than risk corrupting them.
 */
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

// xmldom implements the DOM Level 2 core; the standard DOM types describe it.
type XDoc = Document
type XEl = Element

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

export interface RevisionOptions {
  author: string
  /** ISO timestamp, no milliseconds (Word's w:date). */
  date:   string
}

export interface DocxRedlineStats {
  paragraphsEdited:   number
  paragraphsInserted: number
  paragraphsDeleted:  number
  /** Base blocks that could not be found in the .docx; their edits are missing. */
  unmatched:          number
}

// ── Text ─────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Comparison key: whitespace collapsed, quotes and dashes folded, case kept. */
export function normalise(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
}

/**
 * The text of each block-level element of an HTML document, in order. A block
 * is the innermost of p, h1–h6, li, td/th (cells without inner paragraphs) and
 * pre. Empty blocks are dropped, as mammoth drops empty paragraphs.
 */
export function htmlBlocks(html: string): string[] {
  return htmlBlockParts(html).map(b => b.text)
}

/** Each block's text and its inner HTML (for the inline bold/italic/underline of new paragraphs). */
export function htmlBlockParts(html: string): Array<{ text: string; inner: string }> {
  const out: Array<{ text: string; inner: string }> = []
  const re = /<(p|h[1-6]|li|td|th|pre|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi
  const inner = (s: string) => /<(p|h[1-6]|li|td|th|pre)\b/i.test(s)
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const body = m[2]
    if (inner(body)) { re.lastIndex = m.index + m[0].indexOf('>') + 1; continue }
    const text = decodeEntities(body.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    if (normalise(text)) out.push({ text: text.replace(/[\s\u00a0]+/g, ' ').trim(), inner: body })
  }
  return out
}

export interface InlineRun { text: string; b: boolean; i: boolean; u: boolean }

/** Inline HTML as runs with bold / italic / underline, the formatting an editor can add. */
export function inlineRuns(inner: string): InlineRun[] {
  const runs: InlineRun[] = []
  const state = { b: 0, i: 0, u: 0 }
  const re = /<(\/?)(strong|b|em|i|u)\b[^>]*>|<br\s*\/?>|<[^>]+>|([^<]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) {
    if (m[3] != null) {
      const text = decodeEntities(m[3]).replace(/[\s\u00a0]+/g, ' ')
      if (!text) continue
      const run = { text, b: state.b > 0, i: state.i > 0, u: state.u > 0 }
      const last = runs[runs.length - 1]
      if (last && last.b === run.b && last.i === run.i && last.u === run.u) last.text += text
      else runs.push(run)
    } else if (m[2]) {
      const tag = m[2].toLowerCase()
      const key = tag === 'strong' || tag === 'b' ? 'b' : tag === 'em' || tag === 'i' ? 'i' : 'u'
      state[key] = Math.max(0, state[key] + (m[1] ? -1 : 1))
    } else if (/^<br/i.test(m[0])) {
      runs.push({ text: ' ', b: state.b > 0, i: state.i > 0, u: state.u > 0 })
    }
  }
  if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '') }
  return runs.filter(r => r.text)
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export type Op = { op: 'eq' | 'del' | 'ins'; a?: number; b?: number }

/** LCS alignment of two sequences under an equality test. O(n·m); contracts are small. */
export function align<A, B = A>(a: A[], b: B[], eq: (x: A, y: B) => boolean): Op[] {
  const n = a.length, m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Op[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { ops.push({ op: 'eq', a: i++, b: j++ }) }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ op: 'del', a: i++ })
    else ops.push({ op: 'ins', b: j++ })
  }
  while (i < n) ops.push({ op: 'del', a: i++ })
  while (j < m) ops.push({ op: 'ins', b: j++ })
  return ops
}

/** Words and the whitespace between them, so a diff keeps the spacing. */
function tokens(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? []
}

export interface Segment { kind: 'eq' | 'del' | 'ins'; text: string }

/** Word-level diff of two strings, merged into runs of the same kind. */
export function wordDiff(oldText: string, newText: string): Segment[] {
  const a = tokens(oldText), b = tokens(newText)
  const segs: Segment[] = []
  const push = (kind: Segment['kind'], text: string) => {
    const last = segs[segs.length - 1]
    if (last && last.kind === kind) last.text += text
    else segs.push({ kind, text })
  }
  for (const o of align(a, b, (x, y) => (x.trim() === '' && y.trim() === '') || normalise(x) === normalise(y))) {
    if (o.op === 'eq') push('eq', a[o.a!])
    else if (o.op === 'del') push('del', a[o.a!])
    else push('ins', b[o.b!])
  }
  return tidy(segs)
}

/**
 * Whitespace the two texts happen to share inside a change ("thirty (30)" →
 * "sixty (60)") belongs to the change: left as equal, it split one edit into
 * several and Word showed a stutter of deletions and insertions. Within each
 * change the deletion comes before the insertion, as Word writes them.
 */
function tidy(segs: Segment[]): Segment[] {
  const flat: Segment[] = []
  segs.forEach((s, i) => {
    const between = s.kind === 'eq' && !s.text.trim() && i > 0 && i < segs.length - 1
      && segs[i - 1].kind !== 'eq' && segs[i + 1].kind !== 'eq'
    if (between) { flat.push({ kind: 'del', text: s.text }, { kind: 'ins', text: s.text }) }
    else flat.push({ ...s })
  })
  const out: Segment[] = []
  let del = '', ins = ''
  const flush = () => {
    if (del) out.push({ kind: 'del', text: del })
    if (ins) out.push({ kind: 'ins', text: ins })
    del = ''; ins = ''
  }
  for (const s of flat) {
    if (s.kind === 'del') del += s.text
    else if (s.kind === 'ins') ins += s.text
    else { flush(); out.push(s) }
  }
  flush()
  return out
}

function similarity(x: string, y: string): number {
  const a = new Set(normalise(x).toLowerCase().split(' ')), b = new Set(normalise(y).toLowerCase().split(' '))
  if (!a.size || !b.size) return 0
  let common = 0
  for (const t of a) if (b.has(t)) common++
  return (2 * common) / (a.size + b.size)
}

export type BlockChange =
  | { kind: 'same';   base: number; next: number }
  | { kind: 'edit';   base: number; next: number }
  | { kind: 'delete'; base: number }
  | { kind: 'insert'; next: number; after: number | null }   // after: base index it follows

/** Line up base blocks with new blocks: anchors, edits, insertions, deletions. */
export function blockChanges(base: string[], next: string[]): BlockChange[] {
  const ops = align(base, next, (x, y) => normalise(x) === normalise(y))
  const out: BlockChange[] = []
  let lastBase: number | null = null
  let i = 0
  while (i < ops.length) {
    if (ops[i].op === 'eq') {
      out.push({ kind: 'same', base: ops[i].a!, next: ops[i].b! })
      lastBase = ops[i].a!
      i++
      continue
    }
    // A run of dels and ins between anchors: pair similar ones as edits.
    const dels: number[] = [], inss: number[] = []
    while (i < ops.length && ops[i].op !== 'eq') {
      if (ops[i].op === 'del') dels.push(ops[i].a!)
      else inss.push(ops[i].b!)
      i++
    }
    let d = 0
    for (const n of inss) {
      // Pair with the next unpaired deletion if they read alike; deletions
      // skipped on the way are deletions.
      let paired = false
      for (let k = d; k < dels.length; k++) {
        if (similarity(base[dels[k]], next[n]) >= 0.5) {
          for (; d < k; d++) out.push({ kind: 'delete', base: dels[d] })
          out.push({ kind: 'edit', base: dels[k], next: n })
          lastBase = dels[k]
          d = k + 1
          paired = true
          break
        }
      }
      if (!paired) out.push({ kind: 'insert', next: n, after: lastBase })
    }
    for (; d < dels.length; d++) { out.push({ kind: 'delete', base: dels[d] }); lastBase = dels[d] }
  }
  return out
}

// ── Word XML ─────────────────────────────────────────────────────────────────

function kids(el: XEl): XEl[] {
  const out: XEl[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as XEl)
  return out
}

function isW(el: XEl, local: string): boolean {
  return el.namespaceURI === W && el.localName === local
}

/** Body paragraphs in reading order, tables included; not those inside text boxes or revisions. */
function bodyParagraphs(doc: XDoc): XEl[] {
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  const out: XEl[] = []
  const walk = (el: XEl) => {
    for (const c of kids(el)) {
      if (isW(c, 'p')) out.push(c)
      else if (isW(c, 'tbl') || isW(c, 'tr') || isW(c, 'tc') || isW(c, 'sdt') || isW(c, 'sdtContent') || isW(c, 'customXml')) walk(c)
    }
  }
  if (body) walk(body)
  return out
}

const SIMPLE_RUN_CHILDREN = new Set(['rPr', 't', 'tab', 'br', 'noBreakHyphen', 'softHyphen', 'lastRenderedPageBreak'])
const SIMPLE_PARA_CHILDREN = new Set(['pPr', 'r', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'permStart', 'permEnd'])

interface RunPiece { rPr: XEl | null; text: string }

/** The paragraph's visible text as pieces carrying their run formatting; null if it holds more than text. */
function readRuns(p: XEl): RunPiece[] | null {
  const pieces: RunPiece[] = []
  for (const c of kids(p)) {
    if (c.namespaceURI !== W || !SIMPLE_PARA_CHILDREN.has(c.localName ?? '')) return null
    if (!isW(c, 'r')) continue
    let rPr: XEl | null = null
    let text = ''
    for (const rc of kids(c)) {
      if (rc.namespaceURI !== W || !SIMPLE_RUN_CHILDREN.has(rc.localName ?? '')) return null
      if (isW(rc, 'rPr')) rPr = rc
      else if (isW(rc, 't')) text += rc.textContent ?? ''
      else if (isW(rc, 'tab')) text += '\t'
      else if (isW(rc, 'br')) text += ' '
      else if (isW(rc, 'noBreakHyphen')) text += '-'
    }
    if (text) pieces.push({ rPr, text })
  }
  return pieces
}

function paragraphText(p: XEl): string {
  let text = ''
  const walk = (el: XEl) => {
    for (const c of kids(el)) {
      if (isW(c, 'del') || isW(c, 'moveFrom')) continue
      if (isW(c, 't')) text += c.textContent ?? ''
      else if (isW(c, 'tab')) text += '\t'
      else if (isW(c, 'br')) text += ' '
      else walk(c)
    }
  }
  walk(p)
  return text
}

class Writer {
  private id = 0
  constructor(private doc: XDoc, private rev: RevisionOptions) {
    // Revision ids must be unique in the document; start above any in use.
    const used = [...Array.from(doc.getElementsByTagNameNS(W, 'ins')), ...Array.from(doc.getElementsByTagNameNS(W, 'del'))]
      .map(e => Number(e.getAttributeNS(W, 'id')) || 0)
    this.id = Math.max(1000, ...used) + 1
  }

  el(local: string): XEl {
    return this.doc.createElementNS(W, `w:${local}`)
  }

  mark(local: 'ins' | 'del'): XEl {
    const m = this.el(local)
    m.setAttributeNS(W, 'w:id', String(this.id++))
    m.setAttributeNS(W, 'w:author', this.rev.author)
    m.setAttributeNS(W, 'w:date', this.rev.date)
    return m
  }

  run(text: string, rPr: XEl | null, deleted: boolean): XEl {
    const r = this.el('r')
    if (rPr) r.appendChild(rPr.cloneNode(true))
    // Tabs are their own element; keep them so Word renders them as tabs.
    text.split('\t').forEach((part, i) => {
      if (i > 0) r.appendChild(this.el('tab'))
      if (!part) return
      const t = this.el(deleted ? 'delText' : 't')
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      t.appendChild(this.doc.createTextNode(part))
      r.appendChild(t)
    })
    return r
  }

  wrap(kind: 'ins' | 'del', runs: XEl[]): XEl {
    const m = this.mark(kind)
    for (const r of runs) m.appendChild(r)
    return m
  }

  /** Mark the paragraph's own mark (its end) as inserted or deleted. */
  markParagraph(p: XEl, kind: 'ins' | 'del'): void {
    let pPr = kids(p).find(c => isW(c, 'pPr'))
    if (!pPr) { pPr = this.el('pPr'); p.insertBefore(pPr, p.firstChild) }
    let rPr = kids(pPr).find(c => isW(c, 'rPr'))
    if (!rPr) { rPr = this.el('rPr'); pPr.appendChild(rPr) }
    rPr.insertBefore(this.mark(kind), rPr.firstChild)
  }
}

/**
 * The paragraph's body formatting: the run properties carrying the most text.
 * A clause that opens with a bold title ("Term.") is mostly plain text, and a
 * new clause should read like the body, not like the title.
 */
function bodyRPr(pieces: RunPiece[]): XEl | null {
  const weight = new Map<XEl | null, number>()
  for (const p of pieces) weight.set(p.rPr, (weight.get(p.rPr) ?? 0) + p.text.length)
  let best: XEl | null = null, most = -1
  for (const [rPr, n] of weight) if (n > most) { best = rPr; most = n }
  return best
}

/** Copy of run properties with bold / italic / underline switched as the edit says. */
function styled(w: Writer, base: XEl | null, run: InlineRun): XEl | null {
  const rPr = (base ? base.cloneNode(true) : w.el('rPr')) as XEl
  for (const [on, local] of [[run.b, 'b'], [run.i, 'i'], [run.u, 'u']] as const) {
    for (const k of kids(rPr).filter(c => isW(c, local) || isW(c, `${local}Cs`))) rPr.removeChild(k)
    if (on) {
      const el = w.el(local)
      if (local === 'u') el.setAttributeNS(W, 'w:val', 'single')
      rPr.appendChild(el)
    }
  }
  return kids(rPr).length ? rPr : null
}

/** Formatting at a character offset: the run that holds it. */
function rPrAt(pieces: RunPiece[], offset: number): XEl | null {
  let pos = 0
  for (const p of pieces) {
    if (offset < pos + p.text.length) return p.rPr
    pos += p.text.length
  }
  return pieces[pieces.length - 1]?.rPr ?? null
}

/** Slice [from, to) of the paragraph text back into pieces, each with its own run formatting. */
function slicePieces(pieces: RunPiece[], from: number, to: number): RunPiece[] {
  const out: RunPiece[] = []
  let pos = 0
  for (const p of pieces) {
    const s = Math.max(from, pos), e = Math.min(to, pos + p.text.length)
    if (s < e) out.push({ rPr: p.rPr, text: p.text.slice(s - pos, e - pos) })
    pos += p.text.length
  }
  return out
}

function removeRuns(p: XEl): XEl[] {
  const removed: XEl[] = []
  for (const c of kids(p)) {
    if (isW(c, 'pPr')) continue
    removed.push(c)
    p.removeChild(c)
  }
  return removed
}

/** Rewrite one paragraph's text as tracked changes from its current text to `next`. */
function editParagraph(w: Writer, p: XEl, next: string): void {
  const pieces = readRuns(p)
  if (!pieces) {
    // Not plain text: revise it whole rather than rebuild what we do not model.
    const old = removeRuns(p)
    const firstRPr = old.map(c => (isW(c, 'r') ? kids(c).find(k => isW(k, 'rPr')) ?? null : null)).find(Boolean) ?? null
    const del = w.mark('del')
    for (const c of old) {
      if (isW(c, 'r')) {
        for (const t of kids(c)) {
          if (isW(t, 't')) {
            const dt = w.el('delText')
            dt.setAttributeNS(XML_NS, 'xml:space', 'preserve')
            dt.appendChild(t.ownerDocument!.createTextNode(t.textContent ?? ''))
            c.replaceChild(dt, t)
          }
        }
        del.appendChild(c)
      } else {
        p.appendChild(c) // bookmarks, fields and the like stay where they were
      }
    }
    if (del.firstChild) p.appendChild(del)
    p.appendChild(w.wrap('ins', [w.run(next, firstRPr, false)]))
    return
  }

  const oldText = pieces.map(x => x.text).join('')
  const segs = wordDiff(oldText, next)
  removeRuns(p)
  let at = 0 // offset into oldText
  for (const s of segs) {
    if (s.kind === 'ins') {
      p.appendChild(w.wrap('ins', [w.run(s.text, rPrAt(pieces, Math.max(0, at - 1)), false)]))
      continue
    }
    const part = slicePieces(pieces, at, at + s.text.length)
    at += s.text.length
    if (s.kind === 'eq') for (const x of part) p.appendChild(w.run(x.text, x.rPr, false))
    else p.appendChild(w.wrap('del', part.map(x => w.run(x.text, x.rPr, true))))
  }
}

function deleteParagraph(w: Writer, p: XEl): void {
  const runs = removeRuns(p)
  const del = w.mark('del')
  for (const c of runs) {
    if (!isW(c, 'r')) { p.appendChild(c); continue }
    for (const t of kids(c)) {
      if (isW(t, 't')) {
        const dt = w.el('delText')
        dt.setAttributeNS(XML_NS, 'xml:space', 'preserve')
        dt.appendChild(t.ownerDocument!.createTextNode(t.textContent ?? ''))
        c.replaceChild(dt, t)
      }
    }
    del.appendChild(c)
  }
  if (del.firstChild) p.appendChild(del)
  w.markParagraph(p, 'del')
}

function insertParagraphAfter(w: Writer, anchor: XEl | null, container: XEl, runs: InlineRun[], likeP: XEl | null): XEl {
  const p = w.el('p')
  const pPr = likeP ? kids(likeP).find(c => isW(c, 'pPr')) : null
  if (pPr) {
    const copy = pPr.cloneNode(true) as XEl
    // A copied paragraph mark must not carry the anchor's own revision marks.
    for (const rPr of kids(copy).filter(c => isW(c, 'rPr'))) {
      for (const m of kids(rPr).filter(c => isW(c, 'ins') || isW(c, 'del'))) rPr.removeChild(m)
    }
    p.appendChild(copy)
  }
  const base = likeP ? bodyRPr(readRuns(likeP) ?? []) : null
  p.appendChild(w.wrap('ins', runs.map(r => w.run(r.text, styled(w, base, r), false))))
  w.markParagraph(p, 'ins')
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling)
  else container.insertBefore(p, container.firstChild)
  return p
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function redlineOriginalDocx(args: {
  docx:     Buffer | Uint8Array
  /** The HTML the Styled view was converted from (the upload's version). */
  baseHtml: string
  /** The HTML to redline to. */
  nextHtml: string
  revision: RevisionOptions
}): Promise<{ bytes: Uint8Array; stats: DocxRedlineStats }> {
  const zip = await JSZip.loadAsync(args.docx)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('not_a_docx')
  const xml = await entry.async('string')
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as XDoc

  const paras = bodyParagraphs(doc)
  const withText = paras.filter(p => normalise(paragraphText(p)))
  const base = htmlBlocks(args.baseHtml)
  const nextParts = htmlBlockParts(args.nextHtml)
  const next = nextParts.map(b => b.text)

  // 1. Base blocks ↔ .docx paragraphs, by text.
  const toPara = new Map<number, XEl>()
  for (const o of align(base, withText, (b, p) => normalise(b) === normalise(paragraphText(p)))) {
    if (o.op === 'eq') toPara.set(o.a!, withText[o.b!])
  }

  // 2. Base blocks ↔ new blocks.
  const changes = blockChanges(base, next)

  const w = new Writer(doc, args.revision)
  const body = doc.getElementsByTagNameNS(W, 'body')[0] as XEl
  const stats: DocxRedlineStats = { paragraphsEdited: 0, paragraphsInserted: 0, paragraphsDeleted: 0, unmatched: 0 }
  const insertedAfter = new Map<number | null, XEl>() // keeps consecutive insertions in order

  for (const c of changes) {
    if (c.kind === 'same') continue
    if (c.kind === 'edit') {
      const p = toPara.get(c.base)
      if (!p) { stats.unmatched++; continue }
      editParagraph(w, p, next[c.next])
      stats.paragraphsEdited++
    } else if (c.kind === 'delete') {
      const p = toPara.get(c.base)
      if (!p) { stats.unmatched++; continue }
      deleteParagraph(w, p)
      stats.paragraphsDeleted++
    } else {
      const anchorBase = c.after != null ? toPara.get(c.after) ?? null : null
      if (c.after != null && !anchorBase) { stats.unmatched++; continue }
      const anchor = insertedAfter.get(c.after) ?? anchorBase
      const container = (anchorBase?.parentNode as XEl | null) ?? body
      const runs = inlineRuns(nextParts[c.next].inner)
      const inserted = insertParagraphAfter(w, anchor, container, runs.length ? runs : [{ text: next[c.next], b: false, i: false, u: false }], anchorBase ?? withText[0] ?? null)
      insertedAfter.set(c.after, inserted)
      stats.paragraphsInserted++
    }
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc as never))
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { bytes, stats }
}
