import axios from 'axios'
import { useAuthStore } from '@/store/auth'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-refresh on 401.
//
// B.5.15 carve-out: the public portal / signer pages live at /portal/:t
// and /sign/:t — their data endpoints under /api/v1/portal/:t return 401
// for bad or expired tokens and we must NOT redirect the user to /login
// in that case (they don't have an account, and the portal page itself
// wants the error so it can render its "Link unavailable" state).
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    const url = (original?.url ?? '').toString()
    const isPortalRequest = url.startsWith('/portal') || url.includes('/api/v1/portal')
    if (error.response?.status === 401 && !original._retry && !isPortalRequest) {
      original._retry = true
      try {
        await useAuthStore.getState().refresh()
        const token = useAuthStore.getState().accessToken
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      } catch {
        useAuthStore.getState().logout()
        // B.6.20 — preserve the page the user was on so we can restore
        // it after a successful re-login. Skip on /login itself
        // (avoids ?next=/login weirdness) and on the portal routes we
        // already excluded above.
        const pathname = window.location.pathname + window.location.search
        const isAuthPage =
          window.location.pathname === '/login' ||
          window.location.pathname === '/register'
        const next = !isAuthPage && pathname.length > 1
          ? `?next=${encodeURIComponent(pathname)}`
          : ''
        window.location.href = `/login${next}`
      }
    }
    return Promise.reject(error)
  }
)
