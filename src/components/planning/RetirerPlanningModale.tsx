'use client'

// ============================================================
// GUARDVETO — Retirer un planning : les DEUX confirmations
// ============================================================
// MiKL, 2026-08-22 : « oui tu peux, mais il faut encadrer fermement cette
// possibilité, avec 2 demandes de confirmation pour le client en lui rappelant
// ce que ça implique de faire ça ».
//
// Deux confirmations DISTINCTES, pas deux clics sur le même bouton :
//
//   ① CE QUE ÇA EMPORTE — des faits lus en base, jamais des généralités.
//     « Cette action est irréversible » n'a jamais retenu personne ; « 118
//     gardes, 7 vétérinaires concernés, 118 rendez-vous qui disparaîtront de
//     l'agenda de tout le monde » se lit et s'arrête.
//   ② LE GESTE NON RÉFLEXE — recopier le nom du planning. On ne peut pas le
//     faire de mémoire musculaire, ni par-dessus l'épaule de quelqu'un.
//
// La doctrine du projet reste « le système INFORME, il n'interdit pas » : rien
// ici n'empêche l'administratrice d'aller au bout. On s'assure seulement
// qu'elle ne le fait pas sans savoir — et la conséquence, cette fois, est
// irréversible ET visible par toute l'équipe.
//
// LA DEUXIÈME MARCHE S'ADAPTE. Recopier le nom est exigé quand le planning a
// été diffusé, ou qu'il a posé des rendez-vous dans l'agenda — les deux cas où
// quelqu'un d'autre que l'admin a vu passer quelque chose. Un brouillon d'essai
// garde le geste léger d'avant (validé en recette le 2026-08-03) : deux clics,
// sans dactylographie. C'est le SERVEUR qui tranche, sur les données réelles ;
// l'écran ne fait que suivre ce qu'il annonce.
//
// LES REFUS RESTENT DANS LA FENÊTRE (jamais un toast) : ils arrivent après un
// geste engageant, et une vignette qui s'efface toute seule en bas à droite
// n'est pas une réponse. Seul le succès part en toast, depuis l'appelant.
// ============================================================

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarX2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  bilanRetraitPlanning,
  supprimerPeriode,
  depublierPeriode,
} from '@/app/(protected)/admin/periodes/actions'
import type { BilanPlanningARetirer } from '@/lib/planning/retrait-planning'

export type GesteRetrait = 'supprimer' | 'depublier'

interface Props {
  periodeId: string
  /** Le nom déjà connu de l'écran — évite une fenêtre anonyme le temps du chargement. */
  nomConnu: string
  geste: GesteRetrait
  onFerme: () => void
  /** Le geste a réussi. L'appelant affiche le toast et rafraîchit. */
  onFait: (message: string) => void
}

/** « 3 gardes » / « aucune garde » — un compte qui se lit à voix haute. */
function compte(n: number, singulier: string, pluriel: string, zero: string): string {
  if (n === 0) return zero
  return `${n} ${n > 1 ? pluriel : singulier}`
}

export function RetirerPlanningModale({ periodeId, nomConnu, geste, onFerme, onFait }: Props) {
  const [bilan, setBilan] = useState<BilanPlanningARetirer | null>(null)
  const [etape, setEtape] = useState<1 | 2>(1)
  const [saisie, setSaisie] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const definitif = geste === 'supprimer'

  // L'inventaire est lu à l'OUVERTURE, pas au clic final : ce qu'on montre doit
  // être ce qui existe, pas ce que l'écran croyait savoir en se chargeant.
  useEffect(() => {
    let vivant = true
    void (async () => {
      const res = await bilanRetraitPlanning(periodeId)
      if (!vivant) return
      if ('error' in res) setErreur(res.error)
      else setBilan(res.bilan)
    })()
    return () => { vivant = false }
  }, [periodeId])

  const nom = bilan?.nom ?? nomConnu
  // La dactylographie ne concerne QUE la suppression : dépublier se répare en
  // republiant, et la fermeté d'un garde-fou se règle sur l'irréparable.
  const saisieExigee = definitif && Boolean(bilan?.exigeSaisieDuNom)
  const nomRecopie =
    saisie.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR')
    === nom.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR')
  const peutAgir = !enCours && (!saisieExigee || nomRecopie) && !bilan?.bloquant

  async function agir() {
    setEnCours(true)
    setErreur(null)
    const res = definitif
      ? await supprimerPeriode(periodeId, saisie)
      : await depublierPeriode(periodeId)
    setEnCours(false)

    if ('error' in res && res.error) {
      // Un refus ne referme rien : l'admin doit pouvoir le lire, et repartir de
      // là où elle en était.
      setErreur(res.error)
      return
    }
    onFait(
      definitif
        ? `Planning « ${nom} » supprimé.`
        : `Planning « ${nom} » repassé en préparation.`,
    )
  }

  return (
    <Dialog open onOpenChange={(ouvert) => { if (!ouvert && !enCours) onFerme() }}>
      <DialogContent className="gv-modale gv-retrait">
        <DialogHeader>
          <p className="gm-kicker">Planning · {definitif ? 'suppression' : 'dépublication'}</p>
          <DialogTitle>
            {etape === 1
              ? (definitif
                  ? `Supprimer « ${nom} » ?`
                  : `Repasser « ${nom} » en préparation ?`)
              : (definitif
                  ? 'Dernière étape'
                  : 'Confirmer la dépublication')}
          </DialogTitle>
        </DialogHeader>

        {!bilan && !erreur && (
          <p className="gv-retrait-attente">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            Je regarde ce que ce planning contient…
          </p>
        )}

        {/* ─── ① CE QUE ÇA EMPORTE ─────────────────────────────── */}
        {bilan && etape === 1 && (
          <>
            <p className="gv-retrait-quand">
              Ce planning couvre {bilan.quand}.
              {bilan.publieLe && ` Il a été diffusé à l’équipe le ${bilan.publieLe}.`}
            </p>

            <ul className="gv-gardien-liste">
              <li>
                <span className="gv-gardien-quoi">
                  <b>{compte(bilan.nbGardes, 'garde', 'gardes', 'Aucune garde')}</b>
                  {bilan.nbGardes > 0 && bilan.nbVetosConcernes > 0 && (
                    <> réparties entre <b>{bilan.nbVetosConcernes} vétérinaire
                      {bilan.nbVetosConcernes > 1 ? 's' : ''}</b></>
                  )}
                  {definitif
                    ? ' — elles seront effacées.'
                    : ' — elles seront conservées, mais plus diffusées.'}
                </span>
              </li>

              {bilan.nbEvenementsAgenda > 0 && (
                <li>
                  <span className="gv-gardien-quoi">
                    <b>{bilan.nbEvenementsAgenda} rendez-vous</b> seront retirés de l’<b>agenda
                    Google du cabinet</b> — ils disparaîtront de l’agenda de tout le monde, y
                    compris sur les téléphones.
                  </span>
                  {!bilan.agendaJoignable && (
                    <p className="gv-gardien-regles">
                      L’agenda n’est pas joignable en ce moment : le geste sera refusé plutôt
                      que de laisser ces rendez-vous derrière lui.
                    </p>
                  )}
                </li>
              )}

              {bilan.publie && (
                <li>
                  <span className="gv-gardien-quoi">
                    <b>L’équipe a déjà vu ce planning.</b> Chacun a pu s’organiser dessus —
                    poser un congé autour, prévoir ses trajets, prévenir sa famille.
                    {definitif
                      ? ' Tout le monde sera prévenu de sa suppression.'
                      : ' Tout le monde sera prévenu qu’il repasse en préparation.'}
                  </span>
                </li>
              )}

              {definitif && (bilan.nbEchanges > 0 || bilan.nbDepannages > 0 || bilan.nbExceptions > 0) && (
                <li>
                  <span className="gv-gardien-quoi">
                    Partiront avec lui, sans possibilité de les retrouver :{' '}
                    {[
                      bilan.nbEchanges > 0
                        && compte(bilan.nbEchanges, 'échange de garde', 'échanges de gardes', ''),
                      bilan.nbDepannages > 0
                        && compte(bilan.nbDepannages, 'dépannage', 'dépannages', ''),
                      bilan.nbExceptions > 0
                        && compte(bilan.nbExceptions, 'exception posée à la journée', 'exceptions posées à la journée', ''),
                    ].filter(Boolean).join(', ')}.
                  </span>
                </li>
              )}
            </ul>

            {bilan.bloquant && (
              <div className="gf-card dure">
                <p className="gf-title">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                  Ce planning ne peut pas être supprimé en l’état
                </p>
                {bilan.bloquant}
              </div>
            )}

            {!definitif && (
              <p className="gv-explication">
                Rien n’est détruit : le planning redevient un brouillon, tu peux le corriger
                puis le republier. La republication remet tout en place, y compris l’agenda et
                les e-mails.
              </p>
            )}
          </>
        )}

        {/* ─── ② LE GESTE NON RÉFLEXE ──────────────────────────── */}
        {bilan && etape === 2 && (
          <>
            {definitif ? (
              <p className="gv-retrait-quand">
                Après cette étape, <b>{compte(bilan.nbGardes, 'garde', 'gardes', 'aucune garde')}</b>{' '}
                {bilan.nbGardes > 1 ? 'disparaîtront' : 'disparaîtra'} définitivement. Il n’y a
                pas de corbeille : personne, ici, ne pourra les remettre.
              </p>
            ) : (
              <p className="gv-retrait-quand">
                Le planning va sortir de l’agenda du cabinet et redevenir modifiable. L’équipe
                sera prévenue.
              </p>
            )}

            {saisieExigee && (
              <div className="gv-retrait-saisie">
                <label htmlFor="gv-retrait-nom">
                  Recopie le nom du planning pour confirmer :
                </label>
                <p className="gv-retrait-modele">{nom}</p>
                <Input
                  id="gv-retrait-nom"
                  value={saisie}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Le nom, tel qu’il est écrit au-dessus"
                  onChange={(e) => setSaisie(e.target.value)}
                />
                {saisie.trim().length > 0 && !nomRecopie && (
                  <p className="gv-retrait-ecart">Ce n’est pas encore le nom exact.</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Le refus du serveur — dans la fenêtre, à taille lisible. */}
        {erreur && (
          <div className="gf-card dure">
            <p className="gf-title">
              <CalendarX2 className="w-3.5 h-3.5" aria-hidden />
              Rien n’a été touché
            </p>
            {erreur}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={enCours} onClick={onFerme}>
            Annuler
          </Button>

          {etape === 1 ? (
            <Button
              disabled={!bilan || Boolean(bilan?.bloquant) || enCours}
              onClick={() => { setErreur(null); setEtape(2) }}
            >
              J’ai compris, continuer
            </Button>
          ) : (
            <Button variant="destructive" disabled={!peutAgir} onClick={() => void agir()}>
              {enCours
                ? (definitif ? 'Suppression…' : 'Dépublication…')
                : (definitif ? 'Supprimer définitivement' : 'Repasser en préparation')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
