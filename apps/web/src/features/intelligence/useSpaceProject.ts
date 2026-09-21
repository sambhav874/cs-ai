/**
 * A Space's intelligence half. The lifecycle API owns the Space; this resolves
 * (and, on first use, creates) the projects document keyed to it, so the
 * memory and timeline panels have something to read.
 */
import { useQuery } from '@tanstack/react-query'
import { apiJson, INTEL_API } from '@cs/lib/apiClient'

export interface SpaceProject {
  _id: string
  name: string
  description?: string | null
}

export function useSpaceProject(spaceId: string | undefined) {
  return useQuery<SpaceProject>({
    queryKey: ['space-project', spaceId],
    enabled: Boolean(spaceId),
    staleTime: 60_000,
    queryFn: async () => {
      const r = await apiJson<SpaceProject>(`${INTEL_API}/projects/by-space/${spaceId}`)
      if (r.error) throw new Error(r.error)
      return r.data!
    },
  })
}
