'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, type Veterinaire } from '@/types'
import {
  Calendar,
  CalendarOff,
  CalendarRange,
  BarChart3,
  Clock,
  Inbox,
  LifeBuoy,
  MoreHorizontal,
  ScrollText,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Calendar,
  CalendarOff,
  CalendarRange,
  BarChart3,
  Clock,
  Inbox,
  LifeBuoy,
  ScrollText,
  Users,
}

// Au-delà de 5 entrées, une bottom-nav devient illisible : on garde les 4
// premières (communes admin/veto) et le reste passe sous un onglet « Plus ».
const MAX_ITEMS_BARRE = 4

interface MobileNavProps {
  veterinaire: Veterinaire
}

export function MobileNav({ veterinaire }: MobileNavProps) {
  const pathname = usePathname()
  const [plusOuvert, setPlusOuvert] = useState(false)

  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles.includes(veterinaire.role_app)
  )

  const aDebordement = visibleItems.length > MAX_ITEMS_BARRE + 1
  const itemsBarre = aDebordement ? visibleItems.slice(0, MAX_ITEMS_BARRE) : visibleItems
  const itemsPlus = aDebordement ? visibleItems.slice(MAX_ITEMS_BARRE) : []

  const estActif = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')
  const plusActif = itemsPlus.some(item => estActif(item.href))

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border">
      {plusOuvert && itemsPlus.length > 0 && (
        <div className="border-b border-border bg-card px-2 py-2 grid grid-cols-3 gap-1">
          {itemsPlus.map(item => {
            const Icon = ICONS[item.icon]
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setPlusOuvert(false)}
                className={cn(
                  'flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-h-[44px] justify-center',
                  estActif(item.href) ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {Icon && <Icon className="w-5 h-5" />}
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
              </Link>
            )
          })}
        </div>
      )}
      <div className="flex items-center justify-around h-16 px-2 safe-area-pb">
        {itemsBarre.map(item => {
          const Icon = ICONS[item.icon]
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setPlusOuvert(false)}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center',
                estActif(item.href) ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {Icon && <Icon className="w-5 h-5" />}
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </Link>
          )
        })}
        {itemsPlus.length > 0 && (
          <button
            type="button"
            onClick={() => setPlusOuvert(o => !o)}
            aria-expanded={plusOuvert}
            aria-label="Plus de pages"
            className={cn(
              'flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center',
              plusActif || plusOuvert ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">Plus</span>
          </button>
        )}
      </div>
    </nav>
  )
}
