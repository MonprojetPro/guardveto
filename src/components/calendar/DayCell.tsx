'use client'

import { Lock, Star } from 'lucide-react'
import { GardeBadge } from './GardeBadge'
import type { GardeDenormalisee } from '@/types'

// ── Types ────────────────────────────────────────────────

interface DayCellProps {
  /** Date ISO yyyy-MM-dd, ou null pour les cases de remplissage */
  date: string | null
  /** Garde planifiée ce jour (null si aucune ou si case de remplissage) */
  garde: GardeDenormalisee | null
  estAujourdhui: boolean
  estPasse: boolean
  /** Samedi ou dimanche */
  estWeekend: boolean
  estFerie: boolean
  /** Mode compact (mobile) */
  compact?: boolean
  onClick?: () => void
}

// ── Composant ────────────────────────────────────────────

export function DayCell({
  date,
  garde,
  estAujourdhui,
  estPasse,
  estWeekend,
  estFerie,
  compact,
  onClick,
}: DayCellProps) {
  // Case de remplissage (début/fin de mois)
  if (!date) {
    return (
      <div className="min-h-[64px] md:min-h-[80px] rounded-lg bg-muted/20 border border-border/30" />
    )
  }

  const jour = parseInt(date.split('-')[2])

  // Classes de fond selon l'état
  const classFond = [
    'min-h-[64px] md:min-h-[80px] rounded-lg border p-1.5 md:p-2 flex flex-col gap-1 transition-colors',
    estWeekend && !estPasse ? 'bg-primary/4 border-border/60' : '',
    estWeekend && estPasse ? 'bg-muted/30 border-border/30' : '',
    !estWeekend && estPasse ? 'bg-muted/20 border-border/30' : '',
    !estWeekend && !estPasse ? 'bg-card border-border/50' : '',
    estAujourdhui ? 'ring-2 ring-primary ring-offset-0' : '',
    onClick && garde ? 'cursor-pointer hover:bg-primary/8' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classFond} onClick={garde ? onClick : undefined} role={garde ? 'button' : undefined}>
      {/* En-tête : numéro + icônes */}
      <div className="flex items-center justify-between">
        <span
          className={[
            'text-xs font-semibold leading-none',
            estAujourdhui ? 'text-primary' : '',
            estPasse && !estAujourdhui ? 'text-muted-foreground/60' : 'text-foreground',
          ].join(' ')}
        >
          {jour}
        </span>
        <div className="flex items-center gap-0.5">
          {garde?.verrouille && (
            <Lock
              className="w-3 h-3 text-muted-foreground/50 shrink-0"
              aria-label="Garde verrouillée"
            />
          )}
          {estFerie && (
            <Star
              className="w-3 h-3 text-amber-500 fill-amber-400 shrink-0"
              aria-label="Jour férié"
            />
          )}
        </div>
      </div>

      {/* Badges gardes */}
      {garde && (
        <div className="flex flex-col gap-0.5 min-w-0">
          {garde.premier_prenom && (
            <GardeBadge
              prenom={garde.premier_prenom}
              nom={garde.premier_nom}
              couleur={garde.premier_couleur}
              role="premier"
              compact={compact}
            />
          )}
          {garde.second_prenom && (
            <GardeBadge
              prenom={garde.second_prenom}
              nom={garde.second_nom}
              couleur={garde.second_couleur}
              role="second"
              compact={compact}
            />
          )}
        </div>
      )}
    </div>
  )
}
