'use client'

// ============================================================
// GUARDVETO V2 — Écran « Équipe »
// ============================================================
// Porté de `maquette/m4-accueil-equipe-historique-connexions.html` (section 2).
//
// Ce qui est PORTÉ (le look) : la grille de fiches colorées, le panneau
// « créer une fiche » qui se déplie, le garde-fou de désactivation qui montre
// les gardes plutôt que de demander « êtes-vous sûr ? ».
//
// Ce qui est RÉUTILISÉ tel quel (les règles métier) : les quatre actions
// serveur de `/admin/veterinaires` (création, modification, invitation,
// activation). On ne réécrit pas une action qui porte une garde admin, une
// résolution de cabinet et un garde-fou sur les gardes publiées.
//
// Ce qui est AJOUTÉ vs la maquette : nom de famille et e-mail dans le
// formulaire. La maquette ne demandait qu'un prénom ; sans e-mail, la création
// échoue côté serveur et l'invitation est impossible.
//
// ── Deux corrections du 2026-07-31 (retour MiKL « c'est fouilli ») ──────────
//
// 1. LA CARTE. Le portage avait empilé cinq bandes de pilules qui se
//    ressemblaient toutes, et jusqu'à cinq boutons de même poids qui passaient
//    à la ligne — d'où des cartes de hauteurs différentes dans la grille. On
//    revient à quatre zones franches et à une barre d'action de forme FIXE :
//    l'état du compte porte sa propre action (inviter / relancer / réactiver),
//    les trois autres restent en dessous, discrètes.
//
// 2. LES CONTRAINTES. `ContraintesSection` (V1) se dépliait ici et lisait
//    `contraintes_veto` — table que le moteur n'utilise plus depuis P1A-004.
//    Elle montrait une copie figée et son crayon écrivait dans le vide. Elle
//    est remplacée par `ContraintesVetoModale`, branchée sur `regles_cabinet`.
// ============================================================

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ContraintesVetoModale } from '@/components/v2/ContraintesVetoModale'
import { reglesDuVeto } from '@/lib/regles/libelle'
import type {
  PeriodeOption,
  RegleRow,
  TypeCreneauOption,
  VetoMini,
} from '@/components/regles/ReglesClient'
import {
  createVeterinaire,
  updateVeterinaire,
  inviterVeterinaire,
  toggleVeterinaireActif,
  type GardeAVenir,
  type VeterinaireFormData,
} from '@/app/(protected)/admin/veterinaires/actions'
import type { StatutVeto, UserRole, Veterinaire } from '@/types'

/** Palette du Terrier — les valeurs partent en base, donc en dur, pas en var(). */
const COULEURS = [
  { hex: '#C7530F', nom: 'Orange terrier' },
  { hex: '#2E7A8C', nom: 'Bleu canard' },
  { hex: '#7A5FBE', nom: 'Violet doux' },
  { hex: '#8A7A1E', nom: 'Olive doré' },
  { hex: '#3B6FD1', nom: 'Bleu franc' },
  { hex: '#B93A72', nom: 'Framboise' },
  { hex: '#0B7D6C', nom: 'Vert lagon' },
  { hex: '#A0522D', nom: 'Terre de Sienne' },
]

/** Étiquettes proposées d'office — la saisie libre reste possible. */
const TAGS_PRESETS = ['junior', 'senior']

const LIBELLE_TYPE_GARDE: Record<string, string> = {
  semaine: 'nuit de semaine',
  weekend: 'week-end',
  ferie: 'jour férié',
}

/** L'état du compte, tel qu'il se lit sur la fiche. */
type EtatCompte = 'actif' | 'invite' | 'sans' | 'inactif'

const LIBELLE_COMPTE: Record<EtatCompte, string> = {
  actif: 'Compte actif',
  invite: 'Invitation envoyée',
  sans: 'Sans compte',
  inactif: 'Fiche désactivée',
}

function etatCompte(v: Veterinaire): EtatCompte {
  if (!v.actif) return 'inactif'
  if (!v.user_id) return 'sans'
  if (v.invite_pending) return 'invite'
  return 'actif'
}

function formatGarde(g: GardeAVenir): string {
  const jour = new Date(`${g.date}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return jour.charAt(0).toUpperCase() + jour.slice(1)
}

// NOTE — la base ne stocke pas le genre des vétos, et on ne va pas le deviner
// d'après un prénom. Tous les messages de cet écran sont donc tournés sur la
// FICHE (« sa fiche est désactivée ») plutôt que sur la personne, ce qui évite
// autant les accords faux que les « désactivé·e » à chaque phrase.

// ── Le formulaire, partagé entre création et modification ──────────────────

interface FormState {
  prenom: string
  nom: string
  email: string
  statut: StatutVeto
  role_app: UserRole
  couleur: string
  dernier_recours: boolean
  tags: string[]
}

const FORM_VIDE: FormState = {
  prenom: '',
  nom: '',
  email: '',
  statut: 'salarie',
  role_app: 'veto',
  couleur: COULEURS[0].hex,
  dernier_recours: false,
  tags: [],
}

function formDepuisVeto(v: Veterinaire): FormState {
  return {
    prenom: v.prenom,
    nom: v.nom,
    email: v.email,
    statut: v.statut,
    role_app: v.role_app,
    couleur: v.couleur,
    dernier_recours: v.dernier_recours,
    tags: v.tags ?? [],
  }
}

interface Props {
  vets: Veterinaire[]
  /** Les règles du cabinet — LA source du moteur. Filtrées par véto à l'affichage. */
  regles: RegleRow[]
  periodes: PeriodeOption[]
  typesCreneaux: TypeCreneauOption[]
  /** Le véto connecté : on ne lui laisse pas retirer son propre accès admin. */
  moiId: string
}

export function EquipeV2({ vets, regles, periodes, typesCreneaux, moiId }: Props) {
  const [isPending, startTransition] = useTransition()

  // Panneau de formulaire : fermé, en création, ou en modification d'une fiche.
  const [edition, setEdition] = useState<{ veto: Veterinaire | null } | null>(null)
  const [form, setForm] = useState<FormState>(FORM_VIDE)
  const [erreur, setErreur] = useState<string | null>(null)
  const [tagLibre, setTagLibre] = useState('')

  // La fiche dont on consulte les contraintes (modale).
  const [ficheContraintes, setFicheContraintes] = useState<Veterinaire | null>(null)

  // Garde-fou : les gardes publiées que la désactivation laisserait orphelines.
  const [garde, setGarde] = useState<{ veto: Veterinaire; gardes: GardeAVenir[] } | null>(null)

  const actifs = useMemo(() => vets.filter((v) => v.actif), [vets])
  const comptesActifs = useMemo(
    () => vets.filter((v) => v.actif && v.user_id && !v.invite_pending).length,
    [vets],
  )
  // Le décompte affiché sur la carte doit être EXACTEMENT celui de la modale :
  // même filtre, même dédoublonnage des duos. D'où l'appel au même sélecteur
  // plutôt qu'à un `filter` maison qui aurait compté les duos deux fois.
  const nbContraintes = useMemo(() => {
    const par = new Map<string, number>()
    for (const v of vets) par.set(v.id, reglesDuVeto(regles, v.id).filter((r) => r.actif).length)
    return par
  }, [regles, vets])

  /** Les vétos tels que les attend le formulaire de règle (forme partagée). */
  const vetsMini: VetoMini[] = useMemo(
    () => vets.map((v) => ({ id: v.id, prenom: v.prenom, nom: v.nom, couleur: v.couleur })),
    [vets],
  )

  // ── Ouverture / fermeture du panneau ────────────────────────────────────
  const ouvrirCreation = () => {
    if (edition && edition.veto === null) {
      setEdition(null)
      return
    }
    setForm(FORM_VIDE)
    setErreur(null)
    setTagLibre('')
    setEdition({ veto: null })
  }

  const ouvrirModification = (v: Veterinaire) => {
    setForm(formDepuisVeto(v))
    setErreur(null)
    setTagLibre('')
    setEdition({ veto: v })
  }

  const fermerPanneau = () => {
    setEdition(null)
    setErreur(null)
  }

  // ── Enregistrement ──────────────────────────────────────────────────────
  const enregistrer = (e: React.FormEvent) => {
    e.preventDefault()
    if (!edition) return

    const prenom = form.prenom.trim()
    const nom = form.nom.trim()
    const email = form.email.trim()

    if (!prenom) return setErreur('Il manque le prénom.')
    if (!nom) return setErreur('Il manque le nom.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setErreur("L'e-mail n'a pas l'air valide — c'est lui qui sert à inviter.")
    }
    setErreur(null)

    // `actif` : on ne le pilote pas depuis ce formulaire. Une fiche naît
    // active ; on la désactive par le bouton dédié, qui a son garde-fou.
    const cible = edition.veto
    const donnees: VeterinaireFormData = {
      prenom,
      nom,
      email,
      statut: form.statut,
      role_app: form.role_app,
      couleur: form.couleur,
      actif: cible ? cible.actif : true,
      dernier_recours: form.dernier_recours,
      tags: form.tags,
    }

    startTransition(async () => {
      const res = cible
        ? await updateVeterinaire(cible.id, donnees)
        : await createVeterinaire(donnees)

      if (res && 'error' in res && res.error) {
        setErreur(res.error)
        return
      }
      toast.success(
        cible
          ? `Fiche de ${prenom} mise à jour`
          : `Fiche de ${prenom} créée · sans compte pour l'instant`,
      )
      fermerPanneau()
    })
  }

  // ── Invitation ──────────────────────────────────────────────────────────
  const inviter = (v: Veterinaire) => {
    startTransition(async () => {
      const res = await inviterVeterinaire(v.id)
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Invitation envoyée à ${v.prenom} ✉️`)
    })
  }

  // ── Activation / désactivation ──────────────────────────────────────────
  const basculerActif = (v: Veterinaire) => {
    startTransition(async () => {
      const res = await toggleVeterinaireActif(v.id, !v.actif)
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      // Le serveur a trouvé des gardes publiées à venir : on les montre.
      if ('requiresConfirmation' in res) {
        setGarde({ veto: v, gardes: res.gardesAVenir })
        return
      }
      toast.success(
        v.actif
          ? `${v.prenom} n'entre plus dans les prochaines générations`
          : `${v.prenom} est de retour dans l'équipe`,
      )
    })
  }

  const confirmerDesactivation = () => {
    if (!garde) return
    const v = garde.veto
    const n = garde.gardes.length
    startTransition(async () => {
      const res = await toggleVeterinaireActif(v.id, false, true)
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      setGarde(null)
      toast.success(
        `Fiche de ${v.prenom} désactivée${
          n > 0 ? ` · ${n} garde${n > 1 ? 's' : ''} à réattribuer` : ''
        }`,
      )
    })
  }

  // ── Étiquettes ──────────────────────────────────────────────────────────
  const basculerTag = (tag: string) => {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }))
  }

  const ajouterTagLibre = () => {
    const t = tagLibre.trim().toLowerCase()
    setTagLibre('')
    if (t === '' || form.tags.includes(t)) return
    setForm((f) => ({ ...f, tags: [...f.tags, t] }))
  }

  const panneauOuvert = edition !== null
  const enModification = edition?.veto ?? null

  return (
    <>
      {/* ── Tête de page ─────────────────────────────────────────────── */}
      <div className="page-head rise">
        <div>
          <p className="page-kicker">Équipe</p>
          <h1>Une fiche par personne. L&apos;app reconnaît les gens.</h1>
          <p className="lede">
            La couleur suit chaque véto partout : sur le planning, dans les compteurs, dans les
            échanges. L&apos;état du compte dit qui peut réellement entrer dans l&apos;app —
            créer une fiche n&apos;ouvre pas d&apos;accès, il faut inviter.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-accent"
            onClick={ouvrirCreation}
            aria-expanded={panneauOuvert && enModification === null}
            aria-controls="panneau-fiche"
          >
            + Créer une fiche
          </button>
        </div>
      </div>

      <div className="team-toolbar rise rise-2">
        <span className="team-count">
          {vets.length} fiche{vets.length > 1 ? 's' : ''} · {actifs.length} active
          {actifs.length > 1 ? 's' : ''} · {comptesActifs} compte
          {comptesActifs > 1 ? 's' : ''} actif{comptesActifs > 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Le panneau qui se déplie ─────────────────────────────────── */}
      <div
        className={`create-panel${panneauOuvert ? ' open' : ''}`}
        id="panneau-fiche"
        aria-hidden={!panneauOuvert}
      >
        <form className="create-inner" onSubmit={enregistrer}>
          <h3>
            {enModification
              ? `Fiche de ${enModification.prenom} ${enModification.nom}`
              : 'Nouvelle fiche vétérinaire'}
          </h3>
          <p className="cf-lede">
            {enModification
              ? "Le nom et la couleur se répercutent partout où cette personne apparaît."
              : "La fiche est créée sans compte : tu l'invites quand tu veux, depuis sa carte."}
          </p>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="cf-prenom">Prénom</label>
              <input
                id="cf-prenom"
                type="text"
                value={form.prenom}
                onChange={(e) => setForm({ ...form, prenom: e.target.value })}
                placeholder="Ex. : Léa"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="cf-nom">Nom</label>
              <input
                id="cf-nom"
                type="text"
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                placeholder="Ex. : Marchand"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="cf-email">E-mail</label>
              <input
                id="cf-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="lea.marchand@cabinet.fr"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="cf-statut">Statut</label>
              <select
                id="cf-statut"
                value={form.statut}
                onChange={(e) => setForm({ ...form, statut: e.target.value as StatutVeto })}
              >
                <option value="salarie">Salarié·e</option>
                <option value="associe">Associé·e</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cf-role">Rôle dans l&apos;app</label>
              <select
                id="cf-role"
                value={form.role_app}
                onChange={(e) => setForm({ ...form, role_app: e.target.value as UserRole })}
              >
                <option value="veto">Véto — consulte et pose ses congés</option>
                <option value="admin">Admin — gère le cabinet</option>
              </select>
            </div>
            <div className="field">
              <label id="cf-couleur-label">Couleur</label>
              <div className="swatches" role="group" aria-labelledby="cf-couleur-label">
                {COULEURS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    className="swatch"
                    style={{ background: c.hex }}
                    aria-pressed={form.couleur === c.hex}
                    aria-label={c.nom}
                    onClick={() => setForm({ ...form, couleur: c.hex })}
                  />
                ))}
              </div>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Étiquettes d&apos;équipe</label>
              <div className="tag-picker">
                {[...new Set([...TAGS_PRESETS, ...form.tags])].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="tag-pick"
                    aria-pressed={form.tags.includes(tag)}
                    onClick={() => basculerTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
                <input
                  className="tag-libre"
                  value={tagLibre}
                  onChange={(e) => setTagLibre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      ajouterTagLibre()
                    }
                  }}
                  onBlur={ajouterTagLibre}
                  placeholder="autre…"
                />
              </div>
              <p className="cf-aide">
                Ce sont elles que lisent les règles de composition (« un junior jamais seul »,
                « au moins un senior par week-end »), sur l&apos;écran Règles.
              </p>
            </div>
            <div className="check-line">
              <input
                id="cf-recours"
                type="checkbox"
                checked={form.dernier_recours}
                onChange={(e) => setForm({ ...form, dernier_recours: e.target.checked })}
              />
              <label htmlFor="cf-recours" style={{ all: 'unset', fontSize: '0.84rem', cursor: 'pointer' }}>
                Dernier recours uniquement
              </label>
            </div>
          </div>

          <div className="create-actions">
            <button type="submit" className="btn btn-valider" disabled={isPending}>
              {isPending ? 'Enregistrement…' : enModification ? 'Enregistrer' : 'Créer la fiche'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={fermerPanneau} disabled={isPending}>
              Annuler
            </button>
            {erreur && <span className="cf-erreur">{erreur}</span>}
          </div>
        </form>
      </div>

      {/* ── La grille de fiches ──────────────────────────────────────── */}
      <div className="team-grid rise rise-3">
        {vets.map((v) => {
          const etat = etatCompte(v)
          const nb = nbContraintes.get(v.id) ?? 0
          const cestMoi = v.id === moiId

          // Les qualités de la personne tiennent sur UNE ligne de texte, dans
          // l'ordre du plus structurant au plus anecdotique. Elles étaient
          // réparties sur trois bandes de pilules qui se ressemblaient toutes,
          // dont une qui disait « aucune étiquette » — une ligne pour dire
          // qu'il n'y a rien.
          const qualites: string[] = [
            v.role_app === 'admin' ? 'Admin' : 'Véto',
            v.statut === 'associe' ? 'Associé·e' : 'Salarié·e',
            ...(v.dernier_recours ? ['dernier recours'] : []),
            ...(v.tags ?? []),
          ]

          return (
            <article key={v.id} className={`vet-card${v.actif ? '' : ' inactive'}`}>
              {/* (A) Qui c'est. La phrase de rôle a sauté : elle répétait mot
                  pour mot la pastille « Admin » posée 30 px plus bas. */}
              <div className="vet-card-top">
                <span className="vet-avatar" style={{ background: v.couleur }} aria-hidden="true">
                  {v.prenom.charAt(0).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <h3>
                    {v.prenom} {v.nom}
                  </h3>
                  <p className="vet-mail">{v.email}</p>
                </div>
              </div>

              {/* (B) Ce qu'elle est, d'un seul trait. Seul « Admin » est mis en
                  avant : c'est le seul mot de la ligne qui donne un pouvoir. */}
              <p className="vet-ligne">
                {qualites.map((q, i) => (
                  <span key={q}>
                    {i > 0 && <span className="vl-sep"> · </span>}
                    {q === 'Admin' ? <strong>Admin</strong> : q}
                  </span>
                ))}
              </p>

              {/* (C) L'état du compte PORTE son action : c'est la seule chose
                  qui change vraiment d'une fiche à l'autre, et la seule action
                  qui fasse avancer le dossier. Le bloc existe toujours, même
                  sans bouton — c'est lui qui garantit des cartes de même
                  hauteur, quel que soit l'état. */}
              <div className={`vet-account acct-${etat}`}>
                <span className="acct-etat">
                  <span className="acct-dot" aria-hidden="true" />
                  {LIBELLE_COMPTE[etat]}
                </span>

                {etat === 'sans' && (
                  <button type="button" className="acct-cta" onClick={() => inviter(v)} disabled={isPending}>
                    Inviter
                  </button>
                )}
                {etat === 'invite' && (
                  <button type="button" className="acct-cta" onClick={() => inviter(v)} disabled={isPending}>
                    Relancer
                  </button>
                )}
                {etat === 'inactif' && (
                  <button type="button" className="acct-cta" onClick={() => basculerActif(v)} disabled={isPending}>
                    Réactiver
                  </button>
                )}
              </div>

              {/* (D) Les actions de gestion, toutes de même poids parce
                  qu'aucune n'est urgente. « Désactiver » est rouge AU REPOS :
                  au survol seulement, elle est invisible sur tablette. */}
              <div className="vet-actions">
                <button type="button" onClick={() => ouvrirModification(v)} disabled={isPending}>
                  Modifier
                </button>

                <button type="button" onClick={() => setFicheContraintes(v)}>
                  Ses contraintes
                  {nb > 0 && <span className="va-nb">{nb}</span>}
                </button>

                {v.actif && (
                  <button
                    type="button"
                    className="va-danger"
                    onClick={() => basculerActif(v)}
                    disabled={isPending || cestMoi}
                    title={
                      cestMoi
                        ? 'Tu ne peux pas désactiver ta propre fiche.'
                        : 'Retirer des prochaines générations'
                    }
                  >
                    Désactiver
                  </button>
                )}
              </div>
            </article>
          )
        })}

        {vets.length === 0 && (
          <p className="team-vide">
            Aucune fiche pour l&apos;instant. Crée la première : c&apos;est elle qui donne une
            couleur et une place dans le planning.
          </p>
        )}
      </div>

      {/* ── Ses contraintes ──────────────────────────────────────────── */}
      {ficheContraintes && (
        <ContraintesVetoModale
          veto={{
            id: ficheContraintes.id,
            prenom: ficheContraintes.prenom,
            nom: ficheContraintes.nom,
            couleur: ficheContraintes.couleur,
          }}
          regles={regles}
          vets={vetsMini}
          periodes={periodes}
          typesCreneaux={typesCreneaux}
          onClose={() => setFicheContraintes(null)}
        />
      )}

      {/* ── Garde-fou de désactivation ───────────────────────────────── */}
      {garde && (
        <div
          className="modal-veil open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guard-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setGarde(null)
          }}
        >
          <div className="guard-modal">
            <div className="guard-head">
              <span className="gfox" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/filou/filou-pose-fixe.webp" alt="" />
              </span>
              <div>
                <h3 id="guard-title">
                  {garde.gardes.length > 0
                    ? `Attends : ${garde.veto.prenom} a ${garde.gardes.length} garde${
                        garde.gardes.length > 1 ? 's' : ''
                      } publiée${garde.gardes.length > 1 ? 's' : ''} à venir.`
                    : `${garde.veto.prenom} n'a aucune garde publiée à venir.`}
                </h3>
                <p>
                  {garde.gardes.length > 0
                    ? 'Si tu désactives sa fiche maintenant, ces gardes restent sans titulaire : il faudra les réattribuer une par une, à la main ou par la gestion de crise.'
                    : "Tu peux désactiver sa fiche sans rien casser : elle n'entrera plus dans les prochaines générations."}
                </p>
              </div>
            </div>

            {garde.gardes.length > 0 && (
              <ul className="guard-list">
                {garde.gardes.map((g, i) => (
                  <li key={`${g.date}-${g.type}-${i}`}>
                    <span aria-hidden="true">📅</span>
                    <span className="gl-date">{formatGarde(g)}</span>
                    <span className="gl-role">{LIBELLE_TYPE_GARDE[g.type] ?? g.type}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="guard-note">
              La désactivation n&apos;efface pas ces gardes et ne les redistribue pas toute seule.
              Tant qu&apos;elles ne sont pas réattribuées, les compteurs d&apos;équité comptent des
              gardes que plus personne n&apos;assure.
            </p>

            <div className="guard-foot">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setGarde(null)}
                disabled={isPending}
              >
                {garde.veto.prenom} reste dans l&apos;équipe
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmerDesactivation}
                disabled={isPending}
              >
                {isPending ? 'Un instant…' : 'Désactiver quand même'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
