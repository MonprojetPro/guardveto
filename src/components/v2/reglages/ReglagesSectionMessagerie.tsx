'use client'

// ============================================================
// GUARDVETO — Réglages refondus : la section « Messagerie » (B-202)
// ============================================================
// Remplace la carte de B-193b, jugée « dégueu » par MiKL le 10/11 : un bouton
// au style V1 dans une carte étirée. Ici, une ligne et l'interrupteur validé
// en B-181 — l'état se lit d'un coup d'œil.
//
// L'autorité est EN BASE (`basculer_module_cabinet` : admin de CE cabinet,
// liste fermée) : cette section ne fait que demander et afficher la réponse.
// Éteindre ne supprime RIEN : la confirmation le dit, parce que « éteindre »
// se lit spontanément comme « effacer ».
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, MessageSquare, TriangleAlert } from 'lucide-react'
import { basculerModuleCabinet } from '@/app/(v2)/regles/modules-actions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Bloc, Interrupteur, Roue } from './ReglagesCommun'

export function ReglagesSectionMessagerie({ allumee }: { allumee: boolean }) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [refus, setRefus] = useState<string | null>(null)
  const [confirmer, setConfirmer] = useState(false)

  const basculer = (actif: boolean) => {
    setRefus(null)
    demarrer(async () => {
      const r = await basculerModuleCabinet('chat', actif)
      setConfirmer(false)
      if ('error' in r) {
        setRefus(r.error)
        return
      }
      // Le dock (icône de la messagerie) et cet état sont lus côté serveur.
      router.refresh()
    })
  }

  return (
    <div className="rg-panneau">
      <Bloc>
        <div className="rg-fonction">
          <span className="rg-fonction-puce" aria-hidden="true">
            <MessageSquare className="rg-ico" />
          </span>
          <b className="rg-fonction-titre">Messagerie de l’équipe</b>
          <div className="rg-etat-sw">
            {enCours && <Roue />}
            <em className={allumee ? 'rg-etat-on' : 'rg-etat-off'}>{allumee ? 'Active' : 'Éteinte'}</em>
            <Interrupteur
              actif={allumee}
              libelle="Messagerie de l’équipe"
              desactive={enCours}
              onBasculer={(actif) => (actif ? basculer(true) : setConfirmer(true))}
            />
          </div>
          <span className="rg-fonction-desc">
            Le fil de toute l’équipe et les conversations privées, secrétariat compris
          </span>
        </div>

        {refus && (
          <div className="rg-refus" role="alert">
            <TriangleAlert className="rg-ico sm" aria-hidden="true" />
            <span>{refus}</span>
          </div>
        )}
        {!allumee && !enCours && (
          <p className="rg-note">
            <Lock className="rg-ico sm" aria-hidden="true" />
            <span>Les conversations sont conservées.</span>
          </p>
        )}
      </Bloc>

      <Dialog open={confirmer} onOpenChange={(o) => !o && !enCours && setConfirmer(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Éteindre la messagerie ?</DialogTitle>
            <DialogDescription>
              Elle disparaît pour toute l’équipe. Les conversations sont conservées et reviennent si vous
              la rallumez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setConfirmer(false)}
              disabled={enCours}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => basculer(false)}
              disabled={enCours}
            >
              {enCours && <Roue />}
              Éteindre
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
