'use client'

// ============================================================
// GUARDVETO V2 — Le bandeau des propositions de Filou (B-122 lot 2, refait B-123)
// ============================================================
// MiKL, le 17/09, en recette du lot 2 : « j'aurais aime avoir les
// propositions qui apparaissent directement sur le planning […] la, y a un
// gros pave de texte, donc faut que je lise, que j'aille voir sur le
// planning etc. Ce n'est pas fluide. »
//
// Le lot 2 posait TOUT le détail ici — motif, geste, objections, compteurs —
// dans un bloc au-dessus de la grille. C'était exactement le geste que
// B-122 devait supprimer (« à toi de trancher, et d'appliquer à la main sur
// le planning »), recréé en plus court.
//
// ── CE QUE CE COMPOSANT FAIT DÉSORMAIS, ET CE QU'IL NE FAIT PLUS ───────────
//
// Il ne montre plus le détail par défaut : juste un titre et « Appliquer
// tout ». Le détail (motif, ce que ça enfreint, compteurs projetés) ne
// s'affiche que pour la proposition SÉLECTIONNÉE — sélection pilotée depuis
// l'EXTÉRIEUR (`PlanningV2`), parce que le vrai point d'entrée est
// maintenant un CLIC SUR LA CASE CONCERNÉE de la grille, pas ce bandeau.
// Cliquer une ligne d'ici reste possible (question posée au téléphone,
// clavier, accessibilité), mais le geste principal a déménagé.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PropositionAffichee } from '@/lib/planning/propositionsAffichage'
import {
  appliquerPropositionAction,
  appliquerToutesPropositionsAction,
  rejeterPropositionAction,
} from '@/app/(v2)/planning/actionsPropositions'

interface Props {
  periodeId: string
  propositions: PropositionAffichee[]
  /** La proposition dont le détail est ouvert — `null` = bandeau replié. */
  selectionId: string | null
  onSelect: (id: string | null) => void
}

function ligneCompteur(c: { prenom: string; avant: number; apres: number }) {
  const signe = c.apres > c.avant ? '+' : ''
  return `${c.prenom} ${c.avant} → ${c.apres} (${signe}${c.apres - c.avant})`
}

export function PropositionsPlanning({ periodeId, propositions, selectionId, onSelect }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [enCoursId, setEnCoursId] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  if (propositions.length === 0) return null

  const selection = propositions.find((p) => p.id === selectionId) ?? null

  const appliquerUne = (id: string) => {
    setErreur(null)
    setEnCoursId(id)
    demarrer(async () => {
      const r = await appliquerPropositionAction(id)
      setEnCoursId(null)
      if (!r.ok) {
        setErreur(r.erreur)
        return
      }
      onSelect(null)
      router.refresh()
    })
  }

  const rejeterUne = (id: string) => {
    setErreur(null)
    setEnCoursId(id)
    demarrer(async () => {
      const r = await rejeterPropositionAction(id)
      setEnCoursId(null)
      if (!r.ok) {
        setErreur(r.erreur)
        return
      }
      onSelect(null)
      router.refresh()
    })
  }

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
      onSelect(null)
      router.refresh()
    })
  }

  return (
    <section className="prop-bandeau" aria-label="Propositions de Filou en attente">
      <header className="prop-bandeau-tete">
        <button
          type="button"
          className="prop-bandeau-titre"
          onClick={() => onSelect(selectionId ? null : propositions[0].id)}
          aria-expanded={selectionId !== null}
        >
          🦊 {propositions.length} proposition{propositions.length > 1 ? 's' : ''} en attente —
          entourées sur le planning
        </button>
        <button
          type="button"
          className="btn btn-valider prop-bandeau-tout"
          onClick={appliquerTout}
          disabled={enCours}
        >
          {enCours && !enCoursId ? 'Un instant…' : 'Appliquer tout'}
        </button>
      </header>

      {erreur && (
        <p className="prop-bandeau-erreur" role="alert">
          {erreur}
        </p>
      )}

      {/* Le détail : UNE proposition à la fois, celle sélectionnée depuis la
          grille (ou, à défaut de souris, depuis le titre ci-dessus). */}
      {selection && (
        <div className="prop-detail">
          <p className="prop-detail-motif">{selection.motif}</p>

          {selection.objections.length > 0 && (
            <div className="prop-detail-objections">
              <span className="prop-detail-tag">Ça enfreint :</span>
              <ul>
                {selection.objections.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {selection.compteursProjetes.length > 0 && (
            <div className="prop-detail-compteurs">
              <span className="prop-detail-tag">Si tu appliques :</span>
              <ul>
                {selection.compteursProjetes.map((c, i) => (
                  <li key={i}>{ligneCompteur(c)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="prop-detail-actions">
            <button
              type="button"
              className="btn btn-valider"
              onClick={() => appliquerUne(selection.id)}
              disabled={enCours}
            >
              {enCoursId === selection.id ? 'Un instant…' : 'Appliquer'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => rejeterUne(selection.id)}
              disabled={enCours}
            >
              Rejeter
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onSelect(null)}
              disabled={enCours}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
