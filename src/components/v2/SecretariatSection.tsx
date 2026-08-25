'use client'

// ============================================================
// GUARDVETO V2 — Le SECRÉTARIAT dans l'écran Équipe (B-017, lot 3)
// ============================================================
// MiKL, le 2026-08-25 : « il faut bien qu'il soit distingué dans l'équipe par
// rapport aux vétos — ce n'est pas un véto ».
//
// D'où une SECTION à part, sous la grille des vétérinaires, et non des cartes
// mêlées aux leurs. Ce n'est pas qu'une affaire de rangement : une fiche de
// secrétariat n'a ni couleur de planning, ni statut, ni étiquettes, ni
// contraintes — la moitié d'une carte de vétérinaire n'aurait rien à y mettre.
// Et surtout, le modèle lui-même les sépare : elles vivent dans une autre
// table, que le moteur de génération ne lit jamais.
//
// ── UNE FICHE N'EST PAS UNE PERSONNE ────────────────────────────────────────
//
// Chez Val d'Allier, trois secrétaires partagent un compte : le cabinet crée
// UNE fiche « Secrétariat ». Ailleurs, ce seront trois fiches nominatives.
// L'aide sous le titre le dit, parce que rien dans l'écran ne le laisserait
// deviner — et qu'une administratrice qui l'ignore créera trois fiches pour
// trois personnes qui voulaient un seul mot de passe.
//
// ── L'ÉTAT DU COMPTE NE PRÉTEND PAS SAVOIR CE QU'IL IGNORE ──────────────────
//
// ⚠️ Trois états seulement : pas d'adresse · jamais invitée · compte créé.
// On n'écrit PAS « invitation envoyée » tant qu'on ne peut pas savoir si la
// personne s'est connectée depuis. C'est l'incident du 2026-08-21 : Fanny
// s'affichait « Invitation envoyée » alors qu'elle s'était connectée la veille
// — un drapeau déclaratif qu'une seule ligne de code faisait retomber, et qui
// a menti pendant deux mois. Ici, l'état est DÉDUIT de ce que l'écran lit
// vraiment : une fiche a un compte, ou elle n'en a pas.
// ============================================================

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, Power, UserPlus, X } from 'lucide-react'
import { adresseUtilisable } from '@/lib/emails/destinataire'
import { useErreurBloquante } from '@/components/v2/regles/ErreurBloquante'
import {
  basculerSecretaireActif,
  creerSecretaire,
  inviterSecretaire,
  modifierSecretaire,
} from '@/app/(v2)/equipe/secretariat-actions'

export interface FicheSecretariat {
  id: string
  nom: string
  email: string | null
  aUnCompte: boolean
  actif: boolean
}

/** Ce qu'on peut affirmer sans rien supposer. Voir l'en-tête. */
type EtatCompte = 'inactif' | 'sans-adresse' | 'jamais-invitee' | 'compte-cree'

function etatDe(s: FicheSecretariat): EtatCompte {
  if (!s.actif) return 'inactif'
  if (s.aUnCompte) return 'compte-cree'
  if (!adresseUtilisable(s.email)) return 'sans-adresse'
  return 'jamais-invitee'
}

const LIBELLE: Record<EtatCompte, string> = {
  inactif: 'Désactivée',
  'sans-adresse': 'Pas encore d’adresse',
  'jamais-invitee': 'Jamais invitée',
  'compte-cree': 'Compte créé',
}

export function SecretariatSection({ fiches }: { fiches: FicheSecretariat[] }) {
  const [isPending, demarrer] = useTransition()
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  /** `null` = fermé · `'neuve'` = création · un id = modification. */
  const [edition, setEdition] = useState<string | null>(null)
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')

  const ouvrirCreation = () => {
    setEdition('neuve')
    setNom('')
    setEmail('')
  }

  const ouvrirModification = (s: FicheSecretariat) => {
    setEdition(s.id)
    setNom(s.nom)
    setEmail(s.email ?? '')
  }

  const enregistrer = () => {
    demarrer(async () => {
      const res =
        edition === 'neuve'
          ? await creerSecretaire({ nom, email })
          : await modifierSecretaire(edition as string, { nom, email })

      if ('error' in res) {
        // Refus en modale, succès en toast : un refus qui s'efface tout seul
        // au bout de trois secondes est un refus que personne n'a lu.
        ouvrirErreur(res.error, { titre: 'La fiche n’a pas été enregistrée' })
        return
      }
      toast.success(edition === 'neuve' ? 'Fiche créée' : 'Fiche enregistrée')
      setEdition(null)
    })
  }

  const inviter = (s: FicheSecretariat) => {
    demarrer(async () => {
      const res = await inviterSecretaire(s.id)
      if ('error' in res) {
        ouvrirErreur(res.error, { titre: 'L’invitation n’est pas partie' })
        return
      }
      toast.success(`Invitation envoyée à ${res.email}`)
    })
  }

  const basculer = (s: FicheSecretariat) => {
    demarrer(async () => {
      const res = await basculerSecretaireActif(s.id, !s.actif)
      if ('error' in res) {
        ouvrirErreur(res.error, { titre: 'L’état n’a pas changé' })
        return
      }
      toast.success(s.actif ? 'Accès retiré' : 'Accès rétabli')
    })
  }

  return (
    <>
      {dialogueErreur}

      <section className="secr-bloc rise rise-3" aria-labelledby="secr-titre">
        <div className="secr-tete">
          <div>
            <h2 id="secr-titre">Secrétariat</h2>
            <p className="secr-lede">
              Le secrétariat consulte le planning diffusé et voit qui est absent. Il ne modifie
              rien, et n’a accès ni aux règles, ni aux compteurs, ni à Filou.{' '}
              <b>Une fiche, un accès</b> — si plusieurs personnes partagent le même identifiant,
              une seule fiche « Secrétariat » suffit.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-valider btn-sm"
            onClick={ouvrirCreation}
            disabled={isPending}
          >
            <UserPlus aria-hidden="true" />
            Ajouter
          </button>
        </div>

        {/* Le formulaire, replié tant qu'on n'en a pas besoin : cette section
            sert à consulter neuf fois sur dix. */}
        {edition && (
          <div className="secr-form">
            <div className="secr-champs">
              <div className="field">
                <label htmlFor="secr-nom">Nom affiché</label>
                <input
                  id="secr-nom"
                  type="text"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder="Ex. : Secrétariat"
                  autoComplete="off"
                  disabled={isPending}
                />
              </div>
              <div className="field">
                <label htmlFor="secr-mail">E-mail (facultatif)</label>
                <input
                  id="secr-mail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="secretariat@cabinet.fr"
                  autoComplete="off"
                  disabled={isPending}
                />
                <p className="cf-aide">Nécessaire seulement pour envoyer l’invitation.</p>
              </div>
            </div>
            <div className="secr-form-actions">
              <button
                type="button"
                className="btn btn-valider"
                onClick={enregistrer}
                disabled={isPending}
              >
                {isPending ? 'Enregistrement…' : edition === 'neuve' ? 'Créer la fiche' : 'Enregistrer'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEdition(null)}
                disabled={isPending}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {fiches.length === 0 ? (
          <p className="secr-vide">
            Aucun accès secrétariat pour l’instant. Ajoute une fiche pour que l’accueil puisse
            consulter le planning sans passer par toi.
          </p>
        ) : (
          <ul className="secr-liste">
            {fiches.map((s) => {
              const etat = etatDe(s)
              return (
                <li key={s.id} className={`secr-carte${s.actif ? '' : ' inactive'}`}>
                  <span className="secr-avatar" aria-hidden="true">
                    {s.nom.charAt(0).toUpperCase()}
                  </span>

                  <div className="secr-ident">
                    <h3>{s.nom}</h3>
                    {adresseUtilisable(s.email) ? (
                      <p className="vet-mail">{s.email}</p>
                    ) : (
                      <p className="vet-mail sans-adresse">Pas encore d’adresse e-mail</p>
                    )}
                  </div>

                  <span className={`secr-etat et-${etat}`}>{LIBELLE[etat]}</span>

                  <div className="secr-outils">
                    {/* Sans adresse, l'invitation n'a nulle part où aller. Le
                        bouton est désactivé plutôt que masqué : masqué, il ne
                        dirait pas pourquoi. Le serveur refuse de toute façon,
                        avec la même phrase. */}
                    {s.actif && etat !== 'compte-cree' && (
                      <button
                        type="button"
                        className="acct-cta"
                        onClick={() => inviter(s)}
                        disabled={isPending || !adresseUtilisable(s.email)}
                        title={
                          adresseUtilisable(s.email)
                            ? `Inviter ${s.nom}`
                            : 'Renseigne d’abord une adresse e-mail.'
                        }
                      >
                        Inviter
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => ouvrirModification(s)}
                      disabled={isPending}
                      title={`Modifier ${s.nom}`}
                      aria-label={`Modifier ${s.nom}`}
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={s.actif ? 'vo-danger' : ''}
                      onClick={() => basculer(s)}
                      disabled={isPending}
                      title={
                        s.actif
                          ? `Retirer l’accès de ${s.nom} — la fiche est conservée`
                          : `Rétablir l’accès de ${s.nom}`
                      }
                      aria-label={s.actif ? `Retirer l’accès de ${s.nom}` : `Rétablir l’accès de ${s.nom}`}
                    >
                      {s.actif ? <Power aria-hidden="true" /> : <X aria-hidden="true" />}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
