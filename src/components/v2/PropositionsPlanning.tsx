'use client'

// ============================================================
// GUARDVETO V2 — Le mode aperçu des propositions de Filou (B-122 lot 2)
// ============================================================
// MiKL, le 2026-09-15 : « on voit apparaitre sur le planning dans un style
// specifique ce que ca changerait […] et ca doit apparaitre AU COMPTEUR
// egalement, AVANT qu'il fasse le changement ».
//
// Panneau autonome, posé au-dessus de la grille : chaque proposition que le
// moteur a refusée (verdict `refuse`) montre ce qu'elle ferait, ce qu'elle
// enfreint, et son effet sur les compteurs — AVANT tout clic. L'admin
// applique tout en bloc, ou une proposition à la fois, en connaissance de
// cause (les deux, MiKL a tranché le 15/09).
//
// ⚠️ CE QUE CE PANNEAU NE FAIT PAS ENCORE : il ne surligne pas les cases
// concernées SUR la grille elle-même. La ligne vendredi/week-end inverse déjà
// les rôles ET les personnes affichées (B-111, cadenas payé le 04/09) — y
// superposer un second marquage sans la même rigueur rouvrirait exactement ce
// piège. Laissé pour un lot séparé plutôt que risqué ici.
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
}

function ligneCompteur(c: { prenom: string; avant: number; apres: number }) {
  const signe = c.apres > c.avant ? '+' : ''
  return `${c.prenom} ${c.avant} → ${c.apres} (${signe}${c.apres - c.avant})`
}

export function PropositionsPlanning({ periodeId, propositions }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [enCoursId, setEnCoursId] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  if (propositions.length === 0) return null

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
      router.refresh()
    })
  }

  return (
    <section className="prop-apercu" aria-label="Propositions de Filou en attente">
      <header className="prop-apercu-tete">
        <h2>
          🦊 {propositions.length} proposition{propositions.length > 1 ? 's' : ''} en attente
        </h2>
        <button
          type="button"
          className="btn btn-valider"
          onClick={appliquerTout}
          disabled={enCours}
        >
          {enCours && !enCoursId ? 'Un instant…' : 'Appliquer tout'}
        </button>
      </header>

      {erreur && (
        <p className="prop-apercu-erreur" role="alert">
          {erreur}
        </p>
      )}

      <ul className="prop-apercu-liste">
        {propositions.map((p) => (
          <li key={p.id} className="prop-apercu-carte">
            <p className="prop-apercu-motif">{p.motif}</p>

            <ul className="prop-apercu-geste">
              {p.geste.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>

            {p.objections.length > 0 && (
              <div className="prop-apercu-objections">
                <span className="prop-apercu-objections-tag">Ça enfreint :</span>
                <ul>
                  {p.objections.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </div>
            )}

            {p.compteursProjetes.length > 0 && (
              <div className="prop-apercu-compteurs">
                <span className="prop-apercu-compteurs-tag">Si tu appliques :</span>
                <ul>
                  {p.compteursProjetes.map((c, i) => (
                    <li key={i}>{ligneCompteur(c)}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="prop-apercu-actions">
              <button
                type="button"
                className="btn btn-valider"
                onClick={() => appliquerUne(p.id)}
                disabled={enCours}
              >
                {enCoursId === p.id ? 'Un instant…' : 'Appliquer'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => rejeterUne(p.id)}
                disabled={enCours}
              >
                Rejeter
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
