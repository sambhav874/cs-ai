import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Download, History, ShieldCheck, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/primitives'

// Admin → Audit log: every recorded state change in the org, newest first.
// Read-only — the log is append-only and hash-chained; "Verify chain" re-checks
// that no row was altered or removed.

interface AuditActor { id: string; name: string; email: string }
interface AuditRow {
  id: string
  userId: string | null
  action: string
  resourceType: string
  resourceId: string
  metadata: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
  hash: string | null
  actor: AuditActor | null
}
interface AuditPage { data: AuditRow[]; nextCursor: string | null }
interface AuditFilters { actions: string[]; resourceTypes: string[]; users: AuditActor[] }
interface ChainResult {
  ok: boolean
  total: number
  verified: number
  firstBreak: { eventId: string; reason: string } | null
}

type Filters = { action: string; resourceType: string; userId: string; from: string; to: string }
const EMPTY: Filters = { action: '', resourceType: '', userId: '', from: '', to: '' }

const selectCls = 'text-[13px] rounded-md border border-input bg-card text-fg-950 px-2 py-1.5'
const thCls = 'text-left text-[11px] font-semibold text-fg-500 uppercase tracking-[0.08em] px-4 py-2'

function query(f: Filters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, v)
  return p.toString()
}

const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

/** Where a row's resource lives in the app, when it has a page. */
function resourceHref(type: string, id: string): string | null {
  switch (type) {
    case 'contract':  return `/contracts/${id}`
    case 'request':   return `/requests`
    case 'space':     return `/spaces/${id}`
    case 'counterparty': return `/counterparties/${id}`
    default:          return null
  }
}

export function AdminAuditPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [open, setOpen] = useState<string | null>(null)
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters(f => ({ ...f, [k]: e.target.value }))

  const { data: options } = useQuery<AuditFilters>({
    queryKey: ['admin-audit-filters'],
    queryFn: () => api.get('/admin/audit/filters').then(r => r.data),
  })

  const list = useInfiniteQuery<AuditPage>({
    queryKey: ['admin-audit', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.get(`/admin/audit?${query(filters, { cursor: pageParam as string })}`).then(r => r.data),
    getNextPageParam: last => last.nextCursor ?? undefined,
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap(p => p.data), [list.data])

  const verify = useMutation<ChainResult>({
    mutationFn: () => api.get('/admin/audit/verify').then(r => r.data),
  })

  const exportCsv = async () => {
    const r = await api.get(`/admin/audit/export?${query(filters)}`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const filtered = Object.values(filters).some(Boolean)

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-4" data-testid="admin-audit-page">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <History className="size-4 text-fg-400" />
            <h1 className="text-title text-fg-950">Audit log</h1>
          </div>
          <p className="text-body text-fg-500 mt-1">
            Every change to contracts, approvals, signatures, users and settings, with who made it and when.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => verify.mutate()} disabled={verify.isPending} data-testid="audit-verify-btn">
            <ShieldCheck />
            {verify.isPending ? 'Verifying…' : 'Verify chain'}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="audit-export-btn">
            <Download />
            Export CSV
          </Button>
        </div>
      </div>

      {verify.data && (
        <div
          role="status"
          data-testid="audit-verify-result"
          className={`flex items-start gap-2 rounded-md border p-3 text-dense ${verify.data.ok
            ? 'border-surface-200 bg-surface-50 text-fg-700'
            : 'border-risk-200 bg-risk-50 text-risk-700'}`}
        >
          {verify.data.ok ? <ShieldCheck className="size-4 mt-px" /> : <ShieldAlert className="size-4 mt-px text-risk-600" />}
          <span>
            {verify.data.ok
              ? `Chain intact: ${verify.data.verified} of ${verify.data.total} events verified.`
              : `Chain broken at event ${verify.data.firstBreak?.eventId} (${humanize(verify.data.firstBreak?.reason ?? '')}). ${verify.data.verified} events verified before it.`}
          </span>
        </div>
      )}
      {verify.isError && (
        <p role="alert" className="text-dense text-risk-700">Couldn't verify the chain. Try again.</p>
      )}

      <div className="flex flex-wrap items-center gap-2" data-testid="audit-filters">
        <select aria-label="Action" value={filters.action} onChange={set('action')} className={selectCls}>
          <option value="">All actions</option>
          {(options?.actions ?? []).map(a => <option key={a} value={a}>{humanize(a)}</option>)}
        </select>
        <select aria-label="Resource" value={filters.resourceType} onChange={set('resourceType')} className={selectCls}>
          <option value="">All resources</option>
          {(options?.resourceTypes ?? []).map(t => <option key={t} value={t}>{humanize(t)}</option>)}
        </select>
        <select aria-label="User" value={filters.userId} onChange={set('userId')} className={selectCls}>
          <option value="">Everyone</option>
          {(options?.users ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-dense text-fg-500">
          From <input type="date" value={filters.from} onChange={set('from')} className={selectCls} />
        </label>
        <label className="flex items-center gap-1 text-dense text-fg-500">
          To <input type="date" value={filters.to} onChange={set('to')} className={selectCls} />
        </label>
        {filtered && (
          <button onClick={() => setFilters(EMPTY)} className="text-dense text-fg-700 hover:underline underline-offset-2">
            Clear filters
          </button>
        )}
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-12">
          <div className="size-5 border-2 border-surface-300 border-t-fg-950 rounded-full animate-spin" />
        </div>
      ) : list.isError ? (
        <p role="alert" className="text-dense text-risk-700">Couldn't load the audit log.</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No events"
          description={filtered ? 'Nothing matches these filters.' : 'Changes appear here as people use the platform.'}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full" data-testid="audit-table">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className={`${thCls} w-6`} aria-label="Details" />
                <th className={thCls}>When</th>
                <th className={thCls}>Who</th>
                <th className={thCls}>Action</th>
                <th className={thCls}>Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200">
              {rows.map(r => {
                const isOpen = open === r.id
                const href = resourceHref(r.resourceType, r.resourceId)
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="hover:bg-surface-50 cursor-pointer"
                      onClick={() => setOpen(isOpen ? null : r.id)}
                      data-testid={`audit-row-${r.id}`}
                    >
                      <td className="px-4 py-2 text-fg-400">
                        {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </td>
                      <td className="px-4 py-2 text-[13px] text-fg-700 tabular-nums whitespace-nowrap" title={r.createdAt}>
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-[13px] text-fg-950">
                        {r.actor ? r.actor.name : <span className="text-fg-500">{r.userId ? 'Former user' : 'System'}</span>}
                      </td>
                      <td className="px-4 py-2 text-[13px] text-fg-950">{humanize(r.action)}</td>
                      <td className="px-4 py-2 text-[13px] text-fg-700">
                        {humanize(r.resourceType)}{' '}
                        {href
                          ? <Link to={href} onClick={e => e.stopPropagation()} className="font-mono text-[12px] text-fg-500 hover:underline">{r.resourceId}</Link>
                          : <span className="font-mono text-[12px] text-fg-500">{r.resourceId}</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-50">
                        <td />
                        <td colSpan={4} className="px-4 py-3">
                          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-dense">
                            {r.actor && (<><dt className="text-fg-500">Email</dt><dd className="text-fg-800">{r.actor.email}</dd></>)}
                            {r.ipAddress && (<><dt className="text-fg-500">IP address</dt><dd className="text-fg-800 font-mono">{r.ipAddress}</dd></>)}
                            {r.hash && (<><dt className="text-fg-500">Hash</dt><dd className="text-fg-800 font-mono text-[11px] break-all">{r.hash}</dd></>)}
                          </dl>
                          {Object.keys(r.metadata ?? {}).length > 0 && (
                            <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-surface-200 bg-card p-2 text-[11px] text-fg-800">
                              {JSON.stringify(r.metadata, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
