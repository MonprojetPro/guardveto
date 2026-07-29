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
  const Icon = isDure ? ShieldAlert : AlertTriangle

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onAnnuler() }}>
      <DialogContent className="gv-modale">
        <DialogHeader>
          <p className="gm-kicker">Garde · garde-fou</p>
          <DialogTitle>
            {isDure ? 'Règle obligatoire non respectée' : 'Règle de confort non respectée'}
          </DialogTitle>
        </DialogHeader>

        {/* Détail de la violation — la carte de la maquette, teintée selon
            qu'il s'agit d'une règle dure (rouge) ou souple (ambre). */}
        <div className={`gf-card ${isDure ? 'dure' : 'souple'}`}>
          <p className="gf-title">
            <Icon className="w-3.5 h-3.5" />
            {vetPrenom}
          </p>
          {message}
        </div>

        <p className="text-sm text-muted-foreground">
          {isDure
            ? 'Cette affectation enfreint une contrainte obligatoire. Tu peux passer outre, ce sera consigné.'
            : 'Cette affectation ne respecte pas une contrainte de confort. On continue quand même ?'}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onAnnuler}>
            Annuler
          </Button>
          <Button onClick={onAccept}>
            {isDure ? 'Passer outre' : 'Accepter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
