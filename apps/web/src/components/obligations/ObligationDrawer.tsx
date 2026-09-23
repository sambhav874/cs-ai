/**
 * ObligationDrawer — one obligation, everything needed to track it.
 *
 * Opened from the obligations table or the contract rail. Top to bottom it
 * answers the questions ops actually asks:
 *   • what exactly is owed      — the requirement (rule, tiers, consequence)
 *   • says who                  — the verbatim quote, with a link to its page
 *   • who owns it and when      — assignee, due date, recurrence, editable here
 *   • what has happened         — complete / waive / reopen, and the history
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X, ExternalLink, FileText, Loader2, CheckCircle2, Ban, RotateCcw, Paperclip,
  UserRound, CalendarClock, Repeat, AlertTriangle, MessageSquare, Sparkles,
} from 'lucide-react'
import {
  ObligationTermsSchema, consequenceLine, termsHeadline, tierLines, isRecurring,
  type ObligationTerms,
} from '@clm/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { Eyebrow } from '@/components/ui/primitives'
import { UserPicker } from '@/components/common/UserPicker'
import { CompleteObligationModal } from '@/components/contracts/CompleteObligationModal'

export interface ObligationDetail {
  id: string
  contractId: string
  type: string
  description: string
  owner: string
  dueDate: string | null
  recurrence: string
  trigger: string | null
  quote: string
  severity: string
  sectionRef: string | null
  page: number | null
  status: 'OPEN' | 'COMPLETED' | 'OVERDUE' | 'WAIVED'
  completedAt: string | null
  completionNote: string | null
  needsReview: boolean
  source: string
  packId: string | null
  packVersion: string | null
  terms: unknown
  assignee: { id: string; name: string; email: string } | null
  completedBy: { id: string; name: string; email: string } | null
  contract: { id: string; title: string; status: string; counterpartyName: string | null } | null
}

interface HistoryEvent {
  id: string
  kind: string
  note: string | null
  data: Record<string, unknown>
  periodDue: string | null
  createdAt: string
  hasEvidence: boolean
  evidenceFilename: string | null
  actor: { id: string; name: string } | null
}

const RECURRENCES = ['one-time', 'daily', 'weekly', 'monthly', 'quarterly', 'annually', 'on-event'] as const

export function parseTerms(raw: unknown): ObligationTerms | null {
  const parsed = ObligationTermsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
// Due dates are calendar days stored at UTC midnight; read them in UTC or a
// viewer west of Greenwich sees the day before.
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function ObligationDrawer({ obligationId, onClose }: { obligationId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const panelRef = useRef<HTMLDivElement>(null)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [waiving, setWaiving] = useState(false)
  const [waiveReason, setWaiveReason] = useState('')
  const [note, setNote] = useState('')

  const detail = useQuery({
    queryKey: ['obligation', obligationId],
    queryFn:  async () => (await api.get<ObligationDetail>(`/obligations/${obligationId}`)).data,
  })
  const history = useQuery({
    queryKey: ['obligation-events', obligationId],
    queryFn:  async () => (await api.get<{ data: HistoryEvent[]; people: Record<string, { name: string }>; origin: { createdAt: string; source: string } }>(
      `/obligations/${obligationId}/events`,
    )).data,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['obligation', obligationId] })
    qc.invalidateQueries({ queryKey: ['obligation-events', obligationId] })
    qc.invalidateQueries({ queryKey: ['obligations-list'] })
    qc.invalidateQueries({ queryKey: ['obligations-stats'] })
    qc.invalidateQueries({ queryKey: ['contract-obligations'] })
  }

  const update = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => (await api.patch(`/obligations/${obligationId}`, patch)).data,
    onSuccess: refresh,
  })
  const waive = useMutation({
    mutationFn: async () => (await api.post(`/obligations/${obligationId}/waive`, { reason: waiveReason.trim() })).data,
    onSuccess: () => { setWaiving(false); setWaiveReason(''); refresh() },
  })
  const reopen = useMutation({
    mutationFn: async () => (await api.post(`/obligations/${obligationId}/reopen`)).data,
    onSuccess: refresh,
  })
  const addNote = useMutation({
    mutationFn: async () => (await api.post(`/obligations/${obligationId}/notes`, { note: note.trim() })).data,
    onSuccess: () => { setNote(''); refresh() },
  })
  const openSource = useMutation({
    mutationFn: async (page: number | null) => {
      const tab = openTabNow()
      try {
        const { data } = await api.get<{ url: string }>(`/contracts/${detail.data!.contractId}/download`)
        // The browser's PDF viewer honours #page, so the citation lands on the
        // page the quote came from.
        navigateTab(tab, page ? `${data.url}#page=${page}` : data.url)
      } catch (err) {
        tab?.close()
        throw err
      }
    },
  })
  const openEvidence = async (eventId?: string) => {
    const tab = openTabNow()
    try {
      const { data } = await api.get<{ url: string }>(`/obligations/${obligationId}/evidence${eventId ? `?eventId=${eventId}` : ''}`)
      navigateTab(tab, data.url)
    } catch {
      tab?.close()
    }
  }

  // Escape closes; focus moves into the panel so keyboard users land in it.
  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !completeOpen) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, completeOpen])

  const o = detail.data
  const terms = o ? parseTerms(o.terms) : null
  const headline = termsHeadline(terms)
  const consequence = consequenceLine(terms)
  const tiers = tierLines(terms)
  const owed = o?.status === 'OPEN' || o?.status === 'OVERDUE'
  const rolls = !!o?.dueDate && isRecurring(o?.recurrence)
  const mutationError = [update, waive, reopen, addNote, openSource].find(m => m.error)?.error as
    { response?: { data?: { detail?: string } }; message?: string } | undefined

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="obligation-drawer">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={o ? `Obligation: ${o.description}` : 'Obligation'}
        className="relative h-full w-full max-w-[560px] bg-card border-l border-surface-200 shadow-xl flex flex-col focus:outline-none"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-surface-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {o ? (
              <>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <StatusPill status={o.status} />
                  <span className="text-[10.5px] font-mono uppercase tracking-wider text-fg-400">{o.type}</span>
                  {o.needsReview && (
                    <span className="text-[10px] uppercase tracking-wider text-attention-700 bg-attention-50 border border-attention-200 rounded-chip px-1.5">
                      needs review
                    </span>
                  )}
                </div>
                <h2 className="text-[15px] font-semibold text-fg-950 leading-snug">{o.description}</h2>
                {o.contract && (
                  <Link to={`/contracts/${o.contract.id}`} className="mt-1 inline-flex items-center gap-1 text-[12px] text-fg-500 hover:text-fg-950 hover:underline">
                    <FileText className="size-3" />
                    {o.contract.title}{o.contract.counterpartyName ? ` · ${o.contract.counterpartyName}` : ''}
                  </Link>
                )}
              </>
            ) : (
              <div className="h-10 flex items-center"><Loader2 className="size-4 animate-spin text-fg-400" /></div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-md text-fg-500 hover:text-fg-950 hover:bg-surface-100">
            <X className="size-4" />
          </button>
        </div>

        {detail.isError && (
          <div className="m-5 text-body text-risk-700">This obligation could not be loaded.</div>
        )}

        {o && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            {/* Requirement */}
            <section aria-labelledby="ob-req">
              <Eyebrow><span id="ob-req">Requirement</span></Eyebrow>
              <div className="mt-2 space-y-2 text-[13px]">
                {headline ? (
                  <div className="text-fg-950 font-medium" data-testid="obligation-requirement">{headline}</div>
                ) : (
                  <div className="text-fg-500">
                    {o.source === 'contractsense'
                      ? 'No measurable rule was extracted — the quote below is the obligation.'
                      : 'No structured terms on this obligation.'}
                  </div>
                )}
                {tiers.length > 0 && (
                  <ul className="rounded-md border border-surface-200 divide-y divide-surface-200">
                    {tiers.map((t, i) => <li key={i} className="px-3 py-1.5 text-[12.5px] text-fg-700 tabular-nums">{t}</li>)}
                  </ul>
                )}
                {consequence && (
                  <div className="flex items-start gap-2 text-[12.5px]" data-testid="obligation-consequence">
                    <AlertTriangle className="size-3.5 mt-0.5 text-risk-700 flex-shrink-0" />
                    <span><span className="text-fg-500">If missed: </span><span className="text-fg-950">{consequence}</span></span>
                  </div>
                )}
                {terms?.remediation && (
                  <div className="text-[12.5px]">
                    <span className="text-fg-500">Remediation: </span>
                    <span className="text-fg-700">{terms.remediation}</span>
                    {terms.remediationSla && <span className="text-fg-500"> · within {terms.remediationSla}</span>}
                  </div>
                )}
                {terms?.gracePeriodDays ? (
                  <div className="text-[12.5px] text-fg-500">Grace period: {terms.gracePeriodDays} days</div>
                ) : null}
                {o.trigger && <div className="text-[12.5px]"><span className="text-fg-500">Trigger: </span><span className="text-fg-700">{o.trigger}</span></div>}
                {terms && terms.exceptions.length > 0 && (
                  <div className="text-[12.5px]">
                    <span className="text-fg-500">Exceptions: </span>
                    <span className="text-fg-700">{terms.exceptions.join('; ')}</span>
                  </div>
                )}
                <div className="text-[11.5px] text-fg-500">
                  Obligated party: <span className="text-fg-700">{o.owner}</span>
                  {o.packId && <> · pack {o.packId}{o.packVersion ? ` v${o.packVersion}` : ''}</>}
                </div>
              </div>
            </section>

            {/* Source */}
            <section aria-labelledby="ob-src">
              <Eyebrow><span id="ob-src">Source</span></Eyebrow>
              <blockquote className="mt-2 border-l-2 border-surface-300 pl-3 text-[12.5px] text-fg-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {o.quote}
              </blockquote>
              <div className="mt-2 flex items-center gap-3 text-[11.5px] text-fg-500">
                {o.sectionRef && <span className="font-mono">§ {o.sectionRef}</span>}
                <button
                  type="button"
                  onClick={() => openSource.mutate(o.page)}
                  disabled={openSource.isPending}
                  className="inline-flex items-center gap-1 text-fg-700 hover:text-fg-950 hover:underline disabled:opacity-50"
                  data-testid="obligation-open-source"
                >
                  <ExternalLink className="size-3" />
                  {o.page ? `Open page ${o.page}` : 'Open document'}
                </button>
                {o.needsReview && (
                  <button
                    type="button"
                    onClick={() => update.mutate({ needsReview: false })}
                    className="ml-auto inline-flex items-center gap-1 text-fg-700 hover:text-fg-950 hover:underline"
                  >
                    <CheckCircle2 className="size-3" /> Mark reviewed
                  </button>
                )}
              </div>
            </section>

            {/* Tracking */}
            <section aria-labelledby="ob-track">
              <Eyebrow><span id="ob-track">Tracking</span></Eyebrow>
              <div className="mt-2 grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 text-[12.5px]">
                <label className="text-fg-500 inline-flex items-center gap-1.5"><UserRound className="size-3.5" /> Assignee</label>
                <div className="flex items-center gap-2">
                  <UserPicker
                    value={o.assignee?.id ?? ''}
                    onChange={id => update.mutate({ assigneeId: id || null })}
                    placeholder="Assign to…"
                    testId="obligation-assignee-picker"
                    className="flex-1"
                  />
                </div>

                <label htmlFor="ob-due" className="text-fg-500 inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" /> Due</label>
                <DueDateField
                  key={o.dueDate ?? 'none'}
                  value={o.dueDate}
                  onCommit={dueDate => update.mutate({ dueDate })}
                />

                <label htmlFor="ob-rec" className="text-fg-500 inline-flex items-center gap-1.5"><Repeat className="size-3.5" /> Repeats</label>
                <select
                  id="ob-rec"
                  value={RECURRENCES.includes(o.recurrence as never) ? o.recurrence : ''}
                  onChange={e => update.mutate({ recurrence: e.target.value })}
                  className="h-8 rounded-md border border-surface-200 bg-card px-2 text-[12.5px] w-44"
                  data-testid="obligation-recurrence-select"
                >
                  {!RECURRENCES.includes(o.recurrence as never) && <option value="">Not set</option>}
                  {RECURRENCES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {rolls && owed && (
                <p className="mt-2 text-[11.5px] text-fg-500">
                  Recurring: completing this period records it and moves the due date to the next one.
                </p>
              )}
              {o.status === 'COMPLETED' && (
                <p className="mt-2 text-[12px] text-success-700">
                  Completed {fmtDate(o.completedAt)}{o.completedBy ? ` by ${o.completedBy.name}` : ''}
                  {o.completionNote ? ` — ${o.completionNote}` : ''}
                </p>
              )}
              {o.status === 'WAIVED' && (
                <p className="mt-2 text-[12px] text-fg-700">
                  Waived {fmtDate(o.completedAt)}{o.completedBy ? ` by ${o.completedBy.name}` : ''} — {o.completionNote}
                </p>
              )}
            </section>

            {/* Actions */}
            <section className="flex items-center gap-2 flex-wrap">
              {owed && (
                <>
                  <Button size="sm" onClick={() => setCompleteOpen(true)} data-testid="obligation-complete-btn">
                    <CheckCircle2 /> {rolls ? 'Complete this period' : 'Mark complete'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setWaiving(v => !v)} data-testid="obligation-waive-btn">
                    <Ban /> Waive
                  </Button>
                </>
              )}
              {(o.status === 'COMPLETED' || o.status === 'WAIVED') && (
                <Button size="sm" variant="outline" onClick={() => reopen.mutate()} disabled={reopen.isPending} data-testid="obligation-reopen-btn">
                  <RotateCcw /> Reopen
                </Button>
              )}
              {update.isPending && <Loader2 className="size-3.5 animate-spin text-fg-400" />}
            </section>
            {waiving && (
              <form
                className="-mt-3 space-y-2"
                onSubmit={e => { e.preventDefault(); if (waiveReason.trim().length >= 3) waive.mutate() }}
              >
                <label htmlFor="ob-waive" className="text-[12px] text-fg-700">Why is this no longer owed?</label>
                <textarea
                  id="ob-waive"
                  value={waiveReason}
                  onChange={e => setWaiveReason(e.target.value)}
                  rows={2}
                  placeholder="e.g. Released by Amendment 2, clause 4"
                  className="w-full rounded-md border border-surface-200 bg-card px-2 py-1.5 text-[12.5px]"
                />
                <Button size="sm" type="submit" disabled={waiveReason.trim().length < 3 || waive.isPending}>Confirm waiver</Button>
              </form>
            )}
            {mutationError && (
              <div className="text-[12px] text-risk-700" role="alert">
                {mutationError.response?.data?.detail ?? mutationError.message ?? 'Something went wrong.'}
              </div>
            )}

            {/* History */}
            <section aria-labelledby="ob-hist">
              <Eyebrow><span id="ob-hist">History</span></Eyebrow>
              <form
                className="mt-2 flex items-start gap-2"
                onSubmit={e => { e.preventDefault(); if (note.trim()) addNote.mutate() }}
              >
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Add a note…"
                  aria-label="Add a note"
                  className="flex-1 h-8 rounded-md border border-surface-200 bg-card px-2 text-[12.5px]"
                  data-testid="obligation-note-input"
                />
                <Button size="sm" variant="outline" type="submit" disabled={!note.trim() || addNote.isPending}>
                  <MessageSquare /> Add
                </Button>
              </form>
              <ol className="mt-3 space-y-2.5" data-testid="obligation-history">
                {(history.data?.data ?? []).map(ev => (
                  <li key={ev.id} className="text-[12px] leading-snug">
                    <div className="text-fg-700">
                      <span className="font-medium">{ev.actor?.name ?? 'System'}</span>{' '}
                      {describeEvent(ev, history.data?.people ?? {})}
                    </div>
                    {ev.note && ev.kind !== 'waived' && <div className="text-fg-500 mt-0.5 whitespace-pre-wrap">“{ev.note}”</div>}
                    {ev.hasEvidence && (
                      <button type="button" onClick={() => openEvidence(ev.id)} className="mt-0.5 inline-flex items-center gap-1 text-fg-700 hover:underline">
                        <Paperclip className="size-3" /> {ev.evidenceFilename ?? 'Evidence'}
                      </button>
                    )}
                    <div className="text-[10.5px] text-fg-400 mt-0.5">{fmtDateTime(ev.createdAt)}</div>
                  </li>
                ))}
                {history.data && (
                  <li className="text-[12px] text-fg-500 flex items-center gap-1.5">
                    <Sparkles className="size-3" />
                    {history.data.origin.source === 'contractsense' ? 'Extracted from the contract' : 'Created'} · {fmtDateTime(history.data.origin.createdAt)}
                  </li>
                )}
              </ol>
            </section>
          </div>
        )}
      </div>

      {o && completeOpen && (
        <CompleteObligationModal
          obligationId={o.id}
          description={o.description}
          open={completeOpen}
          onClose={() => setCompleteOpen(false)}
          onCompleted={() => { setCompleteOpen(false); refresh() }}
        />
      )}
    </div>
  )
}

/**
 * Open the tab inside the click, point it at the signed URL once it arrives.
 * A window.open after an await is outside the user gesture, and popup
 * blockers drop it — the link would silently do nothing.
 */
function openTabNow(): Window | null {
  const tab = window.open('about:blank', '_blank')
  if (tab) tab.opener = null
  return tab
}

function navigateTab(tab: Window | null, url: string) {
  if (tab) tab.location.href = url
  else window.location.assign(url) // blocked anyway: at least get them there
}

/**
 * A native date input that saves when the person is done, not per keystroke:
 * typing "2027" into the year fires change events for years 2, 20 and 202,
 * each a valid date the API would store. Commits on blur or Enter, only a
 * complete date from 1900 on, and only when it differs.
 */
function DueDateField({ value, onCommit }: { value: string | null; onCommit: (iso: string | null) => void }) {
  const [draft, setDraft] = useState(toDateInput(value))
  const commit = () => {
    const current = toDateInput(value)
    if (draft === current) return
    if (draft === '') { onCommit(null); return }
    const year = Number(draft.slice(0, 4))
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft) && year >= 1900 && year <= 2200) onCommit(draft)
    else setDraft(current)
  }
  return (
    <input
      id="ob-due"
      type="date"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      className="h-8 rounded-md border border-surface-200 bg-card px-2 text-[12.5px] w-44"
      data-testid="obligation-due-input"
    />
  )
}

function describeEvent(ev: HistoryEvent, people: Record<string, { name: string }>): string {
  const d = ev.data ?? {}
  const who = (id: unknown) => (typeof id === 'string' ? people[id]?.name ?? 'someone' : 'nobody')
  const day = (iso: unknown) => (typeof iso === 'string' ? fmtDate(iso) : 'no date')
  switch (ev.kind) {
    case 'assigned':    return `assigned this to ${who(d.to)}${d.bulk ? ' (bulk)' : ''}`
    case 'unassigned':  return `unassigned ${who(d.from)}`
    case 'due_changed': return `moved the due date from ${day(d.from)} to ${day(d.to)}`
    case 'completed':
      return ev.periodDue
        ? `completed the period due ${fmtDate(ev.periodDue)}${d.nextDueDate ? ` — next due ${day(d.nextDueDate)}` : ''}`
        : 'marked this complete'
    case 'reopened':    return `reopened this (was ${String(d.from ?? '').toLowerCase()})`
    case 'waived':      return `waived this — ${ev.note ?? ''}`
    case 'note':        return 'added a note'
    case 'updated': {
      const fields = Object.keys(d).map(k => k === 'recurrence' ? `recurrence → ${String((d[k] as { to?: unknown })?.to ?? '')}` : k)
      return `updated ${fields.join(', ')}`
    }
    default:            return ev.kind.replace(/_/g, ' ')
  }
}
