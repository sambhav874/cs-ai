/**
 * useAgentContext (D.1.2 + U.3.1)
 *
 * Reads the current route and returns the agent's "page context" — the
 * thing the user is looking at that the agent should already know about.
 *
 * U.3.1 — extended from contracts-only to also cover matters + counter-
 * parties. The rail's Context chip uses this to show "Focused on …" and
 * the per-resource thread filter uses { type, id } as the scope.
 *
 * Shape:
 *   { type: 'contract' | 'matter' | 'counterparty',
 *     id: string,
 *     label: string,
 *     icon: string,         // emoji
 *     url: string,
 *     scopeType: string,    // matches AgentThread.scopeType in API
 *     scopeId: string }     // matches AgentThread.scopeId
 *
 * Returns null on routes without a meaningful object (dashboard, settings,
 * /agent itself) — the rail falls back to "Your work today" empty state.
 */
import { useMatch } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface AgentContext {
  type: 'contract' | 'matter' | 'counterparty'
  id: string
  label: string
  icon: string
  url: string
  scopeType: string
  scopeId: string
}

export function useAgentContext(): AgentContext | null {
  const contractMatch     = useMatch('/contracts/:id')
  const matterMatch       = useMatch('/matters/:id')
  const counterpartyMatch = useMatch('/counterparties/:id')

  const contractId = contractMatch?.params.id
  const isContract = contractId && contractId !== 'new' && contractId !== 'create'

  const matterId = matterMatch?.params.id
  const isMatter = matterId && matterId !== 'new' && matterId !== 'create'

  const counterpartyId = counterpartyMatch?.params.id
  const isCounterparty = counterpartyId && counterpartyId !== 'new' && counterpartyId !== 'create'

  // Fetch the resource label only when we're actually on that route.
  const { data: contract } = useQuery<{ title: string | null; counterpartyName: string | null }>({
    queryKey: ['agent-context', 'contract', contractId],
    queryFn: () => api.get(`/contracts/${contractId}`).then(r => r.data),
    enabled: !!isContract,
    staleTime: 60_000,
  })
  const { data: matter } = useQuery<{ name: string | null }>({
    queryKey: ['agent-context', 'matter', matterId],
    queryFn: () => api.get(`/matters/${matterId}`).then(r => r.data),
    enabled: !!isMatter,
    staleTime: 60_000,
  })
  const { data: cp } = useQuery<{ name: string | null }>({
    queryKey: ['agent-context', 'counterparty', counterpartyId],
    queryFn: () => api.get(`/counterparties/${counterpartyId}`).then(r => r.data),
    enabled: !!isCounterparty,
    staleTime: 60_000,
  })

  if (isContract) {
    const title = contract?.title?.trim() || 'Contract'
    const label = contract?.counterpartyName
      ? `${title} · ${contract.counterpartyName}`
      : title
    return {
      type: 'contract',
      id: contractId,
      label, icon: '📄',
      url: `/contracts/${contractId}`,
      scopeType: 'contract',
      scopeId: contractId,
    }
  }

  if (isMatter) {
    return {
      type: 'matter',
      id: matterId,
      label: matter?.name?.trim() || 'Matter',
      icon: '📁',
      url: `/matters/${matterId}`,
      scopeType: 'matter',
      scopeId: matterId,
    }
  }

  if (isCounterparty) {
    return {
      type: 'counterparty',
      id: counterpartyId,
      label: cp?.name?.trim() || 'Counterparty',
      icon: '🏢',
      url: `/counterparties/${counterpartyId}`,
      scopeType: 'counterparty',
      scopeId: counterpartyId,
    }
  }

  return null
}
