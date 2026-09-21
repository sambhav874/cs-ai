/**
 * ContractSpacePicker (P4.2 / docs/30 D.7.2)
 *
 * Inline space assignment on the contract detail header. Shows:
 *   • "Add to space" when no assignment
 *   • The space name when assigned (click → detail), with an × to unlink
 *   • A dropdown search-picker when the user clicks "Add to space"
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Briefcase, X, Search } from 'lucide-react'
import { api } from '@/lib/api'

interface SpaceLite {
  id: string
  name: string
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED'
  counterpartyName: string | null
  contractCount: number
}

export function ContractSpacePicker({
  contractId,
  currentSpaceId,
}: {
  contractId: string
  currentSpaceId: string | null
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const { data } = useQuery({
    queryKey: ['spaces-picker'],
    queryFn: async () => (await api.get<{ items: SpaceLite[]; total: number }>('/spaces', {
      params: { status: 'OPEN', limit: 100 },
    })).data,
    enabled: open,
  })

  const currentSpace = useMemo(
    () => (data?.items ?? []).find(m => m.id === currentSpaceId),
    [data, currentSpaceId],
  )

  const assign = useMutation({
    mutationFn: async (spaceId: string | null) => {
      if (spaceId) {
        return api.post(`/spaces/${spaceId}/attach`, { kind: 'contract', entityId: contractId }).then(r => r.data)
      }
      // Unlink — attach to '' isn't supported; use PATCH on contract directly
      return api.patch(`/contracts/${contractId}`, { spaceId: null }).then(r => r.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract', contractId] })
      qc.invalidateQueries({ queryKey: ['space'] })
      qc.invalidateQueries({ queryKey: ['spaces-picker'] })
      setOpen(false)
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items ?? []).filter(m =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      (m.counterpartyName ?? '').toLowerCase().includes(q)
    )
  }, [data, search])

  // If the current space wasn't in the OPEN list (CLOSED or archived),
  // fetch it on-demand.
  const { data: onePick } = useQuery({
    queryKey: ['space-one', currentSpaceId],
    enabled: !!currentSpaceId && !currentSpace,
    queryFn: async () => (await api.get<SpaceLite & { id: string }>(`/spaces/${currentSpaceId}`)).data,
  })
  const effectiveCurrent = currentSpace ?? onePick

  if (effectiveCurrent) {
    return (
      // A space is a human filing cabinet, not machine output — the indigo it
      // used to wear belongs to the assistant, so this is a plain neutral chip.
      <span className="inline-flex items-center gap-1 rounded-full border border-surface-200 bg-surface-100 px-2 py-0.5 text-[10.5px] font-medium text-fg-950"
            data-testid="contract-space-badge"
            data-space-id={effectiveCurrent.id}>
        <Briefcase className="size-3" />
        <Link to={`/spaces/${effectiveCurrent.id}`} className="hover:underline truncate max-w-[180px]">
          {effectiveCurrent.name}
        </Link>
        <button
          type="button"
          onClick={() => assign.mutate(null)}
          title="Unlink from space"
          data-testid="contract-space-unlink"
          className="hover:bg-surface-200 rounded-full p-0.5"
        >
          <X className="size-2.5" />
        </button>
      </span>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="contract-space-add-btn"
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-surface-300 px-2 py-0.5 text-[10.5px] text-muted-foreground hover:text-fg-950 hover:border-fg-400"
      >
        <Briefcase className="size-3" /> Add to space
      </button>
    )
  }

  return (
    <div className="relative">
      <div
        data-testid="contract-space-picker"
        className="absolute top-6 left-0 z-20 w-80 rounded-card border border-border bg-card shadow-e2"
      >
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-2 size-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search open spaces…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-7 pr-2 py-1 text-[12px] rounded-md border border-input bg-card placeholder:text-fg-400 focus:outline-none focus:border-primary-700 focus:ring-[3px] focus:ring-primary-700/15"
              data-testid="contract-space-picker-search"
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto divide-y divide-border">
          {filtered.length === 0 && (
            <li className="px-3 py-3 text-[11.5px] text-muted-foreground italic">
              No matching open spaces. <Link to="/spaces" className="underline">Create one.</Link>
            </li>
          )}
          {filtered.map(m => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => assign.mutate(m.id)}
                data-testid={`contract-space-pick-${m.id}`}
                className="w-full text-left px-3 py-1.5 hover:bg-surface-100 flex items-baseline gap-2"
              >
                <Briefcase className="size-3 text-fg-400 flex-shrink-0" />
                <span className="font-medium text-[12px] text-fg-950 truncate">{m.name}</span>
                {m.counterpartyName && <span className="text-[10.5px] text-muted-foreground truncate">· {m.counterpartyName}</span>}
                <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{m.contractCount}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-2 py-1.5 border-t border-border flex items-center justify-between text-[10.5px]">
          <Link to="/spaces" className="text-fg-950 hover:underline" onClick={() => setOpen(false)}>
            + New space
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-fg-950">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
