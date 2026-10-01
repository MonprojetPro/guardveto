'use client'

// ============================================================
// GUARDVETO V2 — Les tranches horaires de la journée
// ============================================================
// B-120 chantier 2, l'écran. Il n'y a volontairement RIEN d'autre ici : pas de
// grille de présence, pas de trame. C'est le vocabulaire du module, et le
// chantier 3 viendra écrire dedans.
//
// ── CE QUE CET ÉCRAN DIT, ET QUI N'EST PAS DÉCORATIF ────────────────────────
//
// Chaque tranche affiche son RATTACHEMENT (« compte comme : Matin »). Ce n'est
// pas un détail technique exposé par paresse : c'est ce qui décidera, au
// chantier 3, qu'un congé du matin retire la présence du matin. L'admin doit
// pouvoir le lire et le corriger AVANT que des présences en dépendent — après,
// le changer déplacerait des absences déjà vécues.
//
// ── LES REFUS EN MODALE, LES SUCCÈS SANS BRUIT ──────────────────────────────
// Convention du projet (`lib/regles/refus.ts`) : un refus s'affiche et attend
// d'être lu, un succès se voit dans la liste qui vient de changer. Les
// messages viennent du SERVEUR, repris mot pour mot — jamais reformulés ici,
// sinon la même erreur aurait deux formulations selon le chemin.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { BlocJournee } from '@/types'
import { CRENEAUX_BLOC, LIBELLE_CRENEAU, plageLisible } from '@/lib/journee/blocs'
import { creerBloc, modifierBloc, basculerBloc } from '@/app/(v2)/journee/actions'

interface Props {
  blocs: BlocJournee[]
}

/** Une saisie vierge. Des horaires plausibles valent mieux qu'un champ vide. */
const VIERGE = { nom: '', debut: '08:00', fin: '12:00', creneau: 'matin' as string }

export function BlocsJournee({ blocs }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [refus, setRefus] = useState<string | null>(null)
  /** `null` = personne en édition ; sinon l'id de la tranche ouverte. */
  const [edite, setEdite] = useState<string | null>(null)
  const [ajout, setAjout] = useState(false)
  const [saisie, setSaisie] = useState(VIERGE)

  const fermer = () => {
    setAjout(false)
    setEdite(null)
    setSaisie(VIERGE)
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
      // `revalidatePath` côté serveur ne suffit pas à rafraîchir cette vue :
      // il invalide le cache, `router.refresh()` redemande le rendu.
      router.refresh()
    })
  }

  const ouvrirEdition = (b: BlocJournee) => {
    setRefus(null)
    setAjout(false)
    setEdite(b.id)
    setSaisie({
      nom: b.nom,
      // Postgres rend `08:00:00`, un `<input type="time">` veut `08:00`.
      debut: b.debut.slice(0, 5),
      fin: b.fin.slice(0, 5),
      creneau: b.creneau,
    })
  }

  const formulaire = (surSoumission: () => void, libelleBouton: string) => (
    <form
      className="bj-form"
      onSubmit={(e) => {
        e.preventDefault()
        surSoumission()
      }}
    >
      <div className="bj-form-grid">
        <label className="field">
          <span className="f-label">Nom de la tranche</span>
          <input
            type="text"
            value={saisie.nom}
            maxLength={40}
            required
            placeholder="Matin, Visites, Journée complète…"
            onChange={(e) => setSaisie({ ...saisie, nom: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="f-label">De</span>
          <input
            type="time"
            value={saisie.debut}
            required
            onChange={(e) => setSaisie({ ...saisie, debut: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="f-label">À</span>
          <input
            type="time"
            value={saisie.fin}
            required
            onChange={(e) => setSaisie({ ...saisie, fin: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="f-label">Compte comme</span>
          {/* ⚠️ JAMAIS de `<select>` natif sur ce projet — règle du design
              system. Des boutons radio, qui montrent les trois choix d'un
              coup : il n'y en a que trois, les cacher derrière un déroulant
              aurait demandé un clic pour lire une information courte. */}
          <span className="bj-radios">
            {CRENEAUX_BLOC.map((c) => (
              <label key={c} className={`bj-radio${saisie.creneau === c ? ' actif' : ''}`}>
                <input
                  type="radio"
                  name="creneau"
                  value={c}
                  checked={saisie.creneau === c}
                  onChange={() => setSaisie({ ...saisie, creneau: c })}
                />
                <span>{LIBELLE_CRENEAU[c]}</span>
              </label>
            ))}
          </span>
          <span className="f-note">
            Ce que retire un congé posé sur ce moment de la journée.
          </span>
        </label>
      </div>
      <div className="bj-form-actions">
        <button type="submit" className="btn btn-accent btn-sm" disabled={enCours}>
          {enCours ? 'Enregistrement…' : libelleBouton}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={fermer} disabled={enCours}>
          Annuler
        </button>
      </div>
    </form>
  )

  const actives = blocs.filter((b) => b.actif)
  const retirees = blocs.filter((b) => !b.actif)

  return (
    <div className="card bj-card">
      <div className="card-head">
        <h2>Les tranches horaires de la journée</h2>
      </div>

      <p className="bj-lede">
        Les moments de la journée que votre cabinet reconnaît. Le planning de journée s’écrira
        dans ces tranches. Elles peuvent se recouvrir : « Journée complète » contient le matin et
        l’après-midi, c’est normal.
      </p>

      {refus && (
        <div className="bj-refus" role="alert">
          {refus}
        </div>
      )}

      {actives.length === 0 && !ajout && (
        <p className="bj-vide">
          Aucune tranche définie pour le moment. Ajoutez-en une pour commencer.
        </p>
      )}

      <ul className="bj-liste">
        {actives.map((b) => (
          <li key={b.id} className="bj-ligne">
            {edite === b.id ? (
              formulaire(
                () => lancer(() => modifierBloc(b.id, saisie)),
                'Enregistrer les changements',
              )
            ) : (
              <>
                <span className="bj-nom">{b.nom}</span>
                <span className="bj-plage">{plageLisible(b.debut, b.fin)}</span>
                <span className="bj-creneau">compte comme : {LIBELLE_CRENEAU[b.creneau]}</span>
                <span className="bj-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => ouvrirEdition(b)}
                    disabled={enCours}
                  >
                    Modifier
                  </button>
                  {/* « Retirer », pas « Supprimer » — et le mot est exact : la
                      tranche sort des choix, elle n'est pas effacée. Dire
                      « supprimer » pour une désactivation serait un mensonge
                      d'interface, et le jour où une présence existe dessus,
                      l'admin croirait avoir tout effacé. */}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => lancer(() => basculerBloc(b.id, false))}
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

      {ajout
        ? formulaire(() => lancer(() => creerBloc(saisie)), 'Ajouter cette tranche')
        : edite === null && (
            <button
              type="button"
              className="btn btn-accent btn-sm bj-ajouter"
              onClick={() => {
                setRefus(null)
                setSaisie(VIERGE)
                setAjout(true)
              }}
            >
              Ajouter une tranche
            </button>
          )}

      {retirees.length > 0 && (
        <div className="bj-retirees">
          <h3>Tranches retirées</h3>
          <p className="f-note">
            Elles ne sont plus proposées. Ce qui a déjà été posé dessus reste en place.
          </p>
          <ul className="bj-liste">
            {retirees.map((b) => (
              <li key={b.id} className="bj-ligne inactive">
                <span className="bj-nom">{b.nom}</span>
                <span className="bj-plage">{plageLisible(b.debut, b.fin)}</span>
                <span className="bj-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => lancer(() => basculerBloc(b.id, true))}
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
    </div>
  )
}
