/**
 * PlaybookReviewRailSection — where this contract stands against the playbook.
 *
 * Reads GET /contracts/:id/playbook-review, which merges the AI review the
 * pipeline runs on each new version with the playbook's own phrase checks and
 * the required clause types the contract lacks. The redline section below it
 * is the "fix" step; this is the "what is wrong" step, and it works with AI
 * off because the phrase checks need no model.
 *
 * Three things are always said out loud, never implied by an empty list:
 * required clauses that are missing, clauses the playbook does not cover, and
 * an AI review that is off, failed, or describes an older version.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { RailSection } from '@/components/contracts/RailSection'
import { Button } from '@/components/ui/button'
import { AssistMark } from '@/components/ui/assist'

type Alignment = 'preferred' | 'acceptable' | 'fallback' | 'walkaway' | 'outside_playbook' | 'not_covered'

interface Finding {
  clauseId:       string | null
  clauseType:     string
  sectionRef:     string | null
  excerpt:        string | null
  category:       { id: string; name: string } | null
  alignment:      Alignment | null
  severity:       string
  recommendation: 'accept' | 'negotiate' | 'reject' | null
  reasoning:      string | null
  ruleIssues:     Array<{ description: string; severity: string; position: string }>
}

interface ReviewView {
  ai: {
    status:     'none' | 'queued' | 'running' | 'done' | 'skipped' | 'failed'
    error:      string | null
    reviewedAt: string | null
    summary:    string | null
    stale:      boolean
  }
  findings:  Finding[]
  missing:   Array<{ categoryId: string; name: string }>
  unchecked: Array<{ clauseType: string; count: number; reason: string }>
  counts:    { clauses: number; findings: number; walkaway: number; missing: number; unchecked: number }
}

// Same ladder colours as the playbook page, so a pill here means what the card there means.
const ALIGNMENT: Record<string, { label: string; cls: string }> = {
  preferred:        { label: 'Preferred',        cls: 'bg-success-50 text-success-700 border-success-200' },
  acceptable:       { label: 'Acceptable',       cls: 'bg-surface-100 text-fg-700 border-surface-200' },
  fallback:         { label: 'Fallback',         cls: 'bg-attention-50 text-attention-700 border-attention-200' },
  walkaway:         { label: 'Walk away',        cls: 'bg-risk-50 text-risk-700 border-risk-200' },
  outside_playbook: { label: 'Outside playbook', cls: 'bg-risk-50 text-risk-700 border-risk-200' },
}

const SHOWN = 6

const humanType = (t: string) => t.replace(/_/g, ' ')

function timeAgo(iso: string | null): string | null {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function PlaybookReviewRailSection({
  contractId,
  reviewStatus,
  onJumpToClause,
}: {
  contractId:     string
  /** metadata._playbookReviewStatus — changes when a run finishes, so the view refetches. */
  reviewStatus?:  string | null
  onJumpToClause: (clauseId: string) => void
}) {
  const qc = useQueryClient()
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const { data, isLoading, isError } = useQuery<ReviewView>({
    queryKey: ['playbook-review', contractId, reviewStatus ?? null],
    queryFn:  () => api.get(`/contracts/${contractId}/playbook-review`).then(r => r.data),
  })

  const rerun = useMutation({
    mutationFn: () => api.post(`/contracts/${contractId}/playbook-review`).then(r => r.data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['contract', contractId] })
      qc.invalidateQueries({ queryKey: ['playbook-review', contractId] })
    },
  })

  if (isLoading) {
    return (
      <RailSection title="Playbook review" defaultOpen>
        <Loader2 className="size-4 animate-spin text-fg-400" />
      </RailSection>
    )
  }
  if (isError || !data) {
    return (
      <RailSection title="Playbook review" defaultOpen>
        <p className="text-dense text-fg-500">The playbook review could not be loaded.</p>
      </RailSection>
    )
  }

  const { ai, findings, missing, unchecked, counts } = data
  const running = ai.status === 'queued' || ai.status === 'running' || rerun.isPending
  const walkaway = findings.filter(f => f.alignment === 'walkaway').length
  const negotiate = findings.length - walkaway
  const visible = showAll ? findings : findings.slice(0, SHOWN)
  const clean = counts.clauses > 0 && findings.length === 0 && missing.length === 0

  return (
    <RailSection title="Playbook review" defaultOpen>
      <div className="space-y-2.5" data-testid="playbook-review">
        {counts.clauses === 0 ? (
          <p className="text-dense text-fg-500">
            No clauses have been extracted from this contract yet, so there is nothing to check.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="playbook-review-summary">
            {walkaway > 0 && (
              <span className="px-1.5 py-0.5 rounded-chip border font-medium bg-risk-50 text-risk-700 border-risk-200">
                {walkaway} walk away
              </span>
            )}
            {negotiate > 0 && (
              <span className="px-1.5 py-0.5 rounded-chip border font-medium bg-attention-50 text-attention-700 border-attention-200">
                {negotiate} to negotiate
              </span>
            )}
            {missing.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-chip border font-medium bg-risk-50 text-risk-700 border-risk-200">
                {missing.length} missing
              </span>
            )}
            {counts.unchecked > 0 && (
              <span className="px-1.5 py-0.5 rounded-chip border bg-surface-100 text-fg-700 border-surface-200">
                {counts.unchecked} not checked
              </span>
            )}
            {clean && <span className="text-success-700 font-medium">Every checked clause is at preferred.</span>}
          </div>
        )}

        {missing.length > 0 && (
          <div className="rounded-md border border-risk-200 bg-risk-50 px-2 py-1.5" data-testid="playbook-review-missing">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-risk-700">
              <AlertTriangle className="size-3.5 shrink-0" />
              Required clause{missing.length === 1 ? '' : 's'} not found
            </p>
            <p className="text-[11px] text-risk-700 mt-0.5 pl-5">{missing.map(m => m.name).join(', ')}</p>
          </div>
        )}

        {findings.length > 0 && (
          <ul className="space-y-1.5" data-testid="playbook-review-findings">
            {visible.map((f, i) => {
              const pill = f.alignment ? ALIGNMENT[f.alignment] : null
              const isOpen = open === i
              const line = f.reasoning ?? f.ruleIssues[0]?.description ?? null
              return (
                <li key={`${f.clauseId ?? 'x'}-${i}`} className="rounded-md border border-surface-200">
                  <div className="flex items-start gap-1.5 p-2">
                    <button
                      onClick={() => setOpen(isOpen ? null : i)}
                      className="mt-0.5 text-fg-400 hover:text-fg-700"
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                    >
                      {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {f.clauseId ? (
                          <button
                            type="button"
                            onClick={() => onJumpToClause(f.clauseId!)}
                            className="text-[11px] font-medium text-fg-950 hover:underline underline-offset-2 truncate max-w-[160px] text-left"
                            title="Show in document"
                          >
                            {f.category?.name ?? humanType(f.clauseType)}
                          </button>
                        ) : (
                          <span className="text-[11px] font-medium text-fg-950">{f.category?.name ?? humanType(f.clauseType)}</span>
                        )}
                        {f.sectionRef && <span className="text-[10px] text-fg-400">{f.sectionRef}</span>}
                        {pill && (
                          <span className={cn('text-[10px] px-1 py-0.5 rounded-chip border', pill.cls)}>{pill.label}</span>
                        )}
                      </div>
                      {line && !isOpen && <p className="text-[11px] text-fg-500 mt-0.5 line-clamp-2">{line}</p>}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t border-surface-100 px-2 py-2 space-y-1.5">
                      {f.reasoning && (
                        <p className="flex items-start gap-1 text-[11px] text-fg-700">
                          <AssistMark className="size-[7px] mt-1 shrink-0" />
                          <span>{f.reasoning}</span>
                        </p>
                      )}
                      {f.ruleIssues.length > 0 && (
                        <ul className="space-y-0.5">
                          {f.ruleIssues.map((r, k) => (
                            <li key={k} className="text-[11px] text-fg-700">
                              <span className="text-fg-500 capitalize">{r.position}:</span> {r.description}
                            </li>
                          ))}
                        </ul>
                      )}
                      {f.excerpt && (
                        <p className="text-[11px] text-fg-700 bg-surface-100 rounded-chip px-1.5 py-1 line-clamp-4">{f.excerpt}</p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {findings.length > SHOWN && (
          <button
            type="button"
            onClick={() => setShowAll(v => !v)}
            className="text-[11px] font-medium text-fg-700 hover:text-fg-950"
          >
            {showAll ? 'Show fewer' : `Show all ${findings.length}`}
          </button>
        )}

        {unchecked.length > 0 && (
          <p className="text-[11px] text-fg-500" data-testid="playbook-review-unchecked">
            Not checked, no playbook position for:{' '}
            {unchecked.slice(0, 4).map(u => `${humanType(u.clauseType)}${u.count > 1 ? ` (${u.count})` : ''}`).join(', ')}
            {unchecked.length > 4 && ` and ${unchecked.length - 4} more`}.{' '}
            <Link to="/playbook" className="font-medium text-fg-700 hover:text-fg-950 underline underline-offset-2">Edit playbook</Link>
          </p>
        )}

        {/* The AI half's state, stated plainly. */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-surface-100">
          <p className="text-[11px] text-fg-500 min-w-0" data-testid="playbook-review-ai-status">
            {running ? (
              <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> AI review running…</span>
            ) : ai.status === 'skipped' ? (
              <>{ai.error ?? 'AI review skipped.'} Phrase checks still ran.</>
            ) : ai.status === 'failed' ? (
              <span className="text-risk-700">{ai.error ?? 'AI review failed.'}</span>
            ) : ai.status === 'done' ? (
              <>AI reviewed {timeAgo(ai.reviewedAt) ?? ''}{ai.stale && ', on an earlier version'}</>
            ) : (
              <>Phrase checks only. AI review has not run.</>
            )}
          </p>
          {counts.clauses > 0 && (
            <Button
              size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] gap-1 shrink-0"
              onClick={() => rerun.mutate()}
              disabled={running}
              data-testid="playbook-review-rerun"
              title="Run the AI review again, e.g. after changing the playbook"
            >
              <RefreshCw className="size-3" />
              {ai.status === 'none' ? 'Run' : 'Re-run'}
            </Button>
          )}
        </div>
        {rerun.isError && (
          <p className="text-[11px] text-risk-700">
            {(rerun.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Could not start the review.'}
          </p>
        )}
      </div>
    </RailSection>
  )
}
