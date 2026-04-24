import type { UserRole, Veterinaire } from '@/types'

interface RoleGateProps {
  veterinaire: Veterinaire
  allowedRoles: UserRole[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGate({ veterinaire, allowedRoles, children, fallback = null }: RoleGateProps) {
  if (!allowedRoles.includes(veterinaire.role_app)) {
    return <>{fallback}</>
  }
  return <>{children}</>
}
