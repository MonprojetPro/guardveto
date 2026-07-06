'use client'

// ============================================================
// GUARDVETO — ConflitPlanningDialog (LOT A4)
// ============================================================
// Alerte affichée APRÈS qu'un admin a rendu un congé EFFECTIF (validation d'un
// souhait, ou création d'un congé déjà validé) qui CHEVAUCHE une ou plusieurs
// gardes d'un planning DÉJÀ PUBLIÉ pour ce véto.
//
// C'est le « cas Antoine » : poser un congé sur un véto déjà de garde ne doit
// plus passer silencieusement. Le congé EST enregistré (choix admin assumé),
// mais le planning publié ne se met PAS à jour tout seul — il faut le réparer.
//
// HONNÊTETÉ UX : on ne fait croire à aucune réparation automatique. Deux choix :
//   • « Laisser tel quel » : l'admin assume, ferme l'alerte ;
//   • « Gérer maintenant » : ouvre la CriseModal EXISTANTE (flux de réparation),
//     pré-remplie avec le véto + les dates du conflit.
// ============================================================

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import { humaniserCodeGarde } from '@/lib/libelles-gardes'

// ── Helpers de formatage FR ──────────────────────────────

function formatDateFr(dateIso: string): string {
  return new Date(dateIso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function labelType(type: CreneauImpacte['type']): string {
  if (type === 'weekend') return 'Week-end'
  if (type === 'ferie') return 'Jour férié'
  if (type === 'semaine') return 'Soir de semaine'
  // Type SUR-MESURE (P3b) : son nom humanisé.
  return humaniserCodeGarde(type)
}

function labelRole(role: CreneauImpacte['role']): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

// ── Props ────────────────────────────────────────────────

interface ConflitPlanningDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Nom complet du véto concerné (pour le message). */
  vetNom: string
  /** Gardes publiées impactées par le congé (renvoyées par la server action). */
  creneauxImpactes: CreneauImpacte[]
  /** « Gérer maintenant » → ouvre la CriseModal pré-remplie. */
  onGerer: () => void
}

// ── Composant ────────────────────────────────────────────

export function ConflitPlanningDialog({
  open,
  onOpenChange,
  vetNom,
  creneauxImpactes,
  onGerer,
}: ConflitPlanningDialogProps) {
  const nb = creneauxImpactes.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" aria-hidden />
            Conflit avec le planning publié
          </DialogTitle>
          <DialogDescription>
            Ce congé chevauche {nb} garde{nb > 1 ? 's' : ''} déjà publiée
            {nb > 1 ? 's' : ''} pour <strong>{vetNom}</strong>. Le planning ne se
            met pas à jour tout seul — il faut décider quoi en faire.
          </DialogDescription>
        </DialogHeader>

        {/* Liste des gardes impactées */}
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {creneauxImpactes.map((c) => (
            <li
              key={`${c.gardeId}|${c.role}`}
              className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/20"
            >
              <span className="font-medium text-foreground capitalize">
                {formatDateFr(c.date)}
              </span>
              <span className="text-xs text-muted-foreground">
                {labelType(c.type)} · {labelRole(c.role)}
              </span>
            </li>
          ))}
        </ul>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Laisser tel quel
          </Button>
          <Button
            onClick={onGerer}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            Gérer maintenant (réparer le planning)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
