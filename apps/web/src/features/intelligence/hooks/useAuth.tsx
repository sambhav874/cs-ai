/**
 * Hand-written replacement for ContractSense's useAuth: the same shape, backed
 * by the SPA's login (store/auth). There is one login now; ContractSense's own
 * sign-in, cookie session and /users/me polling are gone.
 */
import { useCallback } from 'react'
import { useAuthStore } from '@/store/auth'
import { apiFetch } from '@cs/lib/apiClient'

type ApiResult = { data?: any; error?: string }

export const useAuth = () => {
  const token = useAuthStore((s) => s.accessToken)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const storeLogout = useAuthStore((s) => s.logout)

  const logout = useCallback(() => {
    storeLogout()
    window.location.href = '/login'
  }, [storeLogout])

  const authenticatedFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<ApiResult> => {
    if (!token) return { error: 'Not authenticated' }
    try {
      const response = await apiFetch(url, options)
      if (response.status === 401) {
        logout()
        return { error: 'Authentication failed' }
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        return { error: errorData?.detail || `Request failed with status ${response.status}` }
      }
      if (response.status === 204) return { data: null }
      return { data: await response.json() }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unknown error occurred' }
    }
  }, [token, logout])

  return { token, isAuthenticated, authChecked: true, logout, authenticatedFetch }
}
