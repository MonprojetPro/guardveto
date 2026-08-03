'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { validerConge, type ConflitPlanning } from '@/app/(protected)/conges/actions'
import { GardienImpact } from '@/components/v2/GardienImpact'
import type { Impact } from '@/data/controleImpact'
import type { VetEtiquette } from '@/components/planning/PointPreVol'
import type { Conge, Veterinaire } from '@/types'

interface ValiderCongeDialogProps {
  open: boolean
  onClose: () => void
  conge: Conge
  vet: Veterinaire | undefined
  currentVetoId: string
  /**
   * Appelé quand la validation a détecté un conflit avec un planning publié
   * (cas « Antoine »). Le parent ouvre alors l'alerte ConflitPlanningDialog.
   */
  onConflit?: (conflit: ConflitPlanning) => void
  /** Vétérinaires actifs — les gestes de correction sur étiquette en ont besoin. */
  vetsActifs?: VetEtiquette[]
}

export function ValiderCongeDialog({
  open, onClose, conge, vet, currentVetoId, onConflit, vetsActifs = [],
}: ValiderCongeDialogProps) {
  const [isPending, startTransition] = useTransition()
  const [dateDebut, setDateDebut] = useState(conge.date_debut)
  const [dateFin, setDateFin] = useState(conge.date_fin)
  // Le refus du contrôle d'impact, quand il y en a un : il ouvre la fenêtre de
  // Filou, qui porte les gestes de correction (palier 3 de l'audit du
  // 2026-08-03). Avant, ce refus tombait en toast — correct, et muet sur la
  // suite à donner.
  const [impact, setImpact] = useState<Impact | null>(null)

  const lancer = (confirme: boolean) => {
    startTransition(async () => {
      const result = await validerConge(conge.id, currentVetoId, dateDebut, dateFin, confirme)
      if (result.error) {
        // Un refus PORTEUR d'impact s'explique en fenêtre ; les autres restent
        // des toasts (ils n'ont rien à proposer).
        if (result.impact) { setImpact(result.impact); return }
        toast.error(result.error)
        return
      }
      setImpact(null)
      toast.success('Congé validé')
      onClose()
      if (result.conflit) onConflit?.(result.conflit)
    })
  }

  const handleValider = () => lancer(false)

  return (
    <>
    <GardienImpact
      impact={impact}
      geste="valider ce congé"
      origine="conges"
      vets={vetsActifs}
      enCours={isPending}
      onAnnuler={() => setImpact(null)}
      // Corriger relance la validation : si le point est réglé, elle passe.
      onCorrige={() => lancer(false)}
      // Pas d'issue « quand même » sur un blocage — `GardienImpact` ne
      // l'affiche que si l'impact n'est pas bloquant.
      onPasserOutre={() => lancer(true)}
    />
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Valider le congé</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {vet && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/50">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: vet.couleur }}
              >
                {vet.prenom.charAt(0)}
              </div>
              <p className="text-sm font-medium">{vet.prenom} {vet.nom}</p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Ajustez les dates si nécessaire avant de valider.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vd_debut">Début</Label>
              <Input
                id="vd_debut"
                type="date"
                value={dateDebut}
                onChange={(e) => setDateDebut(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vd_fin">Fin</Label>
              <Input
                id="vd_fin"
                type="date"
                value={dateFin}
                onChange={(e) => setDateFin(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annuler</Button>
          <Button
            onClick={handleValider}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isPending ? 'Validation…' : 'Valider'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
