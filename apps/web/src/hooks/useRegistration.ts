import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Registration {
  /** open: anyone may sign up; first-user: only until the first account exists (self-host); closed: invites only. */
  mode: 'open' | 'first-user' | 'closed'
  open: boolean
}

/** Whether this instance takes sign-ups. Unknown (loading, or an older API) reads as open. */
export function useRegistration(): Registration {
  const { data } = useQuery<Registration>({
    queryKey: ['auth-registration'],
    queryFn: () => api.get('/auth/registration').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })
  return data ?? { mode: 'open', open: true }
}
