import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import type { User } from '@clm/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean

  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; password: string; name: string; orgName: string }) => Promise<void>
  refresh: () => Promise<void>
  logout: () => void
  setUser: (user: User) => void
}

let inflightRefresh: Promise<void> | null = null

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      login: async (email, password) => {
        const { data } = await axios.post('/api/v1/auth/login', { email, password })
        set({
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          isAuthenticated: true,
        })
      },

      register: async (body) => {
        const { data } = await axios.post('/api/v1/auth/register', {
          ...body,
          orgName: body.orgName,
        })
        set({
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          isAuthenticated: true,
        })
      },

      // Single-flight. A page fires many requests at once; when the access
      // token expires they all 401 together. Refresh tokens rotate, so if each
      // refreshed on its own the first would revoke the token the others are
      // still sending, they would 401, and the user would be logged out. They
      // all await the one refresh in flight instead.
      refresh: () => {
        if (inflightRefresh) return inflightRefresh
        inflightRefresh = (async () => {
          const { refreshToken } = get()
          if (!refreshToken) throw new Error('No refresh token')
          const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken })
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken })
        })().finally(() => { inflightRefresh = null })
        return inflightRefresh
      },

      logout: () => {
        const { accessToken } = get()
        if (accessToken) {
          axios.post('/api/v1/auth/logout', {}, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }).catch(() => {})
        }
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
      },

      setUser: (user) => set({ user }),
    }),
    {
      name: 'clm-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
