/**
 * SpaceDetailPage (P4.2 / docs/30 D.7.2 + D.7.3)
 *
 * Workspace for a single space — the space's contracts, intake requests and
 * agent threads, with a header carrying its metadata and status controls.
 *
 * This page was built and reviewed while `spaces` had zero rows, so it had
 * only ever been seen as an empty state. With 14 real spaces and 80 linked
 * contracts the gaps showed up immediately:
 *
 *   • The Requests tab printed raw enum values — "· MORE_INFO_NEEDED · HIGH".
 *   • A failed fetch rendered "Loading…" forever, because the guard was
 *     `isLoading || !data` and never asked about `error`. A deleted space was
 *     an infinite spinner.
 *   • Close / Archive / Reopen swallowed their errors: the button spun, the
 *     status didn't change, and nothing said why.
 *   • Counterparty and owner were plain text on a page whose whole job is to
 *     be the hub of a negotiation — both are now links.
 *   • Contract rows showed value and risk but not expiry or counterparty, so
 *     you could not tell two identically-named NDAs apart.
 */
import { useState } from 'react'
import { normalizeRisk, riskBand, RISK_BAND_CLASS, MEANING_CLASS, statusMeaning, statusMeta } from '@/lib/status'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { CountBadge, EmptyState } from '@/components/ui/primitives'
import { expiryLabel, relativeTime } from '@/components/contracts/dates'
import {
  Briefcase, FileText, ClipboardList, MessageSquare, ArrowLeft,
  Archive, CheckCircle2, AlertCircle, Brain, History, Gauge,
} from 'lucide-react'
import { IntelligenceProviders } from '@/features/intelligence/IntelligenceProviders'
import { useSpaceProject } from '@/features/intelligence/useSpaceProject'
import { ProjectMemoryPanel } from '@/features/intelligence/components/projects/ProjectMemoryPanel'
import { ProjectTimeline } from '@/features/intelligence/components/projects/ProjectTimeline'
import { SpaceKpiSummary } from '@/features/intelligence/SpaceKpiSummary'

interface Detail {
  id: string
  name: string
  description: string | null
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED'
  counterpartyId: string | null
  counterpartyName: string | null
  owner: { id: string; name: string; email: string; avatarUrl: string | null } | null
  counterparty: { id: string; name: string; website: string | null } | null
  tags: string[]
  contracts: Array<{
    id: string; title: string; type: string; status: string
    value: number | null; currency: string | null; riskScore: number | null
    counterpartyName: string | null; effectiveDate: string | null; expiryDate: string | null
    updatedAt: string
    analysisStatus: string | null
  }>
  requests: Array<{
    id: string; requestNumber: string | null; title: string; type: string
    status: string; priority: string; counterpartyName: string | null
    createdAt: string
  }>
  threads: Array<{
    id: string; title: string; scopeType: string | null; scopeId: string | null
    userId: string; updatedAt: string
  }>
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

/** Priority as prose. `{r.priority}` rendered the database value, uppercase. */
const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent',
}

function money(value: number | null, currency: string | null): string | null {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  // `(c.currency ?? '$') + n.toLocaleString()` printed "USD75,945".
  const ccy = currency ?? 'USD'
  return ccy === 'USD' ? `$${n.toLocaleString()}` : `${ccy} ${n.toLocaleString()}`
}

export function SpaceDetailPage() {
  const qc = useQueryClient()
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'contracts' | 'requests' | 'threads' | 'memory' | 'timeline' | 'kpis'>('contracts')
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['space', id],
    enabled: !!id,
    queryFn: async () => (await api.get<Detail>(`/spaces/${id}`)).data,
  })

  const onMutationError = (e: unknown) =>
    setActionError((e as Error)?.message ?? 'That change did not save. Try again.')
  const onMutationSuccess = () => {
    setActionError(null)
    qc.invalidateQueries({ queryKey: ['space', id] })
    qc.invalidateQueries({ queryKey: ['spaces'] })
  }

  const close = useMutation({
    mutationFn: () => api.patch(`/spaces/${id}`, { status: 'CLOSED' }).then(r => r.data),
    onSuccess: onMutationSuccess,
    onError: onMutationError,
  })
  const archive = useMutation({
    mutationFn: () => api.patch(`/spaces/${id}`, { status: 'ARCHIVED' }).then(r => r.data),
    onSuccess: onMutationSuccess,
    onError: onMutationError,
  })
  const reopen = useMutation({
    mutationFn: () => api.patch(`/spaces/${id}`, { status: 'OPEN' }).then(r => r.data),
    onSuccess: onMutationSuccess,
    onError: onMutationError,
  })
  const busy = close.isPending || archive.isPending || reopen.isPending

  if (isLoading) {
    return <div className="p-6 text-dense text-muted-foreground">Loading…</div>
  }

  // A space that 404s, or an API that is down, used to fall into the same
  // branch as "still loading" and spin forever.
  if (error || !data) {
    return (
      <div className="px-6 py-5 max-w-6xl mx-auto" data-testid="space-detail-error">
        <Link to="/spaces" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-fg-950 mb-4">
          <ArrowLeft className="size-3" /> Spaces
        </Link>
        <EmptyState
          icon={<AlertCircle />}
          title="This space could not be loaded"
          description={
            (error as { response?: { status?: number } })?.response?.status === 404
              ? 'It may have been deleted, or it belongs to another organisation.'
              : ((error as Error)?.message ?? 'The request failed.')
          }
          action={<Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    )
  }

  return (
    <div className="px-6 py-5 max-w-6xl mx-auto" data-testid="space-detail-page">
      <Link to="/spaces" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-fg-950 mb-3">
        <ArrowLeft className="size-3" /> Spaces
      </Link>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="text-title text-fg-950 flex items-center gap-2 flex-wrap">
            <Briefcase className="size-4 text-fg-400 shrink-0" />
            {data.name}
            <StatusPill status={data.status} />
          </h1>
          <div className="text-[12px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            {/* Both of these used to be dead text on the one page whose job is
                to be the hub of a negotiation. */}
            {data.counterpartyName && (
              <span>
                Counterparty:{' '}
                {data.counterpartyId ? (
                  <Link
                    to={`/counterparties/${data.counterpartyId}`}
                    className="text-fg-950 font-medium hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    data-testid="space-counterparty-link"
                  >
                    {data.counterpartyName}
                  </Link>
                ) : (
                  <span className="text-fg-950">{data.counterpartyName}</span>
                )}
              </span>
            )}
            {data.owner && <span>· Owner: <span className="text-fg-950">{data.owner.name}</span></span>}
            {/* User-authored tags, so neutral — indigo is the machine's. */}
            {data.tags.map(t => <span key={t} className="font-mono text-fg-700 bg-surface-100 border border-surface-200 rounded-chip px-1.5">#{t}</span>)}
          </div>
          {data.description && <p className="text-[12px] text-fg-700 mt-2 max-w-3xl">{data.description}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {data.status === 'OPEN' ? (
            <>
              <Button
                variant="outline" size="sm"
                onClick={() => close.mutate()}
                disabled={busy}
                data-testid="space-close-btn"
                className="gap-1 text-[12px]"
              >
                <CheckCircle2 className="size-3" /> {close.isPending ? 'Closing…' : 'Close'}
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => archive.mutate()}
                disabled={busy}
                data-testid="space-archive-btn"
                className="gap-1 text-[12px]"
              >
                <Archive className="size-3" /> {archive.isPending ? 'Archiving…' : 'Archive'}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => reopen.mutate()} disabled={busy} data-testid="space-reopen-btn" className="gap-1 text-[12px]">
              {reopen.isPending ? 'Reopening…' : 'Reopen'}
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          data-testid="space-action-error"
          className="mb-3 flex items-start justify-between gap-3 rounded-md border border-risk-200 bg-risk-50 px-3 py-2 text-dense text-risk-900"
        >
          <span className="min-w-0 break-words">{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="shrink-0 font-semibold text-risk-700 hover:text-risk-900">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center border-b border-border gap-4 text-[13px] mb-3">
        {[
          { k: 'contracts', label: 'Contracts', icon: FileText,    count: data.contracts.length },
          { k: 'requests',  label: 'Requests',  icon: ClipboardList, count: data.requests.length },
          { k: 'threads',   label: 'Threads',   icon: MessageSquare, count: data.threads.length },
          // The intelligence half of this Space. Its record over there is
          // created the first time one of these two tabs is opened.
          { k: 'memory',    label: 'Memory',    icon: Brain,         count: null },
          { k: 'timeline',  label: 'Timeline',  icon: History,       count: null },
          { k: 'kpis',      label: 'Obligations', icon: Gauge,       count: null },
        ].map(t => {
          const Icon = t.icon
          const active = tab === t.k
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k as typeof tab)}
              data-testid={`space-tab-${t.k}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-1.5 py-2 border-b-2 transition-colors',
                // Selected tab is an action state — ink, not a hue.
                active
                  ? 'text-fg-950 border-fg-950 font-semibold'
                  : 'text-muted-foreground border-transparent hover:text-fg-950',
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
              {/* Was a bare opacity-70 number; the product has a primitive for
                  this and it reads the same here as on the Requests tabs. */}
              {t.count !== null && <CountBadge tone={active ? 'ink' : 'neutral'}>{t.count}</CountBadge>}
            </button>
          )
        })}
      </div>

      {tab === 'contracts' && (
        <ul className="divide-y divide-border border border-border rounded-card bg-card overflow-hidden" data-testid="space-tab-contracts-body">
          {data.contracts.length === 0 && <EmptyRow text="No contracts in this space yet. Open a contract and assign it via the Space picker in its header." />}
          {data.contracts.map(c => {
            const risk = normalizeRisk(c.riskScore)
            const exp = expiryLabel(c.expiryDate)
            const amount = money(c.value, c.currency)
            return (
              <li key={c.id}>
                <Link to={`/contracts/${c.id}`} className="block px-4 py-2 hover:bg-muted/40 focus:outline-none focus-visible:bg-surface-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium text-[12.5px] text-fg-950 truncate">{c.title}</span>
                    <span className="text-[10.5px] uppercase tracking-[0.09em] text-muted-foreground font-mono">{c.type}</span>
                    <StatusPill status={c.status} />
                    <span className="ml-auto text-[10.5px] text-muted-foreground whitespace-nowrap">{relativeTime(c.updatedAt)}</span>
                  </div>
                  {/* Second line: the facts that tell two identically-titled
                      NDAs apart. This row used to carry only value + risk. */}
                  <div className="mt-0.5 flex items-center gap-2.5 flex-wrap text-[11px] text-muted-foreground">
                    {c.counterpartyName && <span>{c.counterpartyName}</span>}
                    {/* Whether the intelligence tier has read this contract.
                        Shown only while it has not: "analysed" on every row of
                        a healthy Space is noise, but one contract stuck at
                        PENDING explains why the Space's memory is thin. */}
                    {c.analysisStatus && c.analysisStatus !== 'DONE' && (
                      <span
                        className={cn('inline-flex items-center gap-1', MEANING_CLASS[statusMeaning(c.analysisStatus)].fg)}
                        title="How far the intelligence tier has got with this contract"
                      >
                        <span className={cn('size-1.5 rounded-full', MEANING_CLASS[statusMeaning(c.analysisStatus)].dot)} aria-hidden />
                        {statusMeta(c.analysisStatus).label}
                      </span>
                    )}
                    {amount && <span className="tabular-nums text-fg-700 font-medium">{amount}</span>}
                    {/*
                      Risk keeps the system's default treatment — a meaning dot
                      beside neutral text — instead of colouring the whole
                      label. With most of the portfolio in the medium band,
                      amber text on every row made amber mean nothing.
                    */}
                    {risk != null && (
                      <span className="inline-flex items-center gap-1 tabular-nums" title={`Risk score ${risk} of 100 — ${riskBand(risk)} band`}>
                        {/* Dot above the low band only — see the same note on
                            the counterparty profile. */}
                        {riskBand(risk) !== 'low' && (
                          <span className={cn('size-1.5 rounded-full', RISK_BAND_CLASS[riskBand(risk)])} aria-hidden />
                        )}
                        risk {risk}
                      </span>
                    )}
                    {exp && (
                      <span className={cn('tabular-nums', exp.tone === 'risk' && 'text-risk-700 font-medium')}>
                        {exp.label}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {tab === 'requests' && (
        <ul className="divide-y divide-border border border-border rounded-card bg-card overflow-hidden" data-testid="space-tab-requests-body">
          {data.requests.length === 0 && <EmptyRow text="No intake requests linked to this space." />}
          {data.requests.map(r => (
            <li key={r.id}>
              {/*
                These rows were inert. RequestsPage now accepts ?request=<id>
                and opens that request's panel, so a space can hand off to the
                intake queue instead of dead-ending.
              */}
              <Link
                to={`/requests?request=${r.id}`}
                data-testid={`space-request-${r.id}`}
                className="block px-4 py-2 hover:bg-muted/40 focus:outline-none focus-visible:bg-surface-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-[10.5px] text-muted-foreground">{r.requestNumber ?? r.id.slice(-6)}</span>
                  <span className="font-medium text-[12.5px] text-fg-950 truncate">{r.title}</span>
                  {/* Was `· {r.status} · {r.priority}` — raw database values. */}
                  <StatusPill status={r.status} />
                  <span className="text-[11px] text-muted-foreground">
                    {PRIORITY_LABEL[r.priority] ?? r.priority.toLowerCase()} priority
                  </span>
                  <span className="ml-auto text-[10.5px] text-muted-foreground whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(tab === 'memory' || tab === 'timeline' || tab === 'kpis') && (
        <IntelligenceProviders>
          <SpaceIntelligenceTab spaceId={id!} view={tab} />
        </IntelligenceProviders>
      )}

      {tab === 'threads' && (
        <ul className="divide-y divide-border border border-border rounded-card bg-card overflow-hidden" data-testid="space-tab-threads-body">
          {data.threads.length === 0 && <EmptyRow text="No agent threads linked to this space yet." />}
          {data.threads.map(t => (
            <li key={t.id} className="px-4 py-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <MessageSquare className="size-3 text-muted-foreground self-center" />
                <span className="text-[12.5px] text-fg-950 truncate">{t.title}</span>
                <span className="ml-auto text-[10.5px] text-muted-foreground whitespace-nowrap">
                  last activity {relativeTime(t.updatedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <li className="px-4 py-8 text-center text-[12px] text-muted-foreground italic">
      {text}
    </li>
  )
}

function cn(...c: Array<string | null | undefined | false>): string {
  return c.filter(Boolean).join(' ')
}

/**
 * Memory and Timeline come from the intelligence tier, which keys its data to
 * this Space by id. The lookup creates that half on first use, so a Space made
 * a minute ago works the same as one migrated from ContractSense.
 */
function SpaceIntelligenceTab({ spaceId, view }: { spaceId: string; view: 'memory' | 'timeline' | 'kpis' }) {
  const { data: project, isLoading, error } = useSpaceProject(spaceId)

  if (isLoading) {
    return <div className="h-64 rounded-card border border-border bg-card animate-pulse" aria-busy="true" aria-label="Loading" />
  }
  if (error || !project) {
    return (
      <div className="rounded-card border border-risk-200 bg-risk-50 p-4 text-dense text-risk-700" role="alert">
        Could not open this Space's {view}. {error instanceof Error ? error.message : ''}
      </div>
    )
  }
  if (view === 'memory') return <ProjectMemoryPanel projectId={project._id} />
  if (view === 'kpis') return <SpaceKpiSummary projectId={project._id} />
  return <ProjectTimeline projectId={project._id} />
}
