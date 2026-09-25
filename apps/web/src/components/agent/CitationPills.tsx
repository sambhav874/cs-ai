/**
 * CitationPills (P3.1 / docs/30 D.5.8)
 *
 * Inline UI for a `contract_cite` tool result. Renders each citation
 * as a clickable pill: "§9.2 · p.2 · 'capped at 12 months of fees'".
 * Clicking routes to the contract page with ?section=9.2, which the
 * detail page reads to scroll + highlight the matching TOC entry.
 *
 * Design reference:
 *   - Hebbia inline citations — click → PDF highlight
 *   - Claude.ai citations — hover shows quote, click jumps to source
 *   - Harvey citation badges — per-claim backing
 */
import { useEffect, useRef, useState } from 'react'
import { Quote, ExternalLink } from 'lucide-react'

export interface Citation {
  quote:        string
  page:         number | null
  bbox:         number[] | null
  sectionRef:   string | null
  sectionTitle: string
  score:        number
  exact:        boolean
}

export interface CitationBundle {
  contractId:   string
  title:        string
  query?:       string
  citations:    Citation[]
  warning?:     string
}

export function CitationPills({ bundle }: { bundle: CitationBundle }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  if (!bundle.citations || bundle.citations.length === 0) {
    return (
      <div
        data-testid="citation-pills-empty"
        data-contract-id={bundle.contractId}
        // Nothing is blocked on the user here — a miss is an informational
        // outcome, not "your turn", so it stays neutral rather than attention.
        className="text-[11px] text-fg-700 bg-surface-100 border border-surface-200 rounded-md px-2.5 py-1.5"
      >
        {bundle.warning ?? (
          <>
            No passage in{' '}
            <span className="font-medium text-fg-950">{bundle.title || 'this contract'}</span>{' '}
            matches{bundle.query ? <> “<span className="font-mono">{bundle.query}</span>”</> : ' that search'}.
            {' '}Anything stated about this clause below is unsupported by the document.
          </>
        )}
      </div>
    )
  }

  return (
    <div
      data-testid="citation-pills"
      data-contract-id={bundle.contractId}
      // Citations are neutral pills — the point is the source, not the machine.
      // Indigo here would claim the passage was authored by the model.
      className="rounded-card border border-surface-200 bg-card text-[12px] overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-surface-200">
        <Quote className="size-3.5 text-fg-400 flex-shrink-0" />
        <span className="font-semibold text-fg-950 text-[11.5px]">
          Citations
        </span>
        <span className="font-mono text-[10.5px] text-fg-500 truncate">
          · {bundle.title}
        </span>
        {/* What was searched for. The bundle has carried `query` all along
            and never showed it, so a reader could not tell whether a thin
            set of passages meant a thin contract or a narrow search. */}
        {bundle.query && (
          <span className="text-[10.5px] text-fg-400 truncate shrink" title={bundle.query}>
            “{bundle.query}”
          </span>
        )}
        <span className="ml-auto text-[10px] text-fg-400 tabular-nums shrink-0">
          {bundle.citations.length}
        </span>
      </div>

      <ul className="divide-y divide-surface-100">
        {bundle.citations.map((c, i) => {
          const targetPath = `/contracts/${bundle.contractId}` + (
            c.sectionRef ? `?section=${encodeURIComponent(c.sectionRef)}` : ''
          )
          const isExpanded = expandedIdx === i
          return (
            <li
              key={i}
              data-testid={`citation-${i}`}
              data-ref={c.sectionRef || undefined}
              data-page={c.page ?? undefined}
              data-exact={c.exact ? '1' : '0'}
              className="px-3 py-1.5 hover:bg-surface-50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <a
                  href={targetPath}
                  target="_self"
                  data-testid={`citation-link-${i}`}
                  className="flex items-baseline gap-1.5 min-w-0 flex-1 group"
                  title={`Open contract at ${c.sectionRef ? `§${c.sectionRef}` : c.sectionTitle}`}
                >
                  {c.sectionRef && (
                    <span className="font-mono text-[10.5px] text-fg-500 flex-shrink-0">
                      §{c.sectionRef}
                    </span>
                  )}
                  <span className="truncate text-[11.5px] text-fg-950 group-hover:text-primary-700">
                    {c.sectionTitle || c.quote.slice(0, 60)}
                  </span>
                  {c.page != null && (
                    <span className="font-mono text-[9.5px] text-fg-400 flex-shrink-0 tabular-nums">
                      p.{c.page}
                    </span>
                  )}
                  {c.exact && (
                    // "exact" is a verified match against the source document —
                    // binding in the design system's sense, not decoration.
                    <span
                      className="text-[9px] uppercase tracking-wider font-medium text-success-700 bg-success-50 border border-success-200 rounded-chip px-1 flex-shrink-0"
                      title="Exact substring match of the query"
                    >
                      exact
                    </span>
                  )}
                  <ExternalLink className="size-2.5 text-fg-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </a>
                <button
                  type="button"
                  onClick={() => setExpandedIdx(isExpanded ? null : i)}
                  data-testid={`citation-toggle-${i}`}
                  className="text-[10px] text-fg-700 hover:text-fg-950 hover:underline flex-shrink-0"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? 'hide' : 'quote'}
                </button>
              </div>
              {isExpanded && (
                <div
                  data-testid={`citation-quote-${i}`}
                  className="mt-1 text-[11px] text-fg-700 bg-surface-50 border border-surface-200 rounded-chip px-2 py-1 italic"
                >
                  “{c.quote}”
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The answer's own citations (plan P3): every quote the assistant cited,
 * after the citation guard found it in the contract. Numbered like the
 * markers in the prose; each opens the contract at the page the quote is on.
 * Unverified citations never arrive here — the guard drops them — so the
 * badge distinguishes an exact quote from one confirmed against retrieved
 * evidence only.
 */
export interface AnswerCitation {
  ref:        number | string
  /** "fact": from the Space's project memory; "passage": contract text. */
  kind?:      'fact' | 'passage'
  factId?:    string | null
  contractId: string | null
  quote:      string
  page:       number | null
  sectionRef: string | null
  filename?:  string | null
  verified:   boolean
  exact?:     boolean
}

/** Longest quote carried in a link; the viewer matches it word for word. */
const LINK_QUOTE_CHARS = 300

export function citationHref(c: AnswerCitation): string | null {
  if (!c.contractId) return null
  const params = new URLSearchParams()
  if (c.page != null) params.set('page', String(c.page))
  else if (c.sectionRef) params.set('section', c.sectionRef)
  // The contract page highlights this passage in the PDF (PdfQuoteViewer).
  // A fact's text is the Space's words, not the contract's, so it has none.
  if (c.kind !== 'fact' && c.quote) params.set('quote', c.quote.slice(0, LINK_QUOTE_CHARS))
  const q = params.toString()
  return `/contracts/${c.contractId}${q ? `?${q}` : ''}`
}

/** Fired by an answer's [n] marker (MarkdownProse) to bring its source forward. */
export const CITATION_FOCUS_EVENT = 'answer-citation-focus'
export function focusCitation(group: string, ref: number | string) {
  window.dispatchEvent(new CustomEvent(CITATION_FOCUS_EVENT, { detail: { group, ref: String(ref) } }))
}

/**
 * An answer's sources, each with the words it quotes on show.
 *
 * The quote used to sit behind a small "quote" toggle, so a reader saw a
 * list of VERIFIED badges and never the text that was verified. It now shows
 * under each source (two lines, click for all of it); the source opens the
 * contract with that passage highlighted. `group` ties the list to its
 * answer's [n] markers, which scroll here and flash the source.
 */
export function AnswerCitations({ citations, group }: { citations: AnswerCitation[]; group?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const rows = useRef<Array<HTMLLIElement | null>>([])

  useEffect(() => {
    if (!group) return
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ group: string; ref: string }>).detail
      if (detail?.group !== group) return
      const i = citations.findIndex(c => String(c.ref) === detail.ref)
      if (i < 0) return
      setOpen(i)
      setFlash(i)
      rows.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      window.setTimeout(() => setFlash(f => (f === i ? null : f)), 1600)
    }
    window.addEventListener(CITATION_FOCUS_EVENT, onFocus)
    return () => window.removeEventListener(CITATION_FOCUS_EVENT, onFocus)
  }, [group, citations])

  if (!citations.length) return null
  return (
    <div data-testid="answer-citations" className="mt-2 rounded-card border border-surface-200 bg-card text-[12px] overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-surface-200">
        <Quote className="size-3.5 text-fg-400 flex-shrink-0" />
        <span className="font-semibold text-fg-950 text-[11.5px]">Sources</span>
        <span className="ml-auto text-[10px] text-fg-400 tabular-nums">{citations.length}</span>
      </div>
      <ul className="divide-y divide-surface-100">
        {citations.map((c, i) => {
          const href = citationHref(c)
          const label = c.filename || c.sectionRef || c.quote.slice(0, 60)
          return (
            <li
              key={i}
              ref={el => { rows.current[i] = el }}
              data-testid={`answer-citation-${i}`}
              data-page={c.page ?? undefined}
              className={`px-3 py-1.5 transition-colors ${flash === i ? 'bg-attention-50' : ''}`}
            >
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10.5px] text-fg-500 flex-shrink-0">[{String(c.ref)}]</span>
                {href ? (
                  <a href={href} className="flex items-baseline gap-1.5 min-w-0 flex-1 group" title="Open the contract with this passage highlighted">
                    <span className="truncate text-[11.5px] text-fg-950 group-hover:text-primary-700">{label}</span>
                    {c.sectionRef && c.filename && <span className="font-mono text-[10px] text-fg-500 flex-shrink-0">§{c.sectionRef}</span>}
                    {c.page != null && <span className="font-mono text-[9.5px] text-fg-400 flex-shrink-0 tabular-nums">p.{c.page}</span>}
                    <ExternalLink className="size-2.5 text-fg-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </a>
                ) : (
                  <span className="truncate text-[11.5px] text-fg-950 flex-1">{label}</span>
                )}
                {c.kind === 'fact' && (
                  <span className="text-[9px] uppercase tracking-wider font-medium text-fg-700 bg-surface-100 border border-surface-200 rounded-chip px-1 flex-shrink-0" title="A fact recorded in this Space's memory">
                    fact
                  </span>
                )}
                {c.verified && (
                  <span
                    className="text-[9px] uppercase tracking-wider font-medium text-success-700 bg-success-50 border border-success-200 rounded-chip px-1 flex-shrink-0"
                    title={c.exact === false ? 'Confirmed against the retrieved passage' : 'Found word for word in the contract'}
                  >
                    {c.exact === false ? 'checked' : 'verified'}
                  </span>
                )}
              </div>
              {c.quote && (
                <button
                  type="button"
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-expanded={open === i}
                  title={open === i ? 'Show less' : 'Show the whole quote'}
                  data-testid={`answer-citation-quote-${i}`}
                  className={`mt-1 ml-6 w-[calc(100%-1.5rem)] text-left text-[11px] leading-snug text-fg-700 italic border-l-2 border-surface-300 pl-2 hover:text-fg-950 ${open === i ? 'block' : 'line-clamp-2'}`}
                >
                  “{c.quote}”
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
