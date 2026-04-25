'use client'

// ============================================================
// GUARDVETO — ViolationDialog
// ============================================================
// Dialog de confirmation quand l'admin assigne un vétérinaire
// qui viole une règle (dure ou souple).
//
//   type='dure'   → fond rouge — bouton "Forcer quand même"
//   type='souple' → fond orange — bouton "Accepter"
// ============================================================

import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

// ── Types ────────────────────────────────────────────────

interface ViolationDialogProps {
  open: boolean
  type: 'dure' | 'souple'
  /** Message de violation (raison ou warning, préfixe Rxx retiré) */
  message: string
  /** Prénom du vétérinaire concerné */
  vetPrenom: string
  /** Appelé quand l'admin confirme (Forcer / Accepter) */
  onAccept: () => void
  /** Appelé quand l'admin annule */
  onAnnuler: () => void
}

// ── Composant ────────────────────────────────────────────

export function ViolationDialog({
  open,
  type,
  message,
  vetPrenom,
  onAccept,
  onAnnuler,
}: ViolationDialogProps) {
  const isDure = type === 'dure'

  const couleurBadge = isDure
    ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
    : 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'

  const couleurTitreBadge = isDure
    ? 'text-red-800 dark:text-red-300'
    : 'text-amber-800 dark:text-amber-300'

  const couleurDescBadge = isDure
    ? 'text-red-700 dark:text-red-400'
    : 'text-amber-700 dark:text-amber-400'

  const couleurBouton = isDure
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-amber-600 hover:bg-amber-700 text-white'

  const Icon = isDure ? ShieldAlert : AlertTriangle

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onAnnuler() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${isDure ? 'text-red-500' : 'text-amber-500'}`} />
            {isDure ? 'Règle obligatoire violée' : 'Règle de confort non respectée'}
          </DialogTitle>
        </DialogHeader>

        {/* Détail de la violation */}
        <div className={`rounded-lg border p-3 space-y-1 ${couleurBadge}`}>
          <p className={`text-sm font-semibold ${couleurTitreBadge}`}>{vetPrenom}</p>
          <p className={`text-xs leading-relaxed ${couleurDescBadge}`}>{message}</p>
        </div>

        {/* Explication */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {isDure
            ? 'Cette assignation viole une contrainte obligatoire. Voulez-vous forcer l\'assignation malgré tout ?'
            : 'Cette assignation ne respecte pas une contrainte de confort. Voulez-vous continuer quand même ?'}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onAnnuler}>
            Annuler
          </Button>
          <Button className={couleurBouton} onClick={onAccept}>
            {isDure ? 'Forcer quand même' : 'Accepter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
