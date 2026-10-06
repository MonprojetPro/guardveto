'use client'

// ============================================================
// GUARDVETO V2 — Les trames de présence de la journée
// ============================================================
// B-120 chantier 3, lot 1. On range par PERSONNE, pas par jour.
//
// ── POURQUOI PAR PERSONNE ───────────────────────────────────────────────────
//
// C'est la façon dont MiKL a décrit le besoin le 09/09 : « Anne-Sophie
// lundi/mardi/mercredi des semaines impaires et jeudi/vendredi des semaines
// paires ». Une phrase par personne, pas une colonne par jour. La grille
// jour × personne arrive au lot 2 — c'est la projection, pas la règle.
//
// ⚠️ CE QUE CET ÉCRAN DOIT DIRE, ET QUI N'EST PAS DÉCORATIF ────────────────
//
// Enregistrer une trame NE POSE AUCUNE PRÉSENCE. L'application sur une période
// est un geste séparé (lot 2). Si l'écran laissait croire le contraire, l'admin
// attendrait un planning qui ne vient pas — et « faut que je rafraîchisse pour
// voir » est le symptôme maison du consumer oublié. Ici il n'y a rien à
// rafraîchir : il n'y a rien à montrer. Donc on le DIT.
//
// ── LES REFUS EN MODALE, LES SUCCÈS SANS BRUIT ──────────────────────────────
// Convention du projet : un refus s'affiche et attend d'être lu, un succès se
// voit dans la liste qui vient de changer. Les messages viennent du SERVEUR,
// repris mot pour mot — jamais reformulés ici, sinon la même erreur aurait deux
// formulations selon le chemin.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { BlocJournee, TrameJournee, Veterinaire } from '@/types'
import {
  JOURS_TRAME,
  LIBELLE_JOUR,
  LIBELLE_PARITE,
  PARITES_TRAME,
  phraseTrame,
} from '@/lib/journee/trames'
import { plageLisible } from '@/lib/journee/blocs'
import {
  creerTrame,
  modifierTrame,
  basculerTrame,
} from '@/app/(v2)/journee/trames-actions'

interface Props {
  trames: TrameJournee[]
  blocs: BlocJournee[]
  equipe: Veterinaire[]
}

export function TramesJournee({ trames, blocs, equipe }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [refus, setRefus] = useState<string | null>(null)
  /** L'id de la ligne en édition, ou l'id du véto pour qui on ajoute. */
  const [edite, setEdite] = useState<string | null>(null)
  const [ajoutPour, setAjoutPour] = useState<string | null>(null)
  const [saisie, setSaisie] = useState({ bloc_id: '', jour: 'lundi', semaine: 'toutes' })

  /** Seules les tranches ACTIVES sont proposées — une retirée serait refusée. */
  const blocsProposables = blocs.filter((b) => b.actif)
  const nomBloc = (id: string) => blocs.find((b) => b.id === id)?.nom ?? 'tranche inconnue'

  const fermer = () => {
    setEdite(null)
    setAjoutPour(null)
    setSaisie({ bloc_id: blocsProposables[0]?.id ?? '', jour: 'lundi', semaine: 'toutes' })
  }

  /** Un seul chemin pour les trois actions : un seul endroit qui gère le refus. */
  const lancer = (action: () => Promise<{ success: true } | { error: string }>) => {
    setRefus(null)
    demarrer(async () => {
      const r = await action()
      if ('error' in r) {
        setRefus(r.error)
        return
      }
      fermer()
      // `revalidatePath` côté serveur invalide le cache ; `router.refresh()`
      // redemande le rendu. Les deux sont nécessaires.
      router.refresh()
    })
  }

  const ouvrirAjout = (vetoId: string) => {
    setRefus(null)
    setEdite(null)
    setAjoutPour(vetoId)
    setSaisie({ bloc_id: blocsProposables[0]?.id ?? '', jour: 'lundi', semaine: 'toutes' })
  }

  const ouvrirEdition = (t: TrameJournee) => {
    setRefus(null)
    setAjoutPour(null)
    setEdite(t.id)
    setSaisie({ bloc_id: t.bloc_id, jour: t.jour, semaine: t.semaine })
  }

  const formulaire = (vetoId: string, surSoumission: () => void, libelleBouton: string) => (
    <form
      className="tj-form"
      onSubmit={(e) => {
        e.preventDefault()
        surSoumission()
      }}
    >
      <div className="tj-form-grid">
        <label className="field">
          <span className="f-label">Tranche horaire</span>
          {/* ⚠️ JAMAIS de `<select>` natif sur ce projet — règle du design
              system. Des boutons radio : les tranches sont peu nombreuses
              (trois chez le cabinet pilote) et les montrer évite un clic pour
              lire une information courte. */}
          <span className="tj-radios">
            {blocsProposables.map((b) => (
              <label key={b.id} className={`tj-radio${saisie.bloc_id === b.id ? ' actif' : ''}`}>
                <input
                  type="radio"
                  name={`bloc-${vetoId}`}
                  value={b.id}
                  checked={saisie.bloc_id === b.id}
                  onChange={() => setSaisie({ ...saisie, bloc_id: b.id })}
                />
                <span>
                  {b.nom} <span className="tj-horaire">{plageLisible(b.debut, b.fin)}</span>
                </span>
              </label>
            ))}
          </span>
        </label>

        <label className="field">
          <span className="f-label">Jour</span>
          <span className="tj-radios">
            {JOURS_TRAME.map((j) => (
              <label key={j} className={`tj-radio${saisie.jour === j ? ' actif' : ''}`}>
                <input
                  type="radio"
                  name={`jour-${vetoId}`}
                  value={j}
                  checked={saisie.jour === j}
                  onChange={() => setSaisie({ ...saisie, jour: j })}
                />
                <span>{LIBELLE_JOUR[j]}</span>
              </label>
            ))}
          </span>
        </label>

        <label className="field">
          <span className="f-label">Cadence</span>
          <span className="tj-radios">
            {PARITES_TRAME.map((p) => (
              <label key={p} className={`tj-radio${saisie.semaine === p ? ' actif' : ''}`}>
                <input
                  type="radio"
                  name={`semaine-${vetoId}`}
                  value={p}
                  checked={saisie.semaine === p}
                  onChange={() => setSaisie({ ...saisie, semaine: p })}
                />
                <span>{LIBELLE_PARITE[p]}</span>
              </label>
            ))}
          </span>
        </label>
      </div>

      {/* La convention de parité, dite une fois, à l'endroit où elle se décide.
          « Semaines impaires » n'a de sens que si l'admin sait de quel comptage
          on parle — et c'est le même que celui des règles de garde, exprès. */}
      {saisie.semaine !== 'toutes' && (
        <p className="tj-note">
          Les semaines paires et impaires suivent le numéro de semaine du calendrier, comme dans les
          règles de gardes.
        </p>
      )}

      <div className="tj-form-actions">
        <button type="submit" className="btn btn-accent btn-sm" disabled={enCours}>
          {enCours ? 'Enregistrement…' : libelleBouton}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={fermer} disabled={enCours}>
          Annuler
        </button>
      </div>
    </form>
  )

  return (
    <div className="card tj-card">
      <div className="card-head">
        <h2>Les présences récurrentes</h2>
      </div>

      <div className="card-body">
        <p className="tj-lede">
          Pour chacun, les jours où il est là d’habitude. Vous décrivez la règle une fois ; elle
          servira à remplir le planning sans tout ressaisir.
        </p>

        {/* ⚠️ PHRASE CORRIGÉE AU LOT 2 (06/10), ET C'EST LA RÈGLE DU PROJET QUI
            L'EXIGEAIT. Elle disait « ces règles ne remplissent pas encore le
            planning » — vrai au lot 1, FAUX depuis qu'un geste les applique
            (`AppliquerTrames`, juste en dessous). La question à se poser quand
            une capacité apparaît n'est pas « faut-il un écran ? » mais « une
            phrase déjà affichée devient-elle fausse ? ».

            Ce qu'elle doit continuer à dire, en revanche, reste vrai et compte
            autant : enregistrer une règle ne pose TOUJOURS rien par lui-même.
            C'est la décision ⑤ du cadrage V3 — sans quoi l'admin perdrait ses
            retouches en corrigeant une faute de frappe. */}
        <p className="tj-avis" role="status">
          <span className="tj-avis-icone" aria-hidden="true">
            !
          </span>
          <span>
            Enregistrer une règle ne pose aucune présence et ne change aucune journée déjà prévue.
            C’est le geste <b>« Remplir le planning des journées »</b>, en dessous, qui les pose
            sur un planning.
          </span>
        </p>

        {refus && (
          <div className="tj-refus" role="alert">
            {refus}
          </div>
        )}

        {blocsProposables.length === 0 ? (
          /* Sans tranche active, aucune trame n'est saisissable — et le dire
             vaut mieux que d'afficher un formulaire dont tous les choix sont
             vides. L'admin doit savoir OÙ aller. */
          <p className="tj-vide">
            Définissez d’abord au moins une tranche horaire ci-dessus : une présence a besoin d’une
            tranche pour s’écrire.
          </p>
        ) : (
          <ul className="tj-equipe">
            {equipe.map((v) => {
              const miennes = trames.filter((t) => t.veterinaire_id === v.id)
              const actives = miennes.filter((t) => t.actif)
              const retirees = miennes.filter((t) => !t.actif)

              return (
                <li key={v.id} className="tj-personne">
                  <div className="tj-personne-tete">
                    <span className="tj-prenom">
                      {v.prenom} {v.nom}
                    </span>
                    {ajoutPour !== v.id && edite === null && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => ouvrirAjout(v.id)}
                        disabled={enCours}
                      >
                        Ajouter une présence
                      </button>
                    )}
                  </div>

                  {actives.length === 0 && retirees.length === 0 && ajoutPour !== v.id && (
                    <p className="tj-aucune">Aucune présence récurrente.</p>
                  )}

                  <ul className="tj-lignes">
                    {actives.map((t) => (
                      <li key={t.id} className="tj-ligne">
                        {edite === t.id ? (
                          formulaire(
                            v.id,
                            () =>
                              lancer(() =>
                                modifierTrame(t.id, { ...saisie, veterinaire_id: v.id }),
                              ),
                            'Enregistrer',
                          )
                        ) : (
                          <>
                            <span className="tj-phrase">{phraseTrame(t, nomBloc(t.bloc_id))}</span>
                            <span className="tj-actions">
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => ouvrirEdition(t)}
                                disabled={enCours}
                              >
                                Modifier
                              </button>
                              {/* « Retirer », pas « Supprimer » — et le mot est
                                  exact : au lot 2, les présences déjà posées
                                  par cette ligne survivront. Dire « supprimer »
                                  ferait croire à l'admin qu'elle a défait le
                                  planning. */}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => lancer(() => basculerTrame(t.id, false))}
                                disabled={enCours}
                              >
                                Retirer
                              </button>
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>

                  {ajoutPour === v.id &&
                    formulaire(
                      v.id,
                      () => lancer(() => creerTrame({ ...saisie, veterinaire_id: v.id })),
                      'Ajouter cette présence',
                    )}

                  {retirees.length > 0 && (
                    <div className="tj-retirees">
                      <span className="tj-retirees-titre">Retirées</span>
                      <ul className="tj-lignes">
                        {retirees.map((t) => (
                          <li key={t.id} className="tj-ligne inactive">
                            <span className="tj-phrase">{phraseTrame(t, nomBloc(t.bloc_id))}</span>
                            <span className="tj-actions">
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => lancer(() => basculerTrame(t.id, true))}
                                disabled={enCours}
                              >
                                Remettre
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
