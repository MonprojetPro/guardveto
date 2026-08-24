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
// QUATRE NATURES DE CONTENU, quatre traitements (retour MiKL 2026-07-28 : « tout
// est en bloc »). Une réponse mélange des choses qui ne se lisent pas pareil, et
// les empiler dans une seule liste oblige à tout relire pour trouver ce qui
// compte :
//
//   ① LA RÉPONSE       — la phrase qui répond, en gros, en premier.
//   ② CE QUI EST ÉTABLI — les faits relevés dans le cabinet. Constat, au passé.
//   ③ CE QUI CHANGERAIT — ce que le bouton ferait. Au conditionnel, encadré :
//                          rien de tout ça n'existe encore.
//   ④ L'ACTION          — le bouton, seul en pied de fenêtre.
//
// La frontière ②/③ est la seule qui compte vraiment : confondre ce qui EST avec
// ce qui SERAIT, c'est cliquer sans savoir sur quoi.
//
// GARDE-FOU : rien n'est écrit avant le clic, et le clic repasse par le
// serveur, qui revérifie les droits et revalide les paramètres avant d'agir.
// ============================================================

import { useState, useTransition } from 'react'
import { appliquerActionFilou } from '@/app/(protected)/filou/actions'
import { AUCUNE_LECTURE, phraseDApres } from '@/lib/ia/sources-texte'

export interface ContenuResultat {
  titre: string
  introduction: string
  lignes: string[]
  /** Ce que Filou a consulté, en français et déjà prêt à lire. Vide = il n'a
   *  rien consulté du tout, et c'est ce qu'il faut dire le plus fort. */
  sources?: string[]
  sansLecture?: boolean
  /** Ce que l'attente a été occupée à faire — administrateur seulement. */
  mesure?: {
    ms: number
    tours: number
    modele: string
    reflexion: string
    /** Le bouton vient du second regard, pas du tour principal. */
    rattrapage?: boolean
  }
  /** Présente seulement quand il y a quelque chose à décider. */
  action?: {
    outil: string
    params: unknown
    charge?: unknown
    libelle: string
    /** Ce que le clic changerait, une ligne par changement. */
    changements?: string[]
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
      // Le fil dit CE QUI a changé — pas le titre de la fenêtre. « C'est fait :
      // Anne-Catherine et le mardi soir » ne dit rien de ce qui a bougé ; les
      // lignes de la proposition, elles, viennent de notre code et le disent
      // exactement. Ce message repart aussi vers Filou au tour suivant : il doit
      // pouvoir y lire ce que son propre bouton a produit.
      const quoi = (action.changements ?? []).join(' ').trim()
      onDecision({ fermer: true, dire: quoi ? `C’est fait. ${quoi}` : `C’est fait : ${resultat.titre}.` })
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
          {/* Le rappel « rien n'est enregistré » a quitté ce sous-titre : il vit
              maintenant DANS le bloc « ce que ça changerait », à côté de ce qu'il
              qualifie. Ici il servait de garantie générale, loin de son objet. */}
          <p className="f-sub">
            {action ? 'Ce que Filou a trouvé, et ce qu’il propose' : 'Ce que Filou a trouvé'}
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
        {/* ① La réponse — ce qu'on lit en premier, et parfois la seule chose
            qu'on lit. */}
        <p className="res-apercu">{resultat.introduction}</p>

        {/* ② Ce qui est établi — les faits relevés dans le cabinet. Sobre et
            sans cadre : c'est du constat, ça ne demande rien à personne. */}
        {resultat.lignes.length > 0 && (
          <section className="res-bloc" aria-label="Ce que Filou a relevé">
            <h3 className="res-bloc-titre">Ce que j&apos;ai relevé</h3>
            <ul className="res-constat">
              {resultat.lignes.map((ligne, i) => (
                <li key={i}>{ligne}</li>
              ))}
            </ul>
          </section>
        )}

        {/* ③ Ce qui changerait — encadré et au conditionnel : rien de tout ça
            n'existe tant que le bouton du pied de page n'a pas été cliqué. */}
        {action && action.changements && action.changements.length > 0 && (
          <section className="res-bloc res-changements" aria-label="Ce que la validation changerait">
            <h3 className="res-bloc-titre">Ce que ça changerait</h3>
            <ul className="res-liste-changements">
              {action.changements.map((ligne, i) => (
                <li key={i}>{ligne}</li>
              ))}
            </ul>
            <p className="res-pas-encore">Rien n&apos;est enregistré tant que tu n&apos;as pas validé.</p>
          </section>
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

        {/* D'OÙ VIENT CETTE RÉPONSE.
            Le système informe, il n'interdit pas : on n'a pas bloqué les
            réponses non fondées, on les rend reconnaissables. La ligne est
            volontairement sobre — Anne-Sophie ne doit pas lire un pavé
            technique sous chaque phrase — SAUF quand rien n'a été consulté :
            c'est justement le moment où il faut se méfier, et le silence s'y
            lirait comme une absence d'information plutôt que comme un
            avertissement.

            Rien au survol : une explication qui n'existe qu'au passage de la
            souris n'existe pas sur une tablette, et c'est sur tablette que ce
            produit se lit au comptoir. */}
        {resultat.sansLecture ? (
          <p className="res-sources res-sources-vide">{AUCUNE_LECTURE}</p>
        ) : (resultat.sources?.length ?? 0) > 3 ? (
          <details className="res-sources">
            <summary>D’après {resultat.sources!.length} sources consultées</summary>
            <ul>
              {resultat.sources!.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </details>
        ) : (resultat.sources?.length ?? 0) > 0 ? (
          <p className="res-sources">{phraseDApres(resultat.sources!)}</p>
        ) : null}

        {/* Le chronomètre, en tout petit. Une attente de plusieurs secondes se
            supporte mieux quand on voit ce qu'elle a fait — et surtout, elle
            devient réglable : le temps part-il dans quatre allers-retours ou
            dans un seul ? Le modèle est écrit là parce que c'est une variable
            d'hébergement, invisible depuis l'application autrement. */}
        {resultat.mesure && (
          <p className="res-mesure">
            Préparé en {(resultat.mesure.ms / 1000).toFixed(1)} s ·{' '}
            {resultat.mesure.tours} aller{resultat.mesure.tours > 1 ? 's' : ''}-retour
            {resultat.mesure.tours > 1 ? 's' : ''} · {resultat.mesure.modele} ·{' '}
            {resultat.mesure.reflexion}
            {resultat.mesure.rattrapage ? ' · action trouvée au 2ᵉ regard' : ''}
          </p>
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
