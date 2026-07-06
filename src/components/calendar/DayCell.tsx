'use client'

import { Lock, Star } from 'lucide-react'
import { GardeBadge } from './GardeBadge'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import type { GardeDenormalisee } from '@/types'

// ── Types ────────────────────────────────────────────────

interface DayCellProps {
  /** Date ISO yyyy-MM-dd, ou null pour les cases de remplissage */
  date: string | null
  /**
   * Gardes planifiées ce jour (P3b : plusieurs créneaux peuvent coexister —
   * ex. garde de jour + garde de nuit). Vide si aucune ou case de remplissage.
   */
  gardes: GardeDenormalisee[]
  estAujourdhui: boolean
  estPasse: boolean
  /** Samedi ou dimanche */
  estWeekend: boolean
  estFerie: boolean
  /** Mode compact (mobile) */
  compact?: boolean
  /** Libellés catalogue (code → nom) pour les types sur-mesure. */
  nomsTypes?: Record<string, string>
  /** Clic sur UNE garde précise du jour (chaque garde est cliquable). */
  onClickGarde?: (garde: GardeDenormalisee) => void
}

// ── Composant ────────────────────────────────────────────

export function DayCell({
  date,
  gardes,
  estAujourdhui,
  estPasse,
  estWeekend,
  estFerie,
  compact,
  nomsTypes,
  onClickGarde,
}: DayCellProps) {
  // Case de remplissage (début/fin de mois)
  if (!date) {
    return (
      <div className="min-h-[64px] md:min-h-[80px] rounded-lg bg-muted/20 border border-border/30" />
    )
  }

  const jour = parseInt(date.split('-')[2])
  const aDesGardes = gardes.length > 0
  const plusieurs = gardes.length > 1

  // Classes de fond selon l'état
  const classFond = [
    'min-h-[64px] md:min-h-[80px] rounded-lg border p-1.5 md:p-2 flex flex-col gap-1 transition-colors',
    estWeekend && !estPasse ? 'bg-primary/10 border-primary/20' : '',
    estWeekend && estPasse ? 'bg-muted/30 border-border/30' : '',
    !estWeekend && estPasse ? 'bg-muted/20 border-border/30' : '',
    !estWeekend && !estPasse ? 'bg-card border-border/50' : '',
    estAujourdhui ? 'ring-2 ring-primary ring-offset-0' : '',
    onClickGarde && aDesGardes && !plusieurs ? 'cursor-pointer hover:bg-primary/8' : '',
  ].filter(Boolean).join(' ')

  const verrouille = gardes.some((g) => g.verrouille)

  return (
    <div
      className={classFond}
      // Une seule garde : toute la case est cliquable (comportement historique).
      // Plusieurs : chaque garde a sa propre zone cliquable ci-dessous.
      onClick={!plusieurs && aDesGardes && onClickGarde ? () => onClickGarde(gardes[0]) : undefined}
      role={!plusieurs && aDesGardes ? 'button' : undefined}
    >
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
          {verrouille && (
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

      {/* Badges gardes — un groupe par garde du jour */}
      {gardes.map((garde) => (
        <div
          key={garde.id}
          className={[
            'flex flex-col gap-0.5 min-w-0',
            plusieurs ? 'rounded-md -mx-0.5 px-0.5 py-0.5' : '',
            plusieurs && onClickGarde ? 'cursor-pointer hover:bg-primary/8' : '',
          ].filter(Boolean).join(' ')}
          onClick={plusieurs && onClickGarde
            ? (e) => { e.stopPropagation(); onClickGarde(garde) }
            : undefined}
          role={plusieurs ? 'button' : undefined}
        >
          {/* Étiquette du type quand la case porte plusieurs gardes */}
          {plusieurs && (
            <span className="text-[10px] leading-none text-muted-foreground truncate">
              {libelleTypeGardeDb(garde.type, nomsTypes)}
            </span>
          )}
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
      ))}
    </div>
  )
}
