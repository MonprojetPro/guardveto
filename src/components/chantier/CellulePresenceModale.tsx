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
// B-163b ④ — l'unique autorité sur ce qu'une absence couvre. Cette fenêtre
// AFFICHE ; elle ne décide jamais de ce qu'un périmètre veut dire.
import { lirePerimetre, phrasePerimetre } from '@/lib/absences/perimetre'
import type { CreneauBlocJournee } from '@/types'

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
})

/**
 * Cette présence couvre-t-elle déjà cette tranche ?
 *
 * B-163b ⑤. On compare les HORAIRES, jamais les noms : « Journée complète »
 * (08-18) contient « Matin » (08-12), et aucune comparaison de chaînes ne peut
 * le savoir. Bornes exclues à droite, comme partout : « Matin » 08-12 et
 * « Après-midi » 14-18 ne se touchent pas, et 12-14 non plus.
 *
 * ⚠️ Le repli est `false` — « je ne sais pas » ne doit pas CACHER une tranche.
 *    Un bouton en trop se voit et se corrige ; un bouton manquant laisse
 *    l'administratrice devant une action qu'elle ne peut plus faire, sans
 *    comprendre pourquoi.
 */
// ⚠️ EXPORTÉE depuis B-165 : le tableau de bord journalier
// (`JourneeDashboardModale`) propose le même « ajouter une tranche » et doit
// donc répondre à la même question. La recopier là-bas en ferait une TROISIÈME
// version d'une convention déjà payée au 02/10 — et c'est toujours la copie
// qu'on oublie de corriger qui se met à mentir.
export function recouvre(
  presence: { debut: string | null; fin: string | null; tranche: string },
  tranche: { nom: string; debut: string; fin: string },
): boolean {
  // Le nom reste un cas sûr : la même tranche, posée deux fois, se reconnaît
  // sans horaires — et elle peut en manquer (tranche supprimée du cabinet).
  if (presence.tranche === tranche.nom) return true
  if (!presence.debut || !presence.fin) return false
  return presence.debut < tranche.fin && tranche.debut < presence.fin
}

export interface TranchePosable {
  id: string
  nom: string
  debut: string
  fin: string
  /**
   * CE QUE LA TRANCHE COUVRE (B-165d) — `matin`, `apres-midi` ou `journee`.
   *
   * ⚠️ Ce n'est PAS déductible du nom ni des horaires : le cabinet règle ses
   *    tranches librement, et « Matin » pourrait couvrir 8h-18h (c'est
   *    d'ailleurs l'état réel mesuré le 01/10 sur le premier cabinet). C'est le
   *    seul moyen de ranger un absent dans la bonne colonne sans deviner.
   */
  creneau: CreneauBlocJournee
}

export function CellulePresenceModale({
  date,
  personne,
  journee,
  periodeId,
  tranches,
  indisponibilites = [],
  prevuParRecurrence = [],
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
  /** B-163b ④ — ce qui rend cette personne indisponible ce jour-là. */
  indisponibilites?: {
    origine: 'conge' | 'absence'
    statut: string
    perimetre: string | null
    heureDebut: string | null
    heureFin: string | null
  }[]
  /**
   * Ce que la RÉCURRENCE de cette personne prévoyait pour CE jour (B-163e ③).
   *
   * Déjà filtré par l'appelant : la convention de parité des semaines vit dans
   * `lib/journee/trames.ts`, et cette fenêtre dessine — elle ne rejoue pas la
   * règle. La recopier ici, c'est la voir diverger un jour sans que rien ne le
   * dise (« une convention recopiée trois fois », payé le 02/10).
   */
  prevuParRecurrence?: { tranche: string; heures: string }[]
  onFermer: () => void
}) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [choix, setChoix] = useState<string>('')

  if (!date || !personne) return null

  const siennes = (journee?.presences ?? []).filter((p) => p.vetId === personne.id)

  // 🔴 B-163b ⑤ — ON COMPARE LES HORAIRES, PLUS LES NOMS. MiKL, 14/10 : « y a
  //    marqué "ajouter une tranche" alors qu'il est là toute la journée, ça n'a
  //    pas de sens ». Le code comparait `tranche` par son NOM : « Journée
  //    complète » (08-18) ne masquait donc ni « Matin » (08-12) ni
  //    « Après-midi » (14-18), qu'elle couvre pourtant entièrement.
  //
  // ⚠️ Le commentaire d'origine disait déjà la bonne règle — « un bouton qui
  //    mène à un refus prévisible est un bouton qui ment » — et la comparaison
  //    par nom la trahissait. L'intention juste ne suffit pas : c'est le
  //    prédicat qui décide.
  const posables = tranches.filter((t) => !siennes.some((p) => recouvre(p, t)))

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
      {/* `cpm-modale` en plus de `gv-modale` : B-163d ① — MiKL, 15/10, « je
          reverrais le style du nom et de la date… pkoi la date est aussi
          petite ? ». La description d'une modale fait 0,82 rem partout dans le
          produit, ce qui convient à une phrase d'explication. Ici ce n'est pas
          une explication, c'est le SUJET de la fenêtre : qui, et quel jour. Il
          fallait donc une classe à nous plutôt que de toucher au défaut
          commun, qui habille des dizaines d'autres fenêtres. */}
      <DialogContent className="gv-modale cpm-modale">
        <DialogHeader>
          <DialogTitle className="cpm-titre">
            <span className="vdot" style={stylePoint(personne.couleur)} aria-hidden="true" />
            {personne.prenom}
          </DialogTitle>
          <DialogDescription>
            {DATE_LONGUE.format(new Date(date + 'T12:00:00Z'))}
          </DialogDescription>
        </DialogHeader>

        {/*
          🔴 B-163b ④ — CE QUI REND CETTE PERSONNE INDISPONIBLE, EN PREMIER.
          MiKL, 14/10 : « y a pas marqué l'absence le concernant ». La fenêtre
          listait ses présences et proposait d'en ajouter, sans jamais dire
          qu'une indisponibilité était posée ce jour-là. C'est l'écran où l'on
          vient chercher le détail que la pastille « A » annonce : s'il se tait,
          la pastille ne mène nulle part.

          En TÊTE, avant les présences : on lit d'abord ce qui contraint, puis
          ce qu'on peut faire. L'inverse ferait poser une tranche sur une
          matinée qu'on vient de déclarer absente.
        */}
        {indisponibilites.length > 0 && (
          <ul className="cpm-indispos">
            {indisponibilites.map((ind, i) => {
              const p = lirePerimetre(ind.perimetre)
              const phrase = phrasePerimetre(
                p,
                ind.heureDebut && ind.heureFin
                  ? { heure_debut: ind.heureDebut, heure_fin: ind.heureFin }
                  : null,
              )
              return (
                <li key={i} className="cpm-indispo">
                  <b>{ind.origine === 'conge' ? (ind.statut === 'souhait' ? 'Souhait de congé' : 'Congé') : 'Absence'}</b>
                  {/* `phrasePerimetre` rend `null` sur « la journée et la
                      nuit » — le cas général n'a rien à préciser, et une
                      mention permanente cesse d'être lue. */}
                  <span>{phrase ?? 'Toute la journée et la nuit'}</span>
                </li>
              )
            })}
          </ul>
        )}

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
                /*
                  🔴 B-163e ③ — « RIEN D'INSCRIT » ÉTAIT UNE RÉPONSE FAUSSE.
                  MiKL, 15/10, devant la fenêtre d'Antoine, absent toute la
                  journée du 22/10 : « ça n'indique pas qu'il était prévu à la
                  base sur cette journée, y a juste marqué son absence ».

                  Il l'était — sa récurrence le posait — et c'est précisément
                  son absence qui a retiré la présence. « Rien d'inscrit » se
                  lit « il ne travaille pas ce jour-là » : on ne cherche donc
                  pas plus loin, et on croit l'équipe au complet.

                  🔑 Même famille que « Rien à vérifier » : le danger n'est
                     jamais la case vide, c'est la phrase rassurante qui répond
                     à une question qu'on n'a pas posée.
                */
                prevuParRecurrence.length > 0 ? (
                  <div className="cpm-prevu">
                    <p>
                      <b>Rien ce jour-là</b> — mais sa récurrence le prévoyait :
                    </p>
                    <ul>
                      {prevuParRecurrence.map((r, i) => (
                        <li key={i}>
                          <b>{r.tranche}</b>
                          {r.heures && <small>{r.heures}</small>}
                        </li>
                      ))}
                    </ul>
                    {/* On ne DÉDUIT pas que c'est l'absence qui a retiré : on
                        affirme ce qu'on sait (prévu, et pas là), et on nomme la
                        cause seulement si une indisponibilité existe. */}
                    {indisponibilites.length > 0 && (
                      <p className="cpm-prevu-cause">
                        Son indisponibilité ci-dessus a retiré cette présence.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="cpm-vide">Rien d’inscrit, et aucune récurrence ne le prévoit.</p>
                )
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
