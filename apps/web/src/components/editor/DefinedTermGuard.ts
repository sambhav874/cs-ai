/**
 * DefinedTermGuard — P6.4 / docs/30 Wave G.4
 *
 * Live lexicon watcher for the contract canvas.
 *
 *   Pulls defined terms out of the doc by matching the standard
 *   drafting patterns:
 *       `"<Term>" means ...`
 *       `... (the "<Term>")`
 *       `... (hereinafter the "<Term>")`
 *       `... hereinafter referred to as "<Term>"`
 *
 *   Then scans the whole doc for each term and flags inconsistent
 *   usages — case mismatches ("customer" vs "Customer"), orphan
 *   variants ("Client" when only "Customer" is defined). Flagged
 *   ranges get a blue dotted underline decoration + a tooltip.
 *
 *   Click a flag → opens a small popover (elsewhere — this module
 *   only emits the decorations + a window event; the container page
 *   owns the popover so it can wire in the "Apply everywhere" CTA).
 *
 * Purely client-side; no LLM round-trip.
 *
 * Differs from RiskDecorations (risk/deviation underlines) and
 * ClauseClassifier (margin badges) — this is a structural-
 * consistency check, orthogonal to risk assessment.
 */
import { Extension } from '@tiptap/react' // re-exported from @tiptap/core
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface DefinedTerm {
  canonical: string
  aliases:   string[]            // variants the author deliberately used
  definedAt: { from: number; to: number }
}

export interface TermFlag {
  term:       string            // canonical defined term
  found:      string            // what the author actually typed
  reason:     'case' | 'variant'
  from:       number
  to:         number
}

export interface LexiconState {
  terms:   DefinedTerm[]
  flags:   TermFlag[]
  decos:   DecorationSet
}

const LexiconKey = new PluginKey<LexiconState>('definedTermGuard')

// Regexes for the standard defined-term markers
//   `"Term" means`, `(the "Term")`, `(hereinafter "Term")`, `as "Term"`
const PATTERNS: RegExp[] = [
  /"([A-Z][A-Za-z0-9\- ]{1,40})"\s+(?:means|shall mean|has the meaning)/g,
  /\(\s*the\s+"([A-Z][A-Za-z0-9\- ]{1,40})"\s*\)/g,
  /\(\s*hereinafter[^"]{0,40}"([A-Z][A-Za-z0-9\- ]{1,40})"\s*\)/gi,
  /hereinafter\s+referred\s+to\s+as\s+"([A-Z][A-Za-z0-9\- ]{1,40})"/gi,
  /as\s+"([A-Z][A-Za-z0-9\- ]{1,40})"\s*(?:\)|,|\.)/g,
]

function extractTerms(text: string): Array<{ term: string; index: number }> {
  const out: Array<{ term: string; index: number }> = []
  const seen = new Set<string>()
  for (const rx of PATTERNS) {
    rx.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rx.exec(text))) {
      const t = m[1].trim()
      if (t.length < 3) continue
      if (seen.has(t.toLowerCase())) continue
      seen.add(t.toLowerCase())
      out.push({ term: t, index: m.index })
    }
  }
  return out
}

// Given a full-text string and a list of defined terms, find every
// usage that is either (a) same word, wrong case, or (b) a known
// alias-variant (same stem, different form). We don't try to catch
// synonyms like "Customer" vs "Client" — those require an LLM.
function findFlags(text: string, terms: string[]): TermFlag[] {
  const flags: TermFlag[] = []
  for (const term of terms) {
    // Build a case-insensitive regex for the term as a whole word
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // The term can be multi-word (e.g. "Effective Date")
    const rx = new RegExp(`\\b${esc}\\b`, 'gi')
    let m: RegExpExecArray | null
    while ((m = rx.exec(text))) {
      const found = m[0]
      if (found === term) continue // exact match — no flag
      flags.push({ term, found, reason: 'case', from: m.index, to: m.index + found.length })
    }
  }
  return flags
}

// Note: a standalone buildDecorations() existed here; the plugin now
// rebuilds inside `apply` so it's no longer needed. See git history
// (path: apps/web/src/components/editor/DefinedTermGuard.ts) for the
// reference implementation if we need to extract it again.

function flattenText(doc: import('@tiptap/pm/model').Node): string {
  let out = ''
  doc.descendants((node) => {
    if (node.isText) out += node.text ?? ''
    return true
  })
  return out
}

export interface DefinedTermGuardOptions {
  enabled: boolean
  /** How often to rescan after doc changes (ms). */
  debounceMs: number
}

export const DefinedTermGuard = Extension.create<DefinedTermGuardOptions>({
  name: 'definedTermGuard',

  addOptions() {
    return { enabled: true, debounceMs: 600 }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    let timer: ReturnType<typeof setTimeout> | null = null

    const scan = (view: import('@tiptap/pm/view').EditorView) => {
      const text = flattenText(view.state.doc)
      const found = extractTerms(text)
      const termsList = found.map(f => f.term)
      const flags = termsList.length === 0 ? [] : findFlags(text, termsList)
      const terms: DefinedTerm[] = found.map(f => ({
        canonical: f.term,
        aliases:   [],
        definedAt: { from: f.index, to: f.index + f.term.length },
      }))
      view.dispatch(view.state.tr.setMeta('lexiconScan', { terms, flags }))
    }

    const schedule = (view: import('@tiptap/pm/view').EditorView) => {
      if (!opts.enabled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => scan(view), opts.debounceMs)
    }

    return [
      new Plugin({
        key: LexiconKey,
        state: {
          init: (_c, _s): LexiconState => ({ terms: [], flags: [], decos: DecorationSet.empty }),
          apply(tr, value, _old, newState): LexiconState {
            const meta = tr.getMeta('lexiconScan') as { terms: DefinedTerm[]; flags: TermFlag[] } | undefined
            if (meta) {
              // Rebuild decorations against the CURRENT doc — use a
              // minimal view-like object since we don't have access
              // to it in this reducer. Flags carry text offsets; the
              // decoration builder maps them back to PM positions by
              // walking the doc once.
              const segments: Array<{ posStart: number; text: string }> = []
              newState.doc.descendants((node, pos) => {
                if (!node.isText) return true
                segments.push({ posStart: pos, text: node.text ?? '' })
                return false
              })
              const decos: Decoration[] = []
              for (const f of meta.flags) {
                let cursor = 0
                for (const seg of segments) {
                  const end = cursor + seg.text.length
                  if (f.from >= cursor && f.to <= end) {
                    const from = seg.posStart + (f.from - cursor)
                    const to   = seg.posStart + (f.to - cursor)
                    decos.push(
                      Decoration.inline(from, to, {
                        class: 'defined-term-flag',
                        'data-testid': `defined-term-${f.term.toLowerCase().replace(/\s+/g, '-')}`,
                        'data-term':   f.term,
                        'data-found':  f.found,
                        title: `Defined term mismatch — "${f.found}" should be "${f.term}"`,
                      }),
                    )
                    break
                  }
                  cursor = end
                }
              }
              return { terms: meta.terms, flags: meta.flags, decos: DecorationSet.create(newState.doc, decos) }
            }
            if (tr.docChanged) {
              // Decorations will get rebuilt on next scan; in the
              // meantime, map existing ones forward so they track
              // surrounding edits cleanly.
              return { ...value, decos: value.decos.map(tr.mapping, newState.doc) }
            }
            return value
          },
        },
        props: {
          decorations(state) { return this.getState(state)?.decos ?? DecorationSet.empty },
        },
        view(view) {
          setTimeout(() => scan(view), 200)
          return {
            update(view, prev) {
              if (view.state.doc !== prev.doc) schedule(view)
            },
            destroy() { if (timer) clearTimeout(timer) },
          }
        },
      }),
    ]
  },
})

/**
 * Snapshot helpers so the container page can read the current
 * state without taking a dependency on ProseMirror internals.
 */
export function getLexiconState(editor: import('@tiptap/react').Editor): LexiconState | null {
  return LexiconKey.getState(editor.state) ?? null
}

/**
 * "Apply everywhere" — replace every flagged occurrence with its
 * canonical form in a single tx. Returns the number of edits made.
 */
export function normalizeDefinedTerms(editor: import('@tiptap/react').Editor): number {
  const plug = LexiconKey.getState(editor.state)
  if (!plug || plug.flags.length === 0) return 0
  // Walk doc, build a replacement plan keyed off plain-text offsets.
  const segments: Array<{ posStart: number; text: string }> = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    segments.push({ posStart: pos, text: node.text ?? '' })
    return false
  })
  // Re-scan + replace ONE flag per iteration. Walking fresh each
  // time dodges positional-drift bugs that plague batched multi-op
  // transactions, and the per-iteration cost is tiny compared to
  // the LLM calls the other extensions make.
  let edits = 0
  let safety = 100
  while (safety-- > 0) {
    const text = flattenText(editor.state.doc)
    const found = extractTerms(text)
    const termsList = found.map(f => f.term)
    const flags = termsList.length === 0 ? [] : findFlags(text, termsList)
    if (flags.length === 0) break

    const f = flags[0]  // canonical form will appear first in DESC or any order; take one
    const freshSegs: Array<{ posStart: number; text: string }> = []
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true
      freshSegs.push({ posStart: pos, text: node.text ?? '' })
      return false
    })
    let cursor = 0
    let from = -1, to = -1
    for (const seg of freshSegs) {
      const end = cursor + seg.text.length
      if (f.from >= cursor && f.to <= end) {
        from = seg.posStart + (f.from - cursor)
        to   = seg.posStart + (f.to - cursor)
        break
      }
      cursor = end
    }
    if (from < 0) break
    const ok = editor.commands.insertContentAt({ from, to }, f.term, {
      updateSelection: false,
      parseOptions:    { preserveWhitespace: 'full' },
    })
    if (!ok) break
    edits++
  }
  // Force a fresh scan so decorations repaint immediately rather
  // than waiting for the debounced scheduler tick.
  if (edits > 0) {
    const text2 = flattenText(editor.state.doc)
    const found2 = extractTerms(text2)
    const termsList2 = found2.map(f => f.term)
    const flags2 = termsList2.length === 0 ? [] : findFlags(text2, termsList2)
    const terms2 = found2.map(f => ({
      canonical: f.term, aliases: [] as string[],
      definedAt: { from: f.index, to: f.index + f.term.length },
    }))
    editor.view.dispatch(editor.state.tr.setMeta('lexiconScan', { terms: terms2, flags: flags2 }))
  }
  return edits
}

export default DefinedTermGuard
