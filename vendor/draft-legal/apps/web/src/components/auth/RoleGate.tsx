import { usePermission } from '@/lib/permissions'

interface RoleGateProps {
  action: string
  resource: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGate({ action, resource, children, fallback = null }: RoleGateProps) {
  const hasPermission = usePermission(action, resource)
  return hasPermission ? <>{children}</> : <>{fallback}</>
}
