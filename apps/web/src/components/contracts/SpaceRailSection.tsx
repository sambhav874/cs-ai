/**
 * SpaceRailSection (P7.4.2 / F-42)
 *
 * Surfaces the contract's parent space on the rail. Without this the
 * user has to know to look at the small header "Add to space" pill —
 * which is easy to miss + doesn't tell you anything about siblings.
 *
 * Renders only when the contract IS in a space. The "add to space"
 * empty path stays in the header (B.5.x ContractSpacePicker) where
 * it doesn't compete with the rich Space card here.
 *
 * Layout (compact):
 *   ┌─────────────────────────────────────┐
 *   │ MATTER                          OPEN │
 *   │ ──────────────────────────────────── │
 *   │ 🛍 Zynga MSA — multi-year SaaS …     │  ← name, links to /spaces/:id
 *   │ Master Services Agreement and all …  │  ← description (2 lines)
 *   │ ──────────────────────────────────── │
 *   │ 4 contracts · 0 requests · 0 threads │  ← sibling counts
 *   │ Counterparty: Zynga Holdings         │
 *   │ Owner: Maya Goldberg                 │
 *   │ #enterprise #saas #priority          │  ← tags
 *   └─────────────────────────────────────┘
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { RailSection } from '@/components/contracts/RailSection'
import { StatusPill } from '@/components/ui/status-pill'
import { Briefcase, Building2, User as UserIcon, ArrowRight } from 'lucide-react'

// Shape returned by GET /api/v1/spaces/:id — nested arrays + owner
// object, NOT pre-aggregated counts. We derive counts from .length.
interface SpaceDetail {
  id: string
  name: string
  description?: string | null
  status: string
  counterpartyName?: string | null
  owner?: { id: string; name: string } | null
  tags?: string[]
  contracts?: Array<{ id: string }>
  requests?: Array<{ id: string }>
  threads?: Array<{ id: string }>
}

export function SpaceRailSection({ spaceId }: { spaceId: string | null | undefined }) {
  const { data: space, isLoading } = useQuery<SpaceDetail>({
    queryKey: ['space-rail', spaceId],
    queryFn: () => api.get(`/spaces/${spaceId}`).then(r => r.data),
    enabled: !!spaceId,
    staleTime: 30_000,
  })

  // No matter → don't render. The "Add to space" pill in the header
  // is the empty-state surface; we don't compete with it here.
  if (!spaceId) return null
  if (isLoading || !space) {
    // Show a tiny placeholder so the rail layout doesn't shift on load
    return (
      <RailSection title="Space" defaultOpen count={null}>
        <div className="text-[11px] text-muted-foreground italic">Loading…</div>
      </RailSection>
    )
  }

  const contractCount = space.contracts?.length ?? 0
  const requestCount  = space.requests?.length ?? 0
  const threadCount   = space.threads?.length ?? 0
  const siblingContracts = Math.max(0, contractCount - 1)

  return (
    <RailSection title="Space" defaultOpen count={null}>
      <div className="space-y-2" data-testid="space-rail-section">
        {/* Space name + status */}
        <div className="flex items-start justify-between gap-2">
          <Link
            to={`/spaces/${space.id}`}
            data-testid="space-rail-link"
            className="flex items-start gap-1.5 text-[12.5px] font-medium text-fg-950 hover:text-primary-700 leading-tight min-w-0"
          >
            <Briefcase className="size-3.5 text-fg-400 mt-0.5 shrink-0" />
            <span className="truncate">{space.name}</span>
          </Link>
          <StatusPill
            status={space.status}
            className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wider"
          >
            {space.status}
          </StatusPill>
        </div>

        {/* Description */}
        {space.description && (
          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
            {space.description}
          </p>
        )}

        {/* Sibling counts */}
        <div className="text-[11px] text-fg-700 flex items-center gap-1.5 flex-wrap">
          {siblingContracts > 0 ? (
            <Link
              to={`/spaces/${space.id}`}
              className="text-fg-950 font-medium hover:underline inline-flex items-center gap-0.5"
              data-testid="space-siblings-link"
            >
              {siblingContracts} other {siblingContracts === 1 ? 'contract' : 'contracts'} in this space
              <ArrowRight className="size-3" />
            </Link>
          ) : (
            <span className="text-muted-foreground">Only contract in this space</span>
          )}
          {requestCount > 0 && (
            <span className="text-muted-foreground">· {requestCount} {requestCount === 1 ? 'request' : 'requests'}</span>
          )}
          {threadCount > 0 && (
            <span className="text-muted-foreground">· {threadCount} {threadCount === 1 ? 'thread' : 'threads'}</span>
          )}
        </div>

        {/* Counterparty + Owner */}
        <div className="space-y-0.5">
          {space.counterpartyName && (
            <div className="text-[11px] text-fg-700 flex items-center gap-1">
              <Building2 className="size-3 text-fg-400" />
              <span className="truncate">{space.counterpartyName}</span>
            </div>
          )}
          {space.owner?.name && (
            <div className="text-[11px] text-fg-700 flex items-center gap-1">
              <UserIcon className="size-3 text-fg-400" />
              <span className="truncate">{space.owner.name}</span>
            </div>
          )}
        </div>

        {/* Tags */}
        {(space.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {space.tags!.slice(0, 6).map(t => (
              <span
                key={t}
                className="inline-flex items-center text-[9.5px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded-chip bg-surface-100 text-fg-700 border border-surface-200"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </RailSection>
  )
}
