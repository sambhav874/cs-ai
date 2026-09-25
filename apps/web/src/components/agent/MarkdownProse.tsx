/**
 * MarkdownProse — renders an assistant message's text content as proper
 * Markdown (bold, lists, code, headings, links) instead of raw glyphs.
 *
 * Used by AgentHomePage and SideAgentRail. Both used to render
 * `whitespace-pre-wrap` plain text, which meant Gemini/Claude responses
 * with `**bold**` and `*` bullets showed up as literal asterisks.
 *
 * Styling philosophy: no @tailwindcss/typography plugin (not installed),
 * just arbitrary selectors on the wrapper. Keeps it lightweight and
 * inherits the surrounding font-size so chat-rail (12.5px) and home
 * (14px) both look right.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { focusCitation, type AnswerCitation } from './CitationPills'

type Props = {
  text: string
  /** Tighter padding/margin for the cramped side-agent rail. */
  compact?: boolean
  /** The answer's verified sources: its [n] markers become buttons that bring source n forward. */
  citations?: AnswerCitation[]
  /** Ties the markers to their AnswerCitations list (the message id). */
  citeGroup?: string
}

const CITE_HREF = '#cite-'

/**
 * Turn `[n]` into a link the renderer below draws as a citation marker, for
 * the refs that have a source. They used to reach the reader as plain
 * bracket text, disconnected from the source list under the answer. A marker
 * whose citation was dropped is left as text (the pipeline removes those).
 */
export function linkCitationMarkers(text: string, refs: Set<string>): string {
  if (!refs.size) return text
  return text.replace(/\[(\d{1,3})\](?!\()/g, (m, n: string) => (refs.has(n) ? `[${n}](${CITE_HREF}${n})` : m))
}

export function MarkdownProse({ text, compact = false, citations, citeGroup }: Props) {
  const byRef = new Map((citations ?? []).map(c => [String(c.ref), c]))
  const body = citeGroup ? linkCitationMarkers(text, new Set(byRef.keys())) : text
  return (
    <div
      className={[
        'max-w-none break-words',
        // Element-by-element styling via arbitrary selectors. The
        // `[&_X]:Y` syntax compiles to a normal CSS rule scoped under
        // this wrapper, no plugin required.
        '[&_strong]:font-semibold [&_strong]:text-foreground',
        '[&_em]:italic',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_code]:font-mono',
        '[&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre>code]:bg-transparent [&_pre>code]:p-0',
        // Links follow the Button `link` variant: ink at rest, brand on hover.
        '[&_a]:text-fg-950 [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-surface-300 hover:[&_a]:text-primary-700 hover:[&_a]:decoration-primary-700',
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1',
        '[&_li]:leading-snug [&_li>p]:my-0',
        '[&_h1]:text-section [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1',
        '[&_h2]:text-body [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1',
        '[&_h3]:text-body [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:my-2',
        '[&_table]:my-2 [&_table]:text-[0.95em]',
        '[&_th]:text-left [&_th]:font-semibold [&_th]:px-2 [&_th]:py-1 [&_th]:border-b',
        '[&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-border/50',
        '[&_hr]:my-3 [&_hr]:border-border',
        compact ? '[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1' : '',
      ].join(' ')}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // External links open in a new tab so users don't navigate
          // away mid-conversation.
          a: ({ href, children, ...rest }) => {
            if (href?.startsWith(CITE_HREF) && citeGroup) {
              const ref = href.slice(CITE_HREF.length)
              const c = byRef.get(ref)
              return (
                <button
                  type="button"
                  data-testid={`cite-marker-${ref}`}
                  onClick={() => focusCitation(citeGroup, ref)}
                  title={c ? `“${c.quote.slice(0, 240)}${c.quote.length > 240 ? '…' : ''}”${c.page != null ? ` — p.${c.page}` : ''}` : undefined}
                  className="mx-0.5 inline-flex items-center justify-center align-super min-w-[1.25em] h-[1.35em] px-1 rounded-chip border border-primary-200 bg-primary-50 text-[0.68em] font-mono font-medium leading-none text-primary-700 no-underline hover:bg-primary-100 hover:border-primary-500"
                >
                  {ref}
                </button>
              )
            }
            return (
              <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            )
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
