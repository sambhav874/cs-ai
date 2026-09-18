/**
 * Redline resolution (Wave 2.1, 2026-07).
 *
 * The diff endpoint returns a node-htmldiff blob where changes from the newer
 * version are wrapped in <ins> (added) / <del> (removed) spans. These helpers
 * turn that blob into a list of per-change decisions and then resolve those
 * decisions back into clean merged HTML — which we save as a new version via
 * the existing POST /contracts/:id/html-version endpoint. No new backend.
 *
 * Semantics (from the reviewer's point of view — "ours" = older, "theirs" =
 * newer/counterparty):
 *   accept  = take theirs  → keep <ins> content, drop <del> content
 *   reject  = keep ours    → drop <ins> content, keep <del> content
 *
 * extractChanges and resolveDiff enumerate <ins>/<del> in the same document
 * order, so the index-based ids (`c0`, `c1`, …) line up between them.
 */

export type RedlineDecision = 'accept' | 'reject'

export interface RedlineChange {
  id:   string           // stable within one diff: `c` + document-order index
  type: 'ins' | 'del'    // ins = added by theirs; del = removed by theirs
  text: string           // trimmed text content, for the review list
}

function parse(diffHtml: string): { body: HTMLElement; nodes: Element[] } | null {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(`<body>${diffHtml}</body>`, 'text/html')
  return { body: doc.body, nodes: Array.from(doc.body.querySelectorAll('ins, del')) }
}

/** List every <ins>/<del> change in document order. */
export function extractChanges(diffHtml: string): RedlineChange[] {
  const parsed = parse(diffHtml)
  if (!parsed) return []
  return parsed.nodes.map((n, i) => ({
    id:   `c${i}`,
    type: n.tagName.toLowerCase() === 'ins' ? 'ins' : 'del',
    text: (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }))
}

/**
 * Resolve the diff blob into clean merged HTML given per-change decisions.
 * Undecided changes fall back to `pendingDefault` (default 'reject' = keep
 * ours, so an un-reviewed counterparty edit is never silently taken).
 */
export function resolveDiff(
  diffHtml: string,
  decisions: Record<string, RedlineDecision>,
  pendingDefault: RedlineDecision = 'reject',
): string {
  const parsed = parse(diffHtml)
  if (!parsed) return diffHtml
  parsed.nodes.forEach((node, i) => {
    const decision = decisions[`c${i}`] ?? pendingDefault
    const isIns = node.tagName.toLowerCase() === 'ins'
    const keepContent = isIns ? decision === 'accept' : decision === 'reject'
    const parent = node.parentNode
    if (!parent) return
    if (keepContent) {
      while (node.firstChild) parent.insertBefore(node.firstChild, node)
    }
    parent.removeChild(node)
  })
  return parsed.body.innerHTML
}
