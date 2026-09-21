/**
 * SpacesPage (P4.2 / docs/30 D.7.2)
 *
 * Space-centric list view. Card grid/list showing every open space
 * with the 3-child counts (contracts, requests, threads) + quick
 * filters (status) + a Create button.
 *
 * Design reference:
 *   - Ironclad Spaces list
 *   - Harvey Vault Projects
 *   - Legal Files space board
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusPill } from '@/components/ui/status-pill'
import { EmptyState } from '@/components/ui/primitives'
import { relativeTime } from '@/components/contracts/dates'
import {
  Briefcase, Plus, FileText, ClipboardList, MessageSquare,
  Search, X, CheckCircle2,
} from 'lucide-react'

interface SpaceRow {
  id: string
  name: string
  description: string | null
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED'
  counterpartyName: string | null
  ownerName: string | null
  tags: string[]
  contractCount: number
  requestCount: number
  threadCount: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export function SpacesPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'all' | 'CLOSED' | 'ARCHIVED'>('OPEN')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['spaces', statusFilter],
    queryFn: async () => (await api.get<{ items: SpaceRow[]; total: number }>('/spaces', {
      params: { status: statusFilter, limit: 100 },
    })).data,
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items ?? []).filter(m =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      (m.description ?? '').toLowerCase().includes(q) ||
      (m.counterpartyName ?? '').toLowerCase().includes(q) ||
      m.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [data, search])

  return (
    <div className="px-6 py-5 max-w-6xl mx-auto" data-testid="spaces-page">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-title text-fg-950 flex items-center gap-2">
            {/* Indigo belongs to the machine; a space is a human folder. */}
            <Briefcase className="size-4 text-fg-400" />
            Spaces
          </h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            Group contracts, requests, and agent threads under one negotiation.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="spaces-create-btn" size="sm" className="gap-1">
          <Plus className="h-3.5 w-3.5" /> New space
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-400" />
          <Input
            type="text"
            placeholder="Search by name, counterparty, tag…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="spaces-search"
            className="pl-8"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          data-testid="spaces-status-filter"
          aria-label="Filter spaces by status"
          className="h-8 text-[13px] text-fg-950 rounded-md border border-input bg-card px-2.5 focus:outline-none focus-visible:border-primary-700"
        >
          <option value="OPEN">Open only</option>
          <option value="all">All</option>
          <option value="CLOSED">Closed</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      {isLoading && <div className="text-dense text-muted-foreground py-6">Loading…</div>}
      {filtered.length === 0 && !isLoading && (
        /* One message used to cover three different situations — no spaces at
           all, a status filter with nothing in it, and a search that missed —
           and it always ended "Create one", which is wrong advice for two of
           the three. */
        <EmptyState
          icon={<Briefcase />}
          title={
            search.trim()
              ? `No spaces match “${search.trim()}”`
              : statusFilter === 'all'
                ? 'No spaces yet'
                : `No ${statusFilter.toLowerCase()} spaces`
          }
          description={
            search.trim()
              ? 'Search covers name, description, counterparty and tags.'
              : statusFilter === 'all'
                ? 'A space groups the contracts, requests and threads of one negotiation.'
                : 'Nothing is sitting in that state right now.'
          }
          action={
            search.trim() ? (
              <Button size="sm" variant="outline" onClick={() => setSearch('')}>Clear search</Button>
            ) : statusFilter !== 'all' ? (
              <Button size="sm" variant="outline" onClick={() => setStatusFilter('all')}>Show all spaces</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)} className="gap-1">
                <Plus className="h-3.5 w-3.5" /> New space
              </Button>
            )
          }
        />
      )}

      <ul className="space-y-2">
        {filtered.map(m => (
          <li
            key={m.id}
            data-testid={`space-row-${m.id}`}
            className="border border-border rounded-card bg-card hover:border-surface-300 hover:bg-surface-50 transition-colors"
          >
            <Link
              to={`/spaces/${m.id}`}
              className="block px-4 py-2.5 rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-medium text-body text-fg-950 truncate">{m.name}</span>
                {/*
                  The status pill only appears when it is telling you something.
                  The filter defaults to "Open only", so every row carried an
                  identical blue "Open" pill — the one coloured element on the
                  row, spent on the fact the user had just asked for. Colour
                  means something, or it is noise.
                */}
                {(statusFilter === 'all' || m.status !== statusFilter) && (
                  <StatusPill status={m.status} />
                )}
                {m.counterpartyName && (
                  <span className="text-[11px] text-muted-foreground">
                    · {m.counterpartyName}
                  </span>
                )}
                {/* Tags were indigo; a user-authored tag is not machine output,
                    so it reads as a neutral chip. */}
                {m.tags.slice(0, 3).map(t => (
                  <span key={t} className="text-[10px] font-mono text-fg-700 bg-surface-100 border border-surface-200 rounded-chip px-1.5">#{t}</span>
                ))}
                {m.tags.length > 3 && (
                  <span className="text-[10px] text-fg-400" title={m.tags.slice(3).join(', ')}>
                    +{m.tags.length - 3}
                  </span>
                )}
              </div>
              {m.description && (
                <div className="text-[12px] text-muted-foreground truncate">{m.description}</div>
              )}
              <div className="mt-1.5 flex items-center gap-4 text-[11px] tabular-nums text-fg-500">
                {/*
                  Zeroes are dropped. Every seeded space reads "0 requests ·
                  0 threads", so two thirds of this line was the same two
                  words on every row, at the same weight as the count that
                  varies. A count of nothing is not a fact worth a column.
                */}
                <span className="flex items-center gap-1">
                  <FileText className="size-3" />{m.contractCount} contract{m.contractCount === 1 ? '' : 's'}
                </span>
                {m.requestCount > 0 && (
                  <span className="flex items-center gap-1"><ClipboardList className="size-3" />{m.requestCount} request{m.requestCount === 1 ? '' : 's'}</span>
                )}
                {m.threadCount > 0 && (
                  <span className="flex items-center gap-1"><MessageSquare className="size-3" />{m.threadCount} thread{m.threadCount === 1 ? '' : 's'}</span>
                )}
                {/* Freed up by dropping the zeroes: when a negotiation last
                    moved, which is the question you actually scan a space
                    list to answer. */}
                <span className="ml-auto flex items-center gap-3">
                  <span title={new Date(m.updatedAt).toLocaleString()}>{relativeTime(m.updatedAt)}</span>
                  <span className="text-fg-400">{m.ownerName ?? 'unassigned'}</span>
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {creating && <CreateSpaceDrawer onClose={() => setCreating(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['spaces'] })} />}
    </div>
  )
}

function CreateSpaceDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '', description: '', counterpartyName: '', tags: '',
  })
  const [err, setErr] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: async () => (await api.post<SpaceRow>('/spaces', {
      name: form.name,
      description: form.description || undefined,
      counterpartyName: form.counterpartyName || undefined,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    })).data,
    onSuccess: (m) => { onCreated(); onClose(); navigate(`/spaces/${m.id}`) },
    onError: (e) => setErr((e as Error).message ?? 'Create failed'),
  })

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="space-create-drawer">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-scrim/30" />
      <div className="w-[520px] max-w-[90vw] bg-card border-l border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-section flex items-center gap-1.5">
            <Briefcase className="size-3.5 text-fg-400" /> New space
          </div>
          <Button size="icon-xs" variant="ghost" onClick={onClose}><X className="size-3.5" /></Button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <Field label="Name">
            <input
              type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              data-testid="space-create-name"
              placeholder='e.g. "Acme acquisition diligence"'
              className={inputCls}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              data-testid="space-create-description"
              rows={3}
              className={inputCls + ' resize-y'}
            />
          </Field>
          <Field label="Counterparty name (optional)">
            <input
              type="text" value={form.counterpartyName}
              onChange={e => setForm(f => ({ ...f, counterpartyName: e.target.value }))}
              data-testid="space-create-counterparty"
              className={inputCls}
            />
          </Field>
          <Field label="Tags (comma-separated)">
            <input
              type="text" value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="ma, diligence, q2"
              className={inputCls}
              data-testid="space-create-tags"
            />
          </Field>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2 bg-muted/30">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || form.name.trim().length === 0}
            data-testid="space-create-submit"
            className="gap-1"
          >
            <CheckCircle2 className="size-3.5" />
            {create.isPending ? 'Creating…' : 'Create space'}
          </Button>
        </div>
        {err && <div className="text-[11px] text-risk-700 bg-risk-50 border border-risk-200 rounded-md px-2 py-1 mx-4 mb-3">{err}</div>}
      </div>
    </div>
  )
}

const inputCls =
  'w-full text-[13px] text-fg-950 rounded-md border border-input bg-card px-[11px] py-1.5 ' +
  'placeholder:text-fg-400 focus:outline-none focus-visible:border-primary-700 ' +
  'focus-visible:ring-[3px] focus-visible:ring-primary-700/15'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-fg-700 mb-1">{label}</div>
      {children}
    </div>
  )
}
