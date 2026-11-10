'use client'

// ============================================================
// GUARDVETO V2 — Réglages : allumer ou éteindre la messagerie (B-193b)
// ============================================================
// L'interrupteur de l'administratrice, à côté de « E-mails aux vétos ».
// L'autorité est EN BASE (`basculer_module_cabinet` : admin de CE cabinet,
// liste fermée) : cette carte ne fait que demander et afficher la réponse.
//
// Éteindre ne supprime RIEN : les conversations restent en base, elles sont
// seulement illisibles tant que c'est éteint. La fenêtre de confirmation le dit,
// parce que « éteindre » se lit spontanément comme « effacer ».
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { basculerModuleCabinet } from '@/app/(v2)/regles/modules-actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function CarteMessagerie({ allumee }: { allumee: boolean }) {
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
      router.refresh()
    })
  }

  return (
    <section className="card conn-card carte-messagerie" aria-label="Messagerie de l’équipe">
      <div className="conn-head">
        <span className="conn-ico" aria-hidden="true">
          <MessageSquare />
        </span>
        <div>
          <h3>Messagerie de l’équipe</h3>
          <p className="sub">Le fil de toute l’équipe et les conversations privées, secrétariat compris</p>
        </div>
        <span className={`conn-state ${allumee ? 'on' : 'off'}`}>
          <span className="cs-dot" aria-hidden="true" />
          {allumee ? 'Active' : 'Éteinte'}
        </span>
      </div>
      <div className="carte-messagerie-pied">
        {allumee ? (
          <Button variant="outline" onClick={() => setConfirmer(true)} disabled={enCours}>
            Éteindre la messagerie
          </Button>
        ) : (
          <Button onClick={() => basculer(true)} disabled={enCours}>
            {enCours ? 'Allumage…' : 'Allumer la messagerie'}
          </Button>
        )}
        {refus && (
          <p className="carte-messagerie-refus" role="alert">
            {refus}
          </p>
        )}
      </div>

      <Dialog open={confirmer} onOpenChange={(o) => !o && !enCours && setConfirmer(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Éteindre la messagerie ?</DialogTitle>
            <DialogDescription>
              Elle disparaît pour toute l’équipe. Rien n’est effacé : les conversations reviennent telles
              quelles si vous la rallumez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmer(false)} disabled={enCours}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={() => basculer(false)} disabled={enCours}>
              Éteindre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
