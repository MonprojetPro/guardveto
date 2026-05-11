'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, type Veterinaire } from '@/types'
import {
  Calendar,
  CalendarOff,
  CalendarRange,
  BarChart3,
  Users,
  Inbox,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Calendar,
  CalendarOff,
  CalendarRange,
  BarChart3,
  Users,
  Inbox,
}

interface SidebarProps {
  veterinaire: Veterinaire
  nbSouhaits?: number
}

export function Sidebar({ veterinaire, nbSouhaits = 0 }: SidebarProps) {
  const pathname = usePathname()

  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles.includes(veterinaire.role_app)
  )

  return (
    <aside className="hidden md:flex flex-col w-56 border-r border-border bg-card shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center px-5 border-b border-border">
        <span className="font-heading font-bold text-primary text-xl">GuardVeto</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {visibleItems.map(item => {
          const Icon = ICONS[item.icon]
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          const showBadge = (item.href === '/admin/demandes' || item.href === '/conges') && nbSouhaits > 0
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {Icon && <Icon className="w-4 h-4 shrink-0" />}

              <span className="flex-1">{item.label}</span>

              {showBadge && (
                <span
                  className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                  style={{ backgroundColor: 'var(--warning)' }}
                >
                  {nbSouhaits > 9 ? '9+' : nbSouhaits}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Veto info en bas */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: veterinaire.couleur }}
          >
            {veterinaire.prenom.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {veterinaire.prenom} {veterinaire.nom}
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {veterinaire.statut}
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}
