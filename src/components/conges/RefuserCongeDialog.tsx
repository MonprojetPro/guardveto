'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { refuserConge } from '@/app/(protected)/conges/actions'
import type { Conge, Veterinaire } from '@/types'

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

interface RefuserCongeDialogProps {
  open: boolean
  onClose: () => void
  conge: Conge
  vet: Veterinaire | undefined
}

export function RefuserCongeDialog({ open, onClose, conge, vet }: RefuserCongeDialogProps) {
  const [raison, setRaison] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleRefuser = () => {
    startTransition(async () => {
      const result = await refuserConge(conge.id, raison.trim() || undefined)
      if (result.error) { toast.error(result.error); return }
      toast.success('Demande refusée — le vétérinaire sera notifié par email')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Refuser la demande</DialogTitle>
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
              <div>
                <p className="text-sm font-medium">{vet.prenom} {vet.nom}</p>
                <p className="text-xs text-muted-foreground">
                  {conge.type === 'indisponibilite'
                    ? formatDate(conge.date_debut)
                    : `${formatDate(conge.date_debut)} → ${formatDate(conge.date_fin)}`}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="raison">Motif du refus <span className="text-muted-foreground font-normal">(facultatif)</span></Label>
            <Textarea
              id="raison"
              placeholder="Ex : planning déjà trop chargé sur cette période…"
              value={raison}
              onChange={(e) => setRaison(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Le motif sera inclus dans l'email envoyé au vétérinaire.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annuler</Button>
          <Button
            variant="destructive"
            onClick={handleRefuser}
            disabled={isPending}
          >
            {isPending ? 'Refus en cours…' : 'Refuser la demande'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
