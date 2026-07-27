'use client'

// ============================================================
// GUARDVETO V2 — Ce que Filou RÉPOND s'affiche sur le tableau, pas dans sa tablette
// ============================================================
// Règle de mise en scène, décidée avec MiKL : la tablette ne sert qu'à la
// CONVERSATION — Filou demande une précision, on lui répond. Tout RÉSULTAT
// (une règle comprise à valider, des règles existantes à lever, et demain un
// planning demandé) s'affiche sur le tableau du cabinet, où il y a la place
// d'être lu et décidé.
//
// Pourquoi un type `ResultatFilou` avec un `genre` plutôt qu'une carte de règle
// posée directement dans l'Épicentre : chaque nouvelle capacité de Filou ajoute
// une variante ici et emprunte le même chemin. La consigne « les résultats vont
// à droite » vit dans l'architecture, pas dans un cas particulier.
//
// GARDE-FOU inchangé : Filou PROPOSE, l'humain DÉCIDE. Rien n'est écrit ni
// effacé en base avant un clic, et les écritures repassent par les MÊMES actions
// serveur que les boutons de l'écran Règles.
// ============================================================

import { useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { appliquerActionRegles, type ForceFormulaire } from '@/app/(protected)/regles/actions'
import type { RegleVisee } from '@/lib/regles/libelle'
import {
  creerRegleProposee,
  forceProposee,
  FORCE_LABEL,
  FORCES_ORDRE,
  type PropositionExploitable,
} from '@/components/ia/creerRegleProposee'

/** Ce que Filou peut poser sur le tableau. Le `genre` est le point d'extension :
 *  une nouvelle capacité ajoute une variante ici, pas un rendu dans le chat. */
export type ContenuResultat =
  | {
      genre: 'regle'
      /** La règle telle que Filou l'a comprise, en français. */
      apercu: string
      res: PropositionExploitable
    }
  | {
      /** Des règles DÉJÀ POSÉES que Filou propose de toucher. */
      genre: 'action-regles'
      action: 'desactiver' | 'supprimer' | 'activer'
      regles: RegleVisee[]
      explication: string
    }

export type ResultatFilou = ContenuResultat & {
  /** Numéro d'ordre du résultat dans la session. Sert de `key` : une nouvelle
   *  demande REMONTE la fenêtre, ce qui remet à zéro la puissance choisie et
   *  l'erreur éventuelle sans effet de bord — sans lui, la puissance retenue
   *  pour la règle précédente s'appliquerait à la suivante. */
  id: number
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

export function FenetreResultatFilou(props: Props) {
  return props.resultat.genre === 'regle' ? (
    <FenetreRegle {...props} resultat={props.resultat} />
  ) : (
    <FenetreActionRegles {...props} resultat={props.resultat} />
  )
}

// ── L'habillage commun : même fenêtre que les fiches du coup d'œil ──

function Cadre({
  actif,
  titre,
  sousTitre,
  onFermer,
  children,
  pied,
}: {
  actif: boolean
  titre: string
  sousTitre: string
  onFermer: () => void
  children: ReactNode
  pied: ReactNode
}) {
  return (
    <article className={`fen${actif ? ' active' : ''}`} role="region" aria-label={titre}>
      <header className="fen-head">
        <span className="f-ico" aria-hidden="true">
          🦊
        </span>
        <div className="f-titles">
          <h2 tabIndex={-1}>{titre}</h2>
          <p className="f-sub">{sousTitre}</p>
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
      <div className="fen-body">{children}</div>
      <footer className="fen-foot">
        {pied}
        <span className="hint">Échap pour refermer</span>
      </footer>
    </article>
  )
}

// ── Une règle à créer ───────────────────────────────────────

function FenetreRegle({
  actif,
  resultat,
  onFermer,
  onDecision,
}: Props & { resultat: Extract<ResultatFilou, { genre: 'regle' }> }) {
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

  return (
    <Cadre
      actif={actif}
      titre="J’ai compris ça"
      sousTitre="Rien n’est enregistré tant que tu n’as pas validé"
      onFermer={onFermer}
      pied={
        <>
          <button type="button" className="btn btn-valider" onClick={creer} disabled={creation}>
            {creation ? 'J’enregistre…' : 'Créer cette règle'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onDecision({ fermer: true, dire: 'D’accord, je n’enregistre rien.' })}
            disabled={creation}
          >
            Laisse tomber
          </button>
        </>
      }
    >
      <p className="res-apercu">{resultat.apercu}</p>

      {/* La puissance est annoncée en clair, pas cachée dans un réglage :
          « interdiction ferme » et « préférence » ne produisent pas du tout le
          même planning. */}
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
    </Cadre>
  )
}

// ── Des règles existantes à lever, rétablir ou supprimer ────

function FenetreActionRegles({
  actif,
  resultat,
  onFermer,
  onDecision,
}: Props & { resultat: Extract<ResultatFilou, { genre: 'action-regles' }> }) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, demarrer] = useTransition()
  const ids = resultat.regles.map((r) => r.id)
  const n = resultat.regles.length

  const appliquer = (action: 'desactiver' | 'supprimer' | 'activer') => {
    demarrer(async () => {
      const r = await appliquerActionRegles(ids, action)
      if ('error' in r) {
        setErreur(r.error)
        onDecision({ fermer: false, dire: r.error })
        return
      }
      onDecision({
        fermer: true,
        dire:
          action === 'supprimer'
            ? `C’est supprimé — ${n} règle${n > 1 ? 's' : ''} en moins. Le prochain planning ne s’en occupera plus.`
            : action === 'desactiver'
              ? `C’est mis en pause. Tu pourras la${n > 1 ? 's' : ''} remettre en service quand tu veux.`
              : 'C’est reparti : la règle est de nouveau appliquée.',
      })
    })
  }

  // Une levée de contrainte se propose en DEUX portées : la pause se rattrape,
  // l'effacement non. Filou met en avant celle qu'il a jugée la plus juste, mais
  // ne prend pas la décision de la portée à la place de l'admin.
  const leveeDeContrainte = resultat.action !== 'activer'

  return (
    <Cadre
      actif={actif}
      titre={
        resultat.action === 'activer'
          ? `Remettre en service ${n > 1 ? `${n} règles` : 'une règle'}`
          : `Lever ${n > 1 ? `${n} règles` : 'une règle'}`
      }
      sousTitre="Rien n’est touché tant que tu n’as pas choisi"
      onFermer={onFermer}
      pied={
        leveeDeContrainte ? (
          <>
            <button
              type="button"
              className="btn btn-valider"
              onClick={() => appliquer('desactiver')}
              disabled={enCours}
            >
              {enCours ? 'Un instant…' : 'Mettre en pause'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => appliquer('supprimer')}
              disabled={enCours}
            >
              Supprimer définitivement
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-valider"
            onClick={() => appliquer('activer')}
            disabled={enCours}
          >
            {enCours ? 'Un instant…' : 'Remettre en service'}
          </button>
        )
      }
    >
      <p className="res-explication">{resultat.explication}</p>

      <ul className="res-regles">
        {resultat.regles.map((r) => (
          <li key={r.id}>
            <span className="rr-puce" aria-hidden="true">
              {r.actif ? '🔴' : '⏸'}
            </span>
            <span>
              {r.libelle}
              {!r.actif && <span className="rr-etat"> · déjà en pause</span>}
            </span>
          </li>
        ))}
      </ul>

      {erreur && (
        <p className="prop-verdict" role="alert">
          {erreur}
        </p>
      )}

      <div className="f-note">
        <span className="who">🦊 Filou prévient</span>
        {leveeDeContrainte ? (
          <>
            <b>La pause se rattrape, la suppression non.</b> Dans les deux cas, le
            planning déjà publié ne bouge pas : le changement vaut pour la
            prochaine génération.{' '}
          </>
        ) : (
          <>La règle repartira à la prochaine génération de planning. </>
        )}
        <Link className="prop-lien" href="/regles">
          Voir toutes les règles
        </Link>
      </div>
    </Cadre>
  )
}
