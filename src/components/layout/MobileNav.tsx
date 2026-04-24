'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, type Veterinaire } from '@/types'
import {
  Calendar,
  CalendarOff,
  BarChart3,
  Settings,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Calendar,
  CalendarOff,
  BarChart3,
  Settings,
  FileText,
}

interface MobileNavProps {
  veterinaire: Veterinaire
}

export function MobileNav({ veterinaire }: MobileNavProps) {
  const pathname = usePathname()

  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles.includes(veterinaire.role_app)
  )

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border">
      <div className="flex items-center justify-around h-16 px-2 safe-area-pb">
        {visibleItems.map(item => {
          const Icon = ICONS[item.icon]
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            >
              {Icon && <Icon className="w-5 h-5" />}
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
