'use client'

// ============================================================
// GUARDVETO V2 — Poser et retirer une présence, sur une case
// ============================================================
// B-145a. Les deux actions `poserPresence` et `retirerPresence` existaient
// depuis le 06/10 — écrites, gardées par les trois portes, couvertes par 33
// tests — et **rien ne les appelait**. C'est la sonde « actions sans appelant »
// déjà payée sur ce projet, cette fois au niveau de la FONCTION : le gardien du
// code mort raisonne par FICHIER, et le fichier était atteignable par
// `appliquerTrames`. Il ne pouvait donc pas les voir.
//
// 🔑 L'APPELANT, LE VOICI. C'est la grille dépliée du lot 2b qui le rendait
//    possible : il fallait un endroit où l'administratrice voie À LA FOIS la
//    personne et le jour avant de cliquer. Un bouton « ajouter une présence »
//    posé ailleurs aurait demandé de ressaisir les deux.
//
// ── LA LIMITE QUI DOIT ÊTRE LUE, PAS DÉCOUVERTE ─────────────────────────────
//
// Retirer à la main quelqu'un que sa récurrence désigne, puis réappliquer les
// récurrences, le remet. Il n'existe pas de retrait définitif : mémoriser
// l'exception demanderait une ligne qui dit l'ABSENCE, et « vider une place ≠ la
// mettre à null » est un piège déjà payé deux fois le 02/09. On livre le
// comportement le plus prévisible — et on l'ÉCRIT à l'écran.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { poserPresence, retirerPresence } from '@/app/(v2)/journee/presences-actions'
import { plageCourte, type JourneeAffichee } from '@/lib/planning/presencesDuJour'
import { stylePoint } from '@/lib/couleurs'

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
})

export interface TranchePosable {
  id: string
  nom: string
  debut: string
  fin: string
}

export function CellulePresenceModale({
  date,
  personne,
  journee,
  periodeId,
  tranches,
  onFermer,
}: {
  /** `AAAA-MM-JJ`, ou `null` quand rien n'est ouvert. */
  date: string | null
  personne: { id: string; prenom: string; couleur: string | null } | null
  journee?: JourneeAffichee
  /**
   * Le planning qui reçoit la présence. `null` = le jour ne tombe dans aucune
   * période : on n'ouvre pas une fenêtre qui ne pourrait rien enregistrer.
   */
  periodeId: string | null
  /** Les tranches ACTIVES du cabinet — les seules sur lesquelles on peut poser. */
  tranches: TranchePosable[]
  onFermer: () => void
}) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [choix, setChoix] = useState<string>('')

  if (!date || !personne) return null

  const siennes = (journee?.presences ?? []).filter((p) => p.vetId === personne.id)
  const dejaPrises = new Set(siennes.map((p) => p.tranche))
  // On ne propose pas une tranche déjà tenue : l'action la refuserait, et un
  // bouton qui mène à un refus prévisible est un bouton qui ment.
  const posables = tranches.filter((t) => !dejaPrises.has(t.nom))

  function poser(trancheId: string) {
    if (!periodeId || !date || !personne) return
    demarrer(async () => {
      const r = await poserPresence({
        veterinaire_id: personne.id,
        bloc_id: trancheId,
        date,
        periode_id: periodeId,
      })
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
      setChoix('')
      router.refresh()
    })
  }

  function retirer(id: string) {
    demarrer(async () => {
      const r = await retirerPresence(id)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enCours) onFermer() }}>
      <DialogContent className="gv-modale">
        <DialogHeader>
          <DialogTitle className="cpm-titre">
            <span className="vdot" style={stylePoint(personne.couleur)} aria-hidden="true" />
            {personne.prenom}
          </DialogTitle>
          <DialogDescription>
            {DATE_LONGUE.format(new Date(date + 'T12:00:00Z'))}
          </DialogDescription>
        </DialogHeader>

        {!periodeId ? (
          /* Pas de période = rien à quoi rattacher la présence. On le DIT, au
             lieu d'afficher un formulaire dont l'enregistrement échouerait. */
          <p className="cpm-vide">
            Ce jour ne fait partie d’aucun planning. Créez-en un pour y poser des présences.
          </p>
        ) : (
          <>
            <div className="cpm-bloc">
              <h4>Ses présences ce jour-là</h4>
              {siennes.length === 0 ? (
                <p className="cpm-vide">Rien d’inscrit.</p>
              ) : (
                <ul className="cpm-liste">
                  {siennes.map((p) => (
                    <li key={p.id}>
                      <span className="cpm-tranche">
                        <b>{p.tranche}</b>
                        {p.heures && <small>{p.heures}</small>}
                      </span>
                      <span className="cpm-origine">
                        {p.deLaTrame ? 'par sa récurrence' : 'posée à la main'}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={enCours}
                        onClick={() => retirer(p.id)}
                      >
                        Retirer
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="cpm-bloc">
              <h4>Ajouter une tranche</h4>
              {posables.length === 0 ? (
                <p className="cpm-vide">
                  {tranches.length === 0
                    ? 'Aucune tranche horaire n’est définie. Réglez-les dans « Journée ».'
                    : 'Toutes les tranches sont déjà prises ce jour-là.'}
                </p>
              ) : (
                <div className="cpm-choix">
                  {posables.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={choix === t.id ? 'cpm-tr actif' : 'cpm-tr'}
                      disabled={enCours}
                      onClick={() => {
                        setChoix(t.id)
                        poser(t.id)
                      }}
                    >
                      <b>{t.nom}</b>
                      <small>{plageCourte(t.debut, t.fin)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ⚠️ LA LIMITE S'ÉCRIT. Un retrait qui ne tient pas la prochaine
                application des récurrences, découvert après coup, se lit comme
                une panne — alors que c'est le comportement voulu. */}
            {siennes.some((p) => p.deLaTrame) && (
              <p className="cpm-note">
                Une présence venue d’une récurrence <b>reviendra</b> si vous réappliquez les
                récurrences sur ce planning.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
