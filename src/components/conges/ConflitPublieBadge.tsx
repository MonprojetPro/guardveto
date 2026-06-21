'use client'

// ============================================================
// GUARDVETO — Badge « chevauche une garde publiée » (LOT A5-lite)
// ============================================================
// Pastille d'AVERTISSEMENT affichée sur une demande de congé/indispo EN ATTENTE
// dont la plage chevauche une ou plusieurs gardes d'un planning DÉJÀ PUBLIÉ pour
// ce véto. Objectif : que l'admin VOIE le conflit AVANT de valider (le pont A4
// n'alertait qu'au moment de la validation).
//
// Lecture seule, purement présentationnel : reçoit les créneaux déjà calculés
// côté serveur (cf. detecterConflitPlanningPublie / recenserCreneauxImpactes).
// Aucun fetch, aucune mutation.
// ============================================================

import { AlertTriangle } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { CreneauImpacte } from '@/lib/crise/contexte'

const ROLE_LABELS: Record<CreneauImpacte['role'], string> = {
  premier: '1er',
  second: '2nd',
}

function formatDateCourte(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
}

/** Libellé court d'un créneau impacté : « lun. 12 janv. · 1er ». */
function libelleCreneau(c: CreneauImpacte): string {
  return `${formatDateCourte(c.date)} · ${ROLE_LABELS[c.role]}`
}

interface ConflitPublieBadgeProps {
  /** Gardes publiées chevauchées (jamais vide quand le badge est rendu). */
  creneaux: CreneauImpacte[]
  /** Compacte le badge (icône + nombre, libellé court) pour les lignes denses. */
  className?: string
}

/**
 * Badge ambre-rouge « ⚠️ Chevauche N garde(s) publiée(s) ». Au survol, la liste
 * courte des créneaux (date FR + rôle). La même liste est rendue en dessous pour
 * rester lisible au tactile (pas de hover).
 */
export function ConflitPublieBadge({ creneaux, className }: ConflitPublieBadgeProps) {
  if (creneaux.length === 0) return null
  const n = creneaux.length

  return (
    <TooltipProvider>
      <Tooltip>
        {/* Trigger = bouton non-actionnable (type=button, aucun onClick) : il ne
            sert qu'à ouvrir le tooltip au survol / focus clavier. */}
        <TooltipTrigger
          type="button"
          className={
            'inline-flex items-center gap-1 rounded-md border border-amber-300 ' +
            'bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ' +
            'cursor-help select-none ' +
            (className ?? '')
          }
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
          <span>
            Chevauche {n} garde{n > 1 ? 's' : ''} publiée{n > 1 ? 's' : ''}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="flex flex-col gap-0.5 text-left">
            <span className="font-semibold">Gardes publiées concernées</span>
            {creneaux.map((c) => (
              <span key={`${c.gardeId}-${c.role}`}>{libelleCreneau(c)}</span>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
