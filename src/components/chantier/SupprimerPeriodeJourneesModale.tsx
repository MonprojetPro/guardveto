'use client'

// ============================================================
// GUARDVETO — Supprimer une période journées (B-168a)
// ============================================================
// MiKL, 20/10, devant la fenêtre de suppression partagée (`RetirerPlanningModale`) :
// « ça parle encore de gardes !!! quand est-ce que tu vas enfin faire la part
// des choses entre les gardes et les journées ? ». Elle est écrite pour un
// planning de GARDES (son titre dit « Planning », son texte compte des
// gardes, des rendez-vous d'agenda, des échanges) — vocabulaire qui n'a aucun
// sens pour une période qui n'en a jamais eu.
//
// ── POURQUOI UNE FENÊTRE À PART, PAS DES CONDITIONS DANS L'AUTRE ────────────
//
// `RetirerPlanningModale` sert déjà la suppression réelle de plannings de
// gardes ailleurs dans le produit — la truffer de branches « si c'est une
// période journées » pour UN SEUL appelant aurait rendu plus fragile ce qui
// marche. Les deux fenêtres partagent le même geste serveur (`supprimerPeriode`),
// pas le même texte.
//
// ── POURQUOI UNE SEULE ÉTAPE, PAS DEUX ──────────────────────────────────────
//
// MiKL, devant la 2e confirmation : « elle sert à quoi celle-là ? ». La
// dactylographie du nom et les deux clics de `RetirerPlanningModale` protègent
// un planning que l'ÉQUIPE A VU — publié, posé dans l'agenda de sept
// personnes. Une période journées jamais publiée n'a été vue par personne
// d'autre que l'admin : il n'y a rien de réflexe à retenir. Ce que la fenêtre
// DOIT dire, honnêtement, c'est ce qu'il y a réellement à perdre — compté,
// jamais supposé.
// ============================================================

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { periodeFr } from '@/lib/dates-fr'
import { supprimerPeriode } from '@/app/(protected)/admin/periodes/actions'
import { compterPresencesDePeriode } from '@/app/(v2)/journee/presences-actions'
import type { PeriodeApplicable } from '@/components/v2/GenererJournee'

interface Props {
  periode: PeriodeApplicable
  onFerme: () => void
  onFait: (message: string) => void
}

export function SupprimerPeriodeJourneesModale({ periode, onFerme, onFait }: Props) {
  const [nbPresences, setNbPresences] = useState<number | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    void (async () => {
      const res = await compterPresencesDePeriode(periode.id)
      if (!vivant) return
      if (res.ok) setNbPresences(res.count)
      else setErreur(res.probleme)
    })()
    return () => { vivant = false }
  }, [periode.id])

  async function supprimer() {
    setEnCours(true)
    setErreur(null)
    const res = await supprimerPeriode(periode.id)
    setEnCours(false)

    if ('error' in res && res.error) {
      setErreur(res.error)
      return
    }
    onFait(`Période « ${periode.libelle} » supprimée.`)
  }

  return (
    <Dialog open onOpenChange={(ouvert) => { if (!ouvert && !enCours) onFerme() }}>
      <DialogContent className="gv-modale">
        <DialogHeader>
          <p className="gm-kicker">Journées · suppression</p>
          <DialogTitle>Supprimer « {periode.libelle} » ?</DialogTitle>
        </DialogHeader>

        <p className="gv-retrait-quand">Cette période couvre {periodeFr(periode.date_debut, periode.date_fin)}.</p>

        {nbPresences === null && !erreur ? (
          <p className="gv-retrait-attente">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            Je regarde ce qu’elle porte…
          </p>
        ) : nbPresences !== null && (
          <p className="gv-retrait-quand">
            {nbPresences === 0
              ? 'Aucune présence n’a encore été posée dessus.'
              : <>
                  <b>{nbPresences} présence{nbPresences > 1 ? 's' : ''}</b> déjà posée
                  {nbPresences > 1 ? 's' : ''} {nbPresences > 1 ? 'seront effacées' : 'sera effacée'} avec elle,
                  définitivement.
                </>}
          </p>
        )}

        {erreur && <div className="gf-card dure">{erreur}</div>}

        <DialogFooter>
          <Button variant="outline" disabled={enCours} onClick={onFerme}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            disabled={enCours || nbPresences === null}
            onClick={() => void supprimer()}
          >
            {enCours ? 'Suppression…' : 'Supprimer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
