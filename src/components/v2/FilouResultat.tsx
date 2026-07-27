'use client'

// ============================================================
// GUARDVETO V2 — Ce que Filou RÉPOND s'affiche sur le tableau, pas dans sa tablette
// ============================================================
// Règle de mise en scène, décidée avec MiKL : la tablette ne sert qu'à la
// CONVERSATION — Filou demande une précision, on lui répond. Tout RÉSULTAT
// (une règle comprise à valider, et demain un planning ou un compteur demandé)
// s'affiche sur le tableau du cabinet, où il y a la place pour être lu.
//
// Pourquoi un type `ResultatFilou` avec un `genre` plutôt qu'une carte de règle
// posée directement dans l'Épicentre : le jour où Filou saura répondre
// « montre-moi le planning de jeudi », le résultat empruntera le MÊME canal et
// atterrira au MÊME endroit. La consigne « les résultats vont à droite » vit
// donc dans l'architecture, pas dans un cas particulier qu'on redécoupera.
//
// GARDE-FOU inchangé : Filou PROPOSE, l'humain DÉCIDE. Rien n'est écrit en base
// avant le clic sur « Créer cette règle ».
// ============================================================

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { ForceFormulaire } from '@/app/(protected)/regles/actions'
import {
  creerRegleProposee,
  forceProposee,
  FORCE_LABEL,
  FORCES_ORDRE,
  type PropositionExploitable,
} from '@/components/ia/creerRegleProposee'

/** Ce que Filou peut poser sur le tableau. Une seule forme aujourd'hui — le
 *  `genre` est là pour que la deuxième n'oblige à rien réécrire. */
export type ResultatFilou = {
  /** Numéro d'ordre du résultat dans la session. Sert de `key` : une nouvelle
   *  demande REMONTE la fenêtre, ce qui remet à zéro la puissance choisie et
   *  l'erreur éventuelle sans effet de bord — sans lui, la puissance retenue
   *  pour la règle précédente s'appliquerait à la suivante. */
  id: number
  genre: 'regle'
  /** La règle telle que Filou l'a comprise, en français. */
  apercu: string
  res: PropositionExploitable
}

/** Ce que la fenêtre renvoie au fil de conversation : Filou commente sa propre
 *  décision dans la tablette, sinon le lien de cause à effet se perd entre les
 *  deux moitiés de l'écran. */
export type DecisionFilou = { fermer: boolean; dire: string }

interface Props {
  actif: boolean
  resultat: ResultatFilou
  onFermer: () => void
  onDecision: (d: DecisionFilou) => void
}

export function FenetreResultatFilou({ actif, resultat, onFermer, onDecision }: Props) {
  const [force, setForce] = useState<ForceFormulaire | null>(() => forceProposee(resultat.res))
  const [puissanceOuverte, setPuissanceOuverte] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [creation, demarrerCreation] = useTransition()

  const creer = () => {
    demarrerCreation(async () => {
      const r = await creerRegleProposee(resultat.res, force)
      if (r.error) {
        // On reste ouvert : l'erreur se lit à côté du bouton qui l'a produite.
        setErreur(r.error)
        onDecision({ fermer: false, dire: r.error })
        return
      }
      onDecision({
        fermer: true,
        dire: 'C’est enregistré. La règle s’appliquera à la prochaine génération de planning.',
      })
    })
  }

  const abandonner = () => {
    onDecision({ fermer: true, dire: 'D’accord, je n’enregistre rien.' })
  }

  return (
    <article
      className={`fen${actif ? ' active' : ''}`}
      role="region"
      aria-label="Ce que Filou a compris"
    >
      <header className="fen-head">
        <span className="f-ico" aria-hidden="true">
          🦊
        </span>
        <div className="f-titles">
          <h2 tabIndex={-1}>J’ai compris ça</h2>
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
        <p className="res-apercu">{resultat.apercu}</p>

        {/* La puissance est annoncée en clair, pas cachée dans un réglage :
            « interdiction ferme » et « préférence » ne produisent pas du tout
            le même planning. */}
        {force && (
          <p className="prop-force">
            Puissance : <b>{FORCE_LABEL[force]}</b>{' '}
            <button
              type="button"
              className="prop-lien"
              onClick={() => setPuissanceOuverte((v) => !v)}
              aria-expanded={puissanceOuverte}
            >
              {puissanceOuverte ? 'garder celle-ci' : 'changer'}
            </button>
          </p>
        )}
        {puissanceOuverte && (
          <div className="prop-crans" role="group" aria-label="Puissance de la règle">
            {FORCES_ORDRE.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={force === f}
                className={`prop-cran${force === f ? ' actif' : ''}`}
                onClick={() => setForce(f)}
              >
                {FORCE_LABEL[f]}
              </button>
            ))}
          </div>
        )}

        {erreur && (
          <p className="prop-verdict" role="alert">
            {erreur}
          </p>
        )}

        <div className="f-note">
          <span className="who">🦊 Filou prévient</span>
          Une règle ne réécrit pas le planning déjà posé : elle s’applique à la
          prochaine génération.{' '}
          <Link className="prop-lien" href="/regles">
            Voir toutes les règles
          </Link>
        </div>
      </div>

      <footer className="fen-foot">
        <button
          type="button"
          className="btn btn-valider"
          onClick={creer}
          disabled={creation}
        >
          {creation ? 'J’enregistre…' : 'Créer cette règle'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={abandonner}
          disabled={creation}
        >
          Laisse tomber
        </button>
        <span className="hint">Échap pour refermer</span>
      </footer>
    </article>
  )
}
