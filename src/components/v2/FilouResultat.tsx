'use client'

// ============================================================
// GUARDVETO V2 — La fenêtre où Filou répond : une seule, pour tout
// ============================================================
// Décidé avec MiKL : « à droite il doit y avoir la réponse avec les boutons
// pour les propositions — ça doit être un modèle universel pour toutes les
// demandes. »
//
// Donc UNE fenêtre, une seule forme : un titre, ce que Filou répond, le détail
// ligne par ligne, et — quand il y a quelque chose à décider — le bouton qui
// l'exécute. La seule différence entre « voilà ce que j'ai trouvé » et « je te
// propose de faire ça » est la présence de ce bouton.
//
// Deux fenêtres séparées obligeaient à deviner laquelle allait s'ouvrir, et
// laissaient les réponses simples s'échouer dans la tablette, illisibles.
//
// GARDE-FOU : rien n'est écrit avant le clic, et le clic repasse par le
// serveur, qui revérifie les droits et revalide les paramètres avant d'agir.
// ============================================================

import { useState, useTransition } from 'react'
import { appliquerActionFilou } from '@/app/(protected)/filou/actions'

export interface ContenuResultat {
  titre: string
  introduction: string
  lignes: string[]
  /** Présente seulement quand il y a quelque chose à décider. */
  action?: {
    outil: string
    params: unknown
    charge?: unknown
    libelle: string
    avertissement?: string
  }
}

export type ResultatFilou = ContenuResultat & {
  /** Numéro d'ordre dans la session. Sert de `key` : une nouvelle réponse
   *  REMONTE la fenêtre, ce qui remet à zéro l'erreur affichée. */
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
  const action = resultat.action

  const appliquer = () => {
    if (!action) return
    demarrer(async () => {
      const r = await appliquerActionFilou(action.outil, action.params, action.charge)
      if ('error' in r) {
        // On reste ouvert : l'erreur se lit à côté du bouton qui l'a produite.
        setErreur(r.error)
        onDecision({ fermer: false, dire: r.error })
        return
      }
      // Le fil dit CE QUI a été fait, pas seulement que c'est fait : ce message
      // repart vers Filou au tour suivant, et « c'est fait » tout seul ne lui
      // apprend pas laquelle de ses propositions a été validée.
      onDecision({ fermer: true, dire: `C’est fait : ${resultat.titre}.` })
    })
  }

  return (
    <article
      className={`fen${actif ? ' active' : ''}`}
      role="region"
      aria-label={resultat.titre}
    >
      <header className="fen-head">
        <span className="f-ico" aria-hidden="true">
          🦊
        </span>
        <div className="f-titles">
          <h2 tabIndex={-1}>{resultat.titre}</h2>
          <p className="f-sub">
            {action ? 'Rien n’est enregistré tant que tu n’as pas validé' : 'Ce que Filou a trouvé'}
          </p>
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
        <p className="res-apercu">{resultat.introduction}</p>

        {resultat.lignes.length > 0 && (
          <ul className="res-regles">
            {resultat.lignes.map((ligne, i) => (
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

        {action?.avertissement && (
          <div className="f-note">
            <span className="who">🦊 Filou prévient</span>
            {action.avertissement}
          </div>
        )}
      </div>

      <footer className="fen-foot">
        {action ? (
          <>
            <button
              type="button"
              className="btn btn-valider"
              onClick={appliquer}
              disabled={enCours}
            >
              {enCours ? 'Un instant…' : action.libelle}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                onDecision({ fermer: true, dire: 'D’accord, je ne touche à rien.' })
              }
              disabled={enCours}
            >
              Laisse tomber
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={onFermer}>
            Refermer
          </button>
        )}
        <span className="hint">Échap pour refermer</span>
      </footer>
    </article>
  )
}
