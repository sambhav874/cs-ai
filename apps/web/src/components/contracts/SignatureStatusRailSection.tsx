/**
 * SignatureStatusRailSection (Phase 07) — wraps SignatureStatus in a
 * RailSection so it slots cleanly into the existing right-rail rhythm.
 * Auto-hides when there are no signature requests on the contract.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { RailSection } from '@/components/contracts/RailSection'
import { SignatureStatus } from '@/components/contracts/SignatureStatus'

export function SignatureStatusRailSection({
  contractId,
  onChanged,
}: {
  contractId: string
  onChanged?: () => void
}) {
  // Lightweight presence-check query so we know whether to render the
  // section header at all. Cheap (just count). The full SignatureStatus
  // does its own fetch with poll.
  const { data } = useQuery<{ data: Array<{ id: string; status: string }> }>({
    queryKey: ['signature-requests', contractId],
    queryFn: () => api.get(`/contracts/${contractId}/signature-requests`).then(r => r.data),
    staleTime: 5_000,
  })
  const list = data?.data ?? []
  if (list.length === 0) return null

  // Default-open if there's an active (PENDING) request — that's the
  // info the user most wants visible.
  const hasPending = list.some(r => r.status === 'PENDING')
  const pendingCount = list.filter(r => r.status === 'PENDING').length

  return (
    <RailSection
      title="Signatures"
      count={pendingCount > 0 ? `${pendingCount} pending` : list.length}
      defaultOpen={hasPending}
    >
      <div className="px-5 pb-4">
        <SignatureStatus contractId={contractId} onChanged={onChanged} />
      </div>
    </RailSection>
  )
}
