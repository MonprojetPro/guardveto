'use client'

// ============================================================
// GUARDVETO — « + Nouveau planning » : la porte unique (B-172)
// ============================================================
// Avant B-172, on créait un planning par TROIS chemins : le menu des
// plannings, « Générer › Je fais un nouveau planning », et l'icône « Dates
// libres » de la fenêtre des journées. Trois portes pour un même geste, et
// aucune ne disait que les deux autres existaient.
//
// Il n'en reste qu'une, et elle pose LA question qui distingue les deux
// chemins : qu'est-ce que ce planning va contenir ? Un planning de gardes
// porte aussi des journées ; un planning de journées seules n'a pas de garde,
// pas de période type, et peut chevaucher les plannings de gardes (B-162).
//
// N'est montrée que si le cabinet a LES DEUX modules : avec un seul, il n'y a
// rien à choisir, et la porte mène droit au bon formulaire.
// ============================================================

import { CalendarPlus, CalendarRange } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  onGardes: () => void
  onJournees: () => void
}

export function ChoixNouveauPlanning({ open, onOpenChange, onGardes, onJournees }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gv-modale gv-parcours">
        <DialogHeader>
          <p className="gm-kicker">Nouveau planning</p>
          <DialogTitle>Que va contenir ce planning ?</DialogTitle>
          <DialogDescription>
            On choisit les dates juste après.
          </DialogDescription>
        </DialogHeader>

        <div className="gen-choix">
          <button type="button" className="gen-carte" onClick={onGardes}>
            <CalendarPlus className="gen-carte-ico" aria-hidden="true" />
            <span className="gen-carte-titre">Des gardes, et les journées</span>
            <span className="gen-carte-sous">
              Des dates et une période type. Le moteur génère les gardes, puis tu
              remplis les journées sur le même planning.
            </span>
          </button>

          <button type="button" className="gen-carte" onClick={onJournees}>
            <CalendarRange className="gen-carte-ico" aria-hidden="true" />
            <span className="gen-carte-titre">Des journées seules</span>
            <span className="gen-carte-sous">
              Pas de garde : seulement qui est présent au cabinet, sur les dates de
              ton choix.
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
