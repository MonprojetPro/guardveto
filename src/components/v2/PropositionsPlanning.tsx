'use client'

// ============================================================
// GUARDVETO V2 — Les propositions de Filou sur le planning (B-122/B-123)
// ============================================================
// Ce fichier porte DEUX pièces, et la frontière entre elles est une décision
// de MiKL, prise le 17/09 : « le panneau ne concerne que lorsqu'on veut tout
// appliquer d'un coup. »
//
//   1. `PropositionsPlanning` — le bandeau du HAUT. Il ne parle que du lot
//      entier : combien de propositions attendent, et « Appliquer tout ».
//      Il ne montre plus aucun détail.
//
//   2. `DetailProposition` — la barre du BAS, ancrée à l'écran. Elle porte UNE
//      proposition, celle dont on vient de cliquer la case.
//
// ── POURQUOI LE DÉTAIL A QUITTÉ LE HAUT DE LA PAGE ─────────────────────────
//
// Le lot 2 mettait tout le détail en haut, au-dessus de la grille. MiKL, le
// 17/09 : « y a un gros pavé de texte, donc faut que je lise, que j'aille voir
// sur le planning etc. Ce n'est pas fluide. »
//
// Un panneau en haut de page est hors champ dès qu'on clique une case de la
// dernière semaine du mois : on trancherait un changement sans voir ni la case
// ni le texte qui la décrit. La barre du bas reste visible quelle que soit la
// position dans la grille, et — c'est le point — elle ne recouvre pas le
// planning : les cases concernées restent à l'écran, mises en avant.
//
// ⚠️ Une modale a été écartée pour cette seule raison. Elle aurait masqué
// exactement ce que MiKL demande de regarder.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PropositionAffichee } from '@/lib/planning/propositionsAffichage'
import {
  appliquerPropositionAction,
  appliquerToutesPropositionsAction,
  rejeterPropositionAction,
} from '@/app/(v2)/planning/actionsPropositions'

// ── Le bandeau du haut : le lot entier ──────────────────────

interface PropsBandeau {
  periodeId: string
  propositions: PropositionAffichee[]
  /** Combien de créneaux la grille met réellement en avant. */
  creneauxTouches: number
}

export function PropositionsPlanning({ periodeId, propositions, creneauxTouches }: PropsBandeau) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState(false)

  if (propositions.length === 0) return null

  const appliquerTout = () => {
    setErreur(null)
    demarrer(async () => {
      const r = await appliquerToutesPropositionsAction(periodeId)
      if (!r.ok) {
        setErreur(r.erreur)
        return
      }
      if (r.bloquees.length > 0) {
        setErreur(
          `${r.appliquees} appliquée${r.appliquees > 1 ? 's' : ''}, ${r.bloquees.length} n'ont pas pu suivre : ${r.bloquees.map((b) => b.raison).join(' · ')}`,
        )
      }
      setConfirmation(false)
      router.refresh()
    })
  }

  const n = propositions.length

  return (
    <section className="prop-bandeau" aria-label="Propositions de Filou en attente">
      <div className="prop-bandeau-tete">
        <p className="prop-bandeau-titre">
          <span className="prop-bandeau-pastille" aria-hidden="true">
            🦊
          </span>
          <strong>
            {n} proposition{n > 1 ? 's' : ''} de Filou
          </strong>{' '}
          {/* On annonce ce que la grille MONTRE, pas ce qu'elle contient. La
              v1 disait « entourées sur le planning » alors qu'elle n'entourait
              qu'une case sur six — une promesse que l'écran ne tenait pas. */}
          {creneauxTouches > 0 ? (
            <>
              — le planning ci-dessous affiche {creneauxTouches} créneau
              {creneauxTouches > 1 ? 'x' : ''} modifié{creneauxTouches > 1 ? 's' : ''}.{' '}
              <span className="prop-bandeau-aide">
                Clique une case mise en avant pour décider changement par changement.
              </span>
            </>
          ) : (
            // Honnêteté : les créneaux touchés sont peut-être sur un autre mois.
            <>— aucun créneau concerné sur le mois affiché. Change de mois pour les voir.</>
          )}
        </p>

        {!confirmation ? (
          <button
            type="button"
            className="btn btn-ghost prop-bandeau-tout"
            onClick={() => setConfirmation(true)}
            disabled={enCours}
          >
            Tout appliquer
          </button>
        ) : (
          // Le 17/09, MiKL a cliqué « Appliquer tout » faute de pouvoir faire
          // autrement — et le planning s'est trouvé entièrement rebattu sans
          // qu'il l'ait voulu. Le geste dit maintenant ce qu'il emporte.
          <span className="prop-bandeau-confirme">
            <span className="prop-bandeau-confirme-texte">
              Appliquer les {n} d&apos;un coup ?
            </span>
            <button
              type="button"
              className="btn btn-valider"
              onClick={appliquerTout}
              disabled={enCours}
            >
              {enCours ? 'Un instant…' : 'Oui, tout appliquer'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirmation(false)}
              disabled={enCours}
            >
              Annuler
            </button>
          </span>
        )}
      </div>

      {erreur && (
        <p className="prop-bandeau-erreur" role="alert">
          {erreur}
        </p>
      )}
    </section>
  )
}

// ── La barre du bas : UNE proposition ───────────────────────

interface PropsDetail {
  proposition: PropositionAffichee
  onFermer: () => void
}

/**
 * Découpe « 5 décembre 2026 · Week-end · premier : Fanny » en ses trois
 * morceaux, pour pouvoir les mettre en forme séparément.
 *
 * ⚠️ MiKL, le 17/09 : « visuellement c'est un gros pavé, ce n'est pas beau ni
 * lisible ». Six lignes au même poids typographique ne se lisent pas : l'œil
 * n'a aucun point d'accroche. La date doit ressortir (c'est par elle qu'on
 * retrouve la case sur la grille), le nom aussi (c'est lui qui change), et le
 * créneau reste au second plan.
 *
 * Repli sûr : si le format évolue, on rend la ligne telle quelle plutôt que de
 * la tronquer. Un libellé moins joli vaut mieux qu'un libellé amputé.
 */
function decouperGeste(ligne: string): { date: string; creneau: string; qui: string } | null {
  const bouts = ligne.split(' · ')
  if (bouts.length < 3) return null
  return { date: bouts[0], creneau: bouts[1], qui: bouts.slice(2).join(' · ') }
}

export function DetailProposition({ proposition, onFermer }: PropsDetail) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)

  // Ce que le bouton engage RÉELLEMENT. MiKL, le 17/09 : « quand j'ai cliqué
  // sur appliquer, je pensais que c'était appliquer juste pour ce jour et
  // finalement ça me l'a appliqué pour tous ». Le libellé disait « ce
  // changement » pour 6 affectations sur 5 jours — il mentait par omission.
  // Le découpage jour par jour qu'il demande est un autre chantier (B-126) :
  // en attendant, le bouton dit ce qu'il fait.
  const nbGestes = proposition.geste.length
  const joursTouches = new Set(
    proposition.geste.map((g) => decouperGeste(g)?.date ?? g),
  ).size

  const agir = (action: 'appliquer' | 'rejeter') => {
    setErreur(null)
    demarrer(async () => {
      const r =
        action === 'appliquer'
          ? await appliquerPropositionAction(proposition.id)
          : await rejeterPropositionAction(proposition.id)
      if (!r.ok) {
        setErreur(r.erreur)
        return
      }
      onFermer()
      router.refresh()
    })
  }

  return (
    <aside className="prop-barre" role="region" aria-label="Changement proposé par Filou">
      <div className="prop-barre-corps">
        <div className="prop-barre-texte">
          {/* L'étendue AVANT le texte : c'est l'information que MiKL n'avait
              pas, et elle change la décision. */}
          <p className="prop-barre-etendue">
            <span className="prop-barre-pastille" aria-hidden="true">
              🦊
            </span>
            Réorganisation de <strong>{nbGestes} garde{nbGestes > 1 ? 's' : ''}</strong> sur{' '}
            <strong>
              {joursTouches} jour{joursTouches > 1 ? 's' : ''}
            </strong>
            {' — elle s’applique d’un bloc.'}
          </p>

          <p className="prop-barre-motif">{proposition.motif}</p>

          {proposition.geste.length > 0 && (
            <ul className="prop-barre-geste">
              {proposition.geste.map((g, i) => {
                const b = decouperGeste(g)
                return (
                  <li key={i}>
                    {b ? (
                      <>
                        <span className="pg-date">{b.date}</span>
                        <span className="pg-creneau">{b.creneau}</span>
                        <span className="pg-qui">{b.qui}</span>
                      </>
                    ) : (
                      g
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {proposition.objections.length > 0 && (
            <details className="prop-barre-objections">
              {/* Replié par défaut : c'est une réserve du moteur, pas la
                  décision. Dépliée en permanence, elle faisait la moitié du
                  pavé que MiKL a refusé. */}
              <summary>
                Le moteur a {proposition.objections.length} réserve
                {proposition.objections.length > 1 ? 's' : ''}
              </summary>
              <ul>
                {proposition.objections.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </details>
          )}

          {erreur && (
            <p className="prop-barre-erreur" role="alert">
              {erreur}
            </p>
          )}
        </div>

        <div className="prop-barre-actions">
          <button
            type="button"
            className="btn btn-valider"
            onClick={() => agir('appliquer')}
            disabled={enCours}
          >
            {enCours
              ? 'Un instant…'
              : `Appliquer les ${nbGestes} changement${nbGestes > 1 ? 's' : ''}`}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => agir('rejeter')}
            disabled={enCours}
          >
            Rejeter
          </button>
          <button type="button" className="btn btn-ghost" onClick={onFermer} disabled={enCours}>
            Fermer
          </button>
        </div>
      </div>
    </aside>
  )
}
