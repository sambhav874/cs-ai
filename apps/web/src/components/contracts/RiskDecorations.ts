/**
 * RiskDecorations — TipTap extension that renders inline underlines for
 * risky clauses (red) and playbook deviations (blue) in the document canvas.
 *
 * B.5.5 — first slice of the inline-intelligence layer.
 *
 * Design:
 *   - Pure ProseMirror decorations (presentation only — never mutates the doc)
 *   - Driven by an external `clauses` prop passed from ContractDetailPage
 *   - A `meta` transaction lets React swap the clauses without re-initing the
 *     editor (which would lose cursor / undo history in edit mode)
 *   - Three visibility modes:
 *       off      — no decorations at all
 *       summary  — margin dots only (class `.risk-marker-summary`)
 *       full     — inline underlines + margin dots (class `.risk-marker-full`)
 */
import { Extension } from '@tiptap/react' // re-exported from @tiptap/core
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

/** A clause as our app already models it — trimmed to what we need here. */
export interface RiskClause {
  id: string
  content: string
  riskRating: string | null
}

/** Normalised severity used by the CSS classes. */
export type RiskKind = 'risk' | 'deviation' | null

/** Map our storage values (lowercase from Python extraction, or UPPER from
 *  frontend legacy) into the two decoration kinds the UI cares about. */
export function classifyRisk(rating: string | null | undefined): RiskKind {
  if (!rating) return null
  const r = rating.toLowerCase()
  if (r === 'unfavorable' || r === 'high' || r === 'aggressive') return 'risk'
  if (r === 'unusual' || r === 'medium' || r === 'non_standard' || r === 'non-standard') return 'deviation'
  return null
}

export type RiskView = 'off' | 'summary' | 'full'

interface PluginState {
  decorations: DecorationSet
}

/** Meta key used to push new data from React → plugin. */
const key = new PluginKey<PluginState>('riskDecorations')

/**
 * Build a normalized copy of the haystack with a position map back to the
 * original. Normalization: collapse whitespace + lowercase + unify curly
 * quotes/dashes. The map lets us translate a hit in the normalized string
 * back to exact `[from, to]` ranges in the original.
 */
function normalize(s: string): { norm: string; map: number[] } {
  const norm: string[] = []
  const map: number[] = []
  let prevWasSpace = false
  for (let i = 0; i < s.length; i++) {
    let ch = s[i]
    if (/\s/.test(ch)) {
      if (prevWasSpace) continue // collapse
      ch = ' '
      prevWasSpace = true
    } else {
      prevWasSpace = false
      // Unify curly quotes and dashes to their ASCII counterparts.
      if (ch === '\u2018' || ch === '\u2019') ch = "'"
      else if (ch === '\u201C' || ch === '\u201D') ch = '"'
      else if (ch === '\u2013' || ch === '\u2014') ch = '-'
      ch = ch.toLowerCase()
    }
    norm.push(ch)
    map.push(i)
  }
  // Add a sentinel so `ranges using norm.length` as end don't index past `map`.
  map.push(s.length)
  return { norm: norm.join(''), map }
}

/**
 * Find ranges (on the original docText) that match `needle` ignoring case,
 * whitespace collapsing, and curly/straight punctuation differences.
 * Tries the full clause first, then progressively shorter prefixes.
 * Capped to `max` matches per clause so a generic phrase can't flood.
 */
function findRanges(docText: string, needle: string, max = 2): Array<[number, number]> {
  const cleanNeedle = needle.replace(/\s+/g, ' ').trim()
  if (cleanNeedle.length < 20) return []

  const { norm: hayNorm, map } = normalize(docText)
  const candidates: string[] = [cleanNeedle]
  const sentence = cleanNeedle.match(/^[^.!?]{20,}[.!?]/)?.[0]
  if (sentence && sentence.length < cleanNeedle.length) candidates.push(sentence)
  if (cleanNeedle.length > 100) {
    const slice = cleanNeedle.slice(0, 100)
    const cut = slice.lastIndexOf(' ')
    if (cut > 40) candidates.push(slice.slice(0, cut))
  }
  if (cleanNeedle.length > 60) {
    const slice = cleanNeedle.slice(0, 60)
    const cut = slice.lastIndexOf(' ')
    if (cut > 30) candidates.push(slice.slice(0, cut))
  }

  const ranges: Array<[number, number]> = []
  const seen = new Set<number>()

  for (const candidate of candidates) {
    if (ranges.length >= max) break
    const { norm: needleNorm } = normalize(candidate)
    if (needleNorm.length < 20) continue
    let i = 0
    while (ranges.length < max) {
      const hit = hayNorm.indexOf(needleNorm, i)
      if (hit < 0) break
      const from = map[hit]
      const to = map[hit + needleNorm.length]
      if (!seen.has(from)) {
        seen.add(from)
        ranges.push([from, to])
      }
      i = hit + needleNorm.length
    }
    if (ranges.length) break
  }

  return ranges
}

/** External action a React component dispatches to update clauses/view. */
interface UpdateAction {
  clauses: RiskClause[]
  riskView: RiskView
}

export const RiskHighlights = Extension.create<{ defaultView?: RiskView }>({
  name: 'riskHighlights',

  addProseMirrorPlugins() {
    // Store the latest data on the Extension's storage so `apply` can read it.
    // Set via editor.storage.riskHighlights.update(...) from the React component.
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: () => ({ decorations: DecorationSet.empty }),
          apply(tr, prev, _old, newState) {
            // 1. Map existing decorations if the doc changed.
            let decorations = prev.decorations.map(tr.mapping, tr.doc)

            // 2. If a meta push arrived (from React), recompute from scratch.
            const meta = tr.getMeta(key) as UpdateAction | undefined
            if (meta) {
              // We can't call buildDecorations here (needs view) — set a flag
              // and handle it in the view update.
              // Actually easier: build using state.doc directly.
              const decos: Decoration[] = []
              const docText: string[] = []
              const positions: Array<{ start: number; pmStart: number; length: number }> = []
              newState.doc.descendants((node, pos) => {
                if (node.isText && node.text) {
                  positions.push({ start: docText.join('').length, pmStart: pos, length: node.text.length })
                  docText.push(node.text)
                }
                return true
              })
              const flat = docText.join('')

              if (meta.riskView !== 'off' && meta.clauses.length) {
                for (const clause of meta.clauses) {
                  const kind = classifyRisk(clause.riskRating)
                  if (!kind) continue
                  const ranges = findRanges(flat, clause.content)
                  for (const [flatFrom, flatTo] of ranges) {
                    let cursor = flatFrom
                    for (const seg of positions) {
                      const segFlatEnd = seg.start + seg.length
                      if (segFlatEnd <= flatFrom) continue
                      if (seg.start >= flatTo) break
                      const localFrom = Math.max(cursor, seg.start) - seg.start
                      const localTo = Math.min(flatTo, segFlatEnd) - seg.start
                      const pmFrom = seg.pmStart + localFrom
                      const pmTo = seg.pmStart + localTo
                      // B.5.17 — a11y: aria-label announces the marker
                      // to screen readers; role="button" + tabindex make it
                      // reachable via keyboard. The click handler on the
                      // parent canvas (event delegation) fires the same
                      // onRiskClick path as a mouse click.
                      decos.push(
                        Decoration.inline(pmFrom, pmTo, {
                          class: `risk-marker risk-marker--${kind} risk-marker--view-${meta.riskView}`,
                          nodeName: 'span',
                          role: 'button',
                          tabindex: '0',
                          'aria-label': kind === 'risk'
                            ? 'Risky clause — open focused review'
                            : 'Deviation from playbook — open focused review',
                          'data-risk-kind': kind,
                          'data-clause-id': clause.id,
                        }),
                      )
                      cursor = seg.start + localTo
                    }
                  }
                }
              }

              decorations = DecorationSet.create(newState.doc, decos)
            }

            return { decorations }
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? null
          },
        },
      }),
    ]
  },
})

/** Helper the React component calls to refresh the decoration set. */
export function updateRiskHighlights(editor: Editor | null, payload: UpdateAction) {
  if (!editor) return
  const { view } = editor
  view.dispatch(view.state.tr.setMeta(key, payload))
}
