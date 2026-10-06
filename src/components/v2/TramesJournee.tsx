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
  creerTrames,
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
  // `jours` au PLURIEL (B-147) : une saisie peut viser lundi + mardi + jeudi
  // d'un coup. L'édition, elle, ne porte toujours qu'une ligne — elle place
  // donc un seul jour dans la liste, et le formulaire s'y adapte.
  const [saisie, setSaisie] = useState<{ bloc_id: string; jours: string[]; semaine: string }>({
    bloc_id: '',
    jours: ['lundi'],
    semaine: 'toutes',
  })

  /** Seules les tranches ACTIVES sont proposées — une retirée serait refusée. */
  const blocsProposables = blocs.filter((b) => b.actif)
  const nomBloc = (id: string) => blocs.find((b) => b.id === id)?.nom ?? 'tranche inconnue'

  const fermer = () => {
    setEdite(null)
    setAjoutPour(null)
    setSaisie({ bloc_id: blocsProposables[0]?.id ?? '', jours: ['lundi'], semaine: 'toutes' })
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
    setSaisie({ bloc_id: blocsProposables[0]?.id ?? '', jours: ['lundi'], semaine: 'toutes' })
  }

  const ouvrirEdition = (t: TrameJournee) => {
    setRefus(null)
    setAjoutPour(null)
    setEdite(t.id)
    setSaisie({ bloc_id: t.bloc_id, jours: [t.jour], semaine: t.semaine })
  }

  /** Coche ou décoche un jour, sans jamais laisser la liste vide en édition. */
  const basculerJour = (j: string, multi: boolean) => {
    if (!multi) {
      setSaisie({ ...saisie, jours: [j] })
      return
    }
    const deja = saisie.jours.includes(j)
    // Décocher le dernier jour laisserait un formulaire qui ne peut qu'échouer.
    // On garde donc au moins une case : le serveur refuse aussi une liste vide,
    // mais mieux vaut ne pas proposer le geste que d'afficher son refus.
    if (deja && saisie.jours.length === 1) return
    setSaisie({
      ...saisie,
      jours: deja ? saisie.jours.filter((x) => x !== j) : [...saisie.jours, j],
    })
  }

  const formulaire = (
    vetoId: string,
    surSoumission: () => void,
    libelleBouton: string,
    /** Création : plusieurs jours. Édition : une ligne, donc un seul. */
    multi: boolean,
  ) => (
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
          <span className="f-label">{multi ? 'Jours' : 'Jour'}</span>
          {/* B-147 — EN CRÉATION, PLUSIEURS JOURS. Une habitude se décrit
              « lundi, mardi et jeudi », pas en trois saisies identiques. En
              ÉDITION on reste sur un seul : on modifie UNE ligne précise, et
              laisser cocher plusieurs jours laisserait croire qu'on peut en
              fabriquer d'autres depuis un formulaire de modification. */}
          <span className="tj-radios">
            {JOURS_TRAME.map((j) => {
              const choisi = saisie.jours.includes(j)
              return (
                <label key={j} className={`tj-radio${choisi ? ' actif' : ''}`}>
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    name={`jour-${vetoId}`}
                    value={j}
                    checked={choisi}
                    onChange={() => basculerJour(j, multi)}
                  />
                  <span>{LIBELLE_JOUR[j]}</span>
                </label>
              )
            })}
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

            ⚠️ CORRIGÉE UNE SECONDE FOIS LE MÊME JOUR (B-148). Elle disait « le
            geste en dessous » — vrai pendant deux heures, faux dès que MiKL a
            renvoyé ce geste sur l'écran Planning, à sa vraie place. Une phrase
            qui désigne un VOISIN est fragile par nature : elle ment dès que le
            voisin déménage, et rien ne la suit.

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
            C’est depuis l’écran <b>Planning</b>, avec le bouton <b>Générer</b>, que ces règles
            remplissent réellement un planning.
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
                                modifierTrame(t.id, {
                                  bloc_id: saisie.bloc_id,
                                  // Une modification porte UNE ligne : le
                                  // formulaire n'a laissé cocher qu'un jour.
                                  jour: saisie.jours[0] ?? '',
                                  semaine: saisie.semaine,
                                  veterinaire_id: v.id,
                                }),
                              ),
                            'Enregistrer',
                            false,
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
                      () => lancer(() => creerTrames({ ...saisie, veterinaire_id: v.id })),
                      saisie.jours.length > 1
                        ? `Ajouter ces ${saisie.jours.length} présences`
                        : 'Ajouter cette présence',
                      true,
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
