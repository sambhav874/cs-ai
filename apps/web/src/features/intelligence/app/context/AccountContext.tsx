/**
 * Hand-written replacement for ContractSense's AccountContext.
 *
 * ContractSense let a user switch between a personal space and team accounts.
 * On the platform every user belongs to one organisation, which the identity
 * adapter maps to one team, so the selected account is always that team: its
 * id comes from /users/me (teamIds[0]). There is no personal space.
 */
import React, { createContext, useContext, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiJson, INTEL_API } from '@cs/lib/apiClient'

type AccountContextType = {
  selectedAccountId: string
  setSelectedAccount: (accountId: string) => void
  isInitialized: boolean
}

const AccountContext = createContext<AccountContextType>({
  selectedAccountId: '',
  setSelectedAccount: () => {},
  isInitialized: false,
})

export function useIntelligenceMe() {
  return useQuery({
    queryKey: ['intel', 'me'],
    queryFn: async () => {
      const r = await apiJson<{ _id?: string; id?: string; teamIds?: string[] }>(`${INTEL_API}/users/me/`)
      if (r.error) throw new Error(r.error)
      return r.data!
    },
    staleTime: 60_000,
  })
}

export const AccountProvider = ({ children }: { children: React.ReactNode }) => {
  const { data, isFetched } = useIntelligenceMe()
  const value = useMemo(
    () => ({
      selectedAccountId: data?.teamIds?.[0] ?? '',
      setSelectedAccount: () => {},
      isInitialized: isFetched,
    }),
    [data, isFetched],
  )
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export const useAccountContext = () => useContext(AccountContext)
