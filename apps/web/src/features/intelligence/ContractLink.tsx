/**
 * One contract, two ids. The lifecycle API names a contract by its own id
 * (/contracts/<id>); the intelligence tier's screens (KPIs, the Space contract
 * list) use that tier's ObjectId. These resolve one to the other through
 * GET /contracts/link/:ref, so a link from either side lands on the right page.
 */
import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink, Navigate, useParams } from 'react-router-dom'
import { apiJson, INTEL_API } from './lib/apiClient'

type Link = { contract_id: string; platform_contract_id: string | null; project_id: string | null }

/** The intelligence tier's ids are Mongo ObjectIds; the lifecycle API's are cuids. */
export const isIntelId = (id: string) => /^[0-9a-f]{24}$/i.test(id)

export function useContractLink(ref: string | undefined) {
  return useQuery({
    queryKey: ['intel-contract-link', ref],
    enabled: !!ref,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await apiJson<Link>(`${INTEL_API}/contracts/link/${encodeURIComponent(ref!)}`)
      if (res.error || !res.data) throw new Error(res.error || 'Not linked')
      return res.data
    },
  })
}

function Resolving() {
  return (
    <div className="p-6 space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-48 rounded-md bg-surface-100 animate-pulse" />
      <div className="h-64 rounded-card bg-surface-100 animate-pulse" />
    </div>
  )
}

function NotLinked({ what }: { what: string }) {
  return (
    <div className="p-6">
      <p className="text-sm text-fg-700">
        {what} isn't available for this contract yet. It appears once the contract has been analysed.
      </p>
    </div>
  )
}

/**
 * /contracts/:id — the lifecycle contract page. An intelligence-tier id (a
 * link from a ported screen) is swapped for the lifecycle id first.
 */
export function ContractRoute({ page }: { page: React.ReactNode }) {
  const { id = '' } = useParams()
  const intel = isIntelId(id)
  const { data, isError } = useContractLink(intel ? id : undefined)
  if (!intel) return <>{page}</>
  if (data?.platform_contract_id) return <Navigate to={`/contracts/${data.platform_contract_id}`} replace />
  if (isError || data) return <NotLinked what="The contract page" />
  return <Resolving />
}

/**
 * /contracts/:contract_id/kpis — the KPI screen takes the intelligence id; a
 * lifecycle id (the contract page's link) is swapped for it first.
 */
export function KpiRoute({ page }: { page: React.ReactNode }) {
  const { contract_id = '' } = useParams()
  const intel = isIntelId(contract_id)
  const { data, isError } = useContractLink(intel ? undefined : contract_id)
  if (intel) return <>{page}</>
  if (data) return <Navigate to={`/contracts/${data.contract_id}/kpis`} replace />
  if (isError) return <NotLinked what="KPI tracking" />
  return <Resolving />
}

/** Contract page link to its KPI screen; hidden until the contract is linked. */
export function KpiRailLink({ contractId }: { contractId: string }) {
  const { data } = useContractLink(contractId || undefined)
  if (!data) return null
  return (
    <RouterLink
      to={`/contracts/${data.contract_id}/kpis`}
      className="flex items-center justify-between rounded-card border border-surface-200 bg-card px-3 py-2 text-dense text-fg-800 hover:bg-surface-50"
      data-testid="contract-kpis-link"
    >
      <span className="font-medium">KPIs and SLAs</span>
      <span className="text-fg-500">Targets, actuals, breaches →</span>
    </RouterLink>
  )
}
