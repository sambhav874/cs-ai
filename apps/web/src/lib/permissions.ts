import { useAuthStore } from '@/store/auth'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Permission {
  action: string
  resource: string
  scope: string
}

interface Role {
  id: string
  orgId?: string
  name: string
  description?: string
  permissions: Permission[]
  isSystem: boolean
}

// Fetch roles+permissions from API, cached
export function useRoles() {
  return useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: () => api.get('/admin/users/roles').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
}

// Check if current user has a specific permission
export function usePermission(action: string, resource: string): boolean {
  const userRoleNames = useAuthStore(s => s.user?.roles ?? []) as string[]
  const { data: roleData } = useRoles()

  // ADMIN always has full access — check role name directly (no API dependency)
  if (userRoleNames.includes('ADMIN')) return true

  if (!roleData) return false

  const userRoles = roleData.filter(r => userRoleNames.includes(r.name))
  return userRoles.some(r =>
    r.permissions.some(p =>
      (p.action === '*' || p.action === action) &&
      (p.resource === '*' || p.resource === resource)
    )
  )
}
