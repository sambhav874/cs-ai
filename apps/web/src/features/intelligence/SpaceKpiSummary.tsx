/**
 * What the intelligence tier has extracted across a Space: how many
 * obligations, which side owes them, and what is in breach.
 *
 * A summary, not the KPI workspace: the numbers a person opening a Space wants
 * first, with the per-contract detail one click away on the contract itself.
 */
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { apiJson, INTEL_API } from '@cs/lib/apiClient'
import { EmptyState } from '@/components/ui/primitives'
import { StatusPill } from '@/components/ui/status-pill'

// A Space with no analysed contracts gets a shorter response, so every field
// beyond the counts is optional here.
interface Portfolio {
  totalObligations?: number
  clientSide?: number
  supplierSide?: number
  byRuleType?: Record<string, number> | null
  totalBreaches?: number
  breachesBySource?: Record<string, number> | null
  dollarAtRiskOpen?: number
}

const RULE_LABELS: Record<string, string> = {
  sla: 'Service levels',
  penalty: 'Penalties',
  deadline: 'Deadlines',
  payment: 'Payment',
  reporting: 'Reporting',
  other: 'Other',
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'risk' }) {
  return (
    <div className="rounded-card border border-border bg-card p-4">
      <p className="text-eyebrow uppercase text-fg-500">{label}</p>
      <p className={`mt-1 text-title tabular-nums ${tone === 'risk' ? 'text-risk-700' : 'text-fg-950'}`}>{value}</p>
    </div>
  )
}

export function SpaceKpiSummary({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery<Portfolio>({
    queryKey: ['space-kpis', projectId],
    queryFn: async () => {
      const r = await apiJson<Portfolio>(`${INTEL_API}/projects/${projectId}/kpis/portfolio`)
      if (r.error) throw new Error(r.error)
      return r.data!
    },
    staleTime: 30_000,
  })

  if (isLoading) {
    return <div className="h-40 rounded-card border border-border bg-card animate-pulse" aria-busy="true" aria-label="Loading" />
  }
  if (error || !data) {
    return (
      <div className="rounded-card border border-risk-200 bg-risk-50 p-4 text-dense text-risk-700" role="alert">
        Could not read this Space's obligations. {error instanceof Error ? error.message : ''}
      </div>
    )
  }
  const obligations = data.totalObligations ?? 0
  const breaches = data.totalBreaches ?? 0
  const atRisk = data.dollarAtRiskOpen ?? 0

  if (obligations === 0) {
    return (
      <EmptyState
        title="No obligations extracted yet"
        description="Obligations and service levels appear here once a contract in this Space has been analysed."
      />
    )
  }

  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const rules = Object.entries(data.byRuleType ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-4" data-testid="space-tab-kpis-body">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Obligations" value={String(obligations)} />
        <Metric label="Ours" value={String(data.supplierSide ?? 0)} />
        <Metric label="Counterparty's" value={String(data.clientSide ?? 0)} />
        <Metric label="Open breaches" value={String(breaches)} tone={breaches > 0 ? 'risk' : undefined} />
      </div>

      {atRisk > 0 && (
        <p className="flex items-center gap-2 rounded-card border border-risk-200 bg-risk-50 px-4 py-3 text-dense text-risk-700">
          <AlertTriangle className="size-4 shrink-0" />
          <span><span className="font-medium tabular-nums">{money.format(atRisk)}</span> at risk across open breaches.</span>
        </p>
      )}

      {rules.length > 0 && (
        <div className="rounded-card border border-border bg-card p-4">
          <p className="text-eyebrow uppercase text-fg-500 mb-2.5">By kind</p>
          <ul className="flex flex-wrap gap-2">
            {rules.map(([rule, count]) => (
              <li key={rule}>
                <StatusPill meaning="neutral">
                  {RULE_LABELS[rule] ?? rule} · <span className="tabular-nums">{count}</span>
                </StatusPill>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
