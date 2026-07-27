'use client'

// ============================================================
// GUARDVETO V2 — Ce que Filou RÉPOND s'affiche sur le tableau, pas dans sa tablette
// ============================================================
// Règle de mise en scène, décidée avec MiKL : la tablette ne sert qu'à la
// CONVERSATION — Filou demande une précision, on lui répond. Tout RÉSULTAT
// s'affiche sur le tableau du cabinet, où il y a la place d'être lu et décidé.
//
// Cette fenêtre est GÉNÉRIQUE : elle affiche ce que l'outil a décrit (un titre,
// une phrase, des lignes, un bouton, un avertissement) sans rien savoir du
// domaine. Une nouvelle capacité de Filou n'a donc pas de composant à écrire —
// seulement un outil à décrire. C'est ce qui rend la consigne « les résultats
// vont à droite » vraie par construction plutôt qu'au cas par cas.
//
// GARDE-FOU : rien n'est écrit avant le clic, et le clic repasse par le serveur,
// qui revérifie les droits et revalide les paramètres avant d'agir.
// ============================================================

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { appliquerActionFilou } from '@/app/(protected)/filou/actions'
import type { PropositionAction } from '@/lib/ia/outils/types'

export type ContenuResultat = {
  genre: 'action'
  /** L'outil que Filou veut déclencher, et ce qu'il lui passerait. */
  outil: string
  params: unknown
  charge?: unknown
  proposition: PropositionAction
}

export type ResultatFilou = ContenuResultat & {
  /** Numéro d'ordre dans la session. Sert de `key` : une nouvelle proposition
   *  REMONTE la fenêtre, ce qui remet à zéro l'erreur affichée sans effet de
   *  bord. */
  id: number
}

/** Ce que la fenêtre renvoie au fil : Filou commente sa propre décision dans la
 *  tablette, sinon les deux moitiés de l'écran s'ignorent. */
export type DecisionFilou = { fermer: boolean; dire: string }

interface Props {
  actif: boolean
  resultat: ResultatFilou
  onFermer: () => void
  onDecision: (d: DecisionFilou) => void
}

export function FenetreResultatFilou({ actif, resultat, onFermer, onDecision }: Props) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, demarrer] = useTransition()
  const p = resultat.proposition

  const appliquer = () => {
    demarrer(async () => {
      const r = await appliquerActionFilou(resultat.outil, resultat.params, resultat.charge)
      if ('error' in r) {
        // On reste ouvert : l'erreur se lit à côté du bouton qui l'a produite.
        setErreur(r.error)
        onDecision({ fermer: false, dire: r.error })
        return
      }
      onDecision({ fermer: true, dire: 'C’est fait.' })
    })
  }

  return (
    <article className={`fen${actif ? ' active' : ''}`} role="region" aria-label={p.titre}>
      <header className="fen-head">
        <span className="f-ico" aria-hidden="true">
          🦊
        </span>
        <div className="f-titles">
          <h2 tabIndex={-1}>{p.titre}</h2>
          <p className="f-sub">Rien n’est enregistré tant que tu n’as pas validé</p>
        </div>
        <button
          type="button"
          className="fen-close"
          aria-label="Refermer la fenêtre"
          onClick={onFermer}
        >
          ✕
        </button>
      </header>

      <div className="fen-body">
        <p className="res-apercu">{p.phrase}</p>

        {p.lignes && p.lignes.length > 0 && (
          <ul className="res-regles">
            {p.lignes.map((ligne, i) => (
              <li key={i}>
                <span>{ligne}</span>
              </li>
            ))}
          </ul>
        )}

        {erreur && (
          <p className="prop-verdict" role="alert">
            {erreur}
          </p>
        )}

        {p.avertissement && (
          <div className="f-note">
            <span className="who">🦊 Filou prévient</span>
            {p.avertissement}{' '}
            <Link className="prop-lien" href="/regles">
              Voir les règles
            </Link>
          </div>
        )}
      </div>

      <footer className="fen-foot">
        <button type="button" className="btn btn-valider" onClick={appliquer} disabled={enCours}>
          {enCours ? 'Un instant…' : p.action}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onDecision({ fermer: true, dire: 'D’accord, je ne touche à rien.' })}
          disabled={enCours}
        >
          Laisse tomber
        </button>
        <span className="hint">Échap pour refermer</span>
      </footer>
    </article>
  )
}
