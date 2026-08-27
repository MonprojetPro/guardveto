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
// serveur de `admin/veterinaires/actions.ts` (création, modification,
// invitation, activation) — le fichier survit à la suppression de la page V1
// qui le rendait. On ne réécrit pas une action qui porte une garde admin, une
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
import { Pencil, Power } from 'lucide-react'
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
import { GardienImpact } from '@/components/v2/GardienImpact'
import { SelecteurCouleur, COULEURS_SUGGEREES } from '@/components/v2/SelecteurCouleur'
import { normaliserHex, stylePastille } from '@/lib/couleurs'
import type { Impact } from '@/data/controleImpact'
import type { StatutVeto, UserRole, Veterinaire } from '@/types'
import {
  adresseBienFormee,
  adresseUtilisable,
  motifInvitationImpossible,
} from '@/lib/emails/destinataire'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { COULEURS_GOOGLE, couleurGooglePar } from '@/lib/agenda/couleurs-google'
import { initialesVeto } from '@/lib/agenda/initiales'

/** Sentinelle du Select : Base UI n'accepte pas `''` comme valeur d'item, et
 *  « couleur par défaut de l'agenda » DOIT rester sélectionnable — c'est
 *  l'état `null` en base, pas une case vide qu'on aurait oublié de remplir. */
const COULEUR_GOOGLE_DEFAUT = '__defaut__'

/**
 * La couleur de départ d'une fiche neuve.
 *
 * ── 2026-08-24 : la palette fermée a disparu d'ici ─────────────────────────
 * Quatorze teintes vivaient dans ce fichier, et le formulaire n'offrait
 * qu'elles. Anne-Sophie demandait qu'on en ajoute trois pour retrouver les
 * couleurs de son agenda Google ; MiKL a tranché plus large — un sélecteur
 * libre, « comme ça on règle le problème définitivement ». Les quatorze teintes
 * survivent comme RACCOURCIS dans `SelecteurCouleur` (`COULEURS_SUGGEREES`),
 * avec les trois qu'elle voulait, mais elles ne bornent plus rien.
 */
const COULEUR_INITIALE = COULEURS_SUGGEREES[0].hex

/**
 * Étiquettes proposées d'office, même quand personne ne les porte encore : ce
 * sont celles que les exemples de l'écran Règles citent en toutes lettres
 * (« un junior jamais seul », « au moins un senior par week-end »). Elles
 * amorcent la pompe sur un cabinet qui n'a rien étiqueté.
 *
 * ⚠️ Ce n'est PAS le référentiel des étiquettes : celui-ci se déduit de ce que
 *    l'équipe porte réellement (cf. `tagsProposes`). Les traiter comme un
 *    référentiel a produit un bug — une étiquette hors de cette liste
 *    disparaissait du choix dès qu'on la décochait, sans moyen de la recocher.
 */
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
  /** '1' à '11', ou `null` pour la couleur par défaut de l'agenda Google. */
  couleurGoogle: string | null
  /** Le texte du champ « Nom dans Google Agenda » — voir le commentaire du JSX
   *  sur pourquoi il est PRÉ-REMPLI plutôt que vide. */
  libelleAgenda: string
}

const FORM_VIDE: FormState = {
  prenom: '',
  nom: '',
  email: '',
  statut: 'salarie',
  role_app: 'veto',
  couleur: COULEUR_INITIALE,
  dernier_recours: false,
  tags: [],
  couleurGoogle: null,
  libelleAgenda: '',
}

function formDepuisVeto(v: Veterinaire): FormState {
  return {
    prenom: v.prenom,
    nom: v.nom,
    email: v.email ?? '',
    statut: v.statut,
    role_app: v.role_app,
    // La couleur en base est reprise TELLE QUELLE — c'est tout l'intérêt d'un
    // choix libre : elle n'a plus à figurer dans une liste pour être gardée.
    // Seule sa forme est remise d'aplomb (`#abc` et `#aabbcc` sont la même
    // couleur, mais pas la même chaîne : sans ça, la pastille de raccourci
    // correspondante ne se montrerait pas cochée).
    couleur: normaliserHex(v.couleur) ?? COULEUR_INITIALE,
    dernier_recours: v.dernier_recours,
    tags: v.tags ?? [],
    couleurGoogle: v.couleur_google ?? null,
    // PRÉ-REMPLI avec les initiales calculées, jamais un champ vide : sans ça,
    // l'admin ne voit pas ce que Google affichera tant qu'il n'a rien tapé, et
    // « laisse vide pour les initiales » se lirait comme une promesse qu'un
    // champ vide dément visuellement.
    libelleAgenda: v.libelle_agenda ?? initialesVeto(v.prenom, v.nom),
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
  // Le refus du contrôle d'impact sur un retrait d'équipe (palier 3) : il ouvre
  // la fenêtre de Filou avec les gestes de correction, au lieu d'un toast.
  const [impactVeto, setImpactVeto] = useState<{ veto: Veterinaire; impact: Impact } | null>(null)

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

  /**
   * Les étiquettes que le sélecteur propose : les deux d'office, TOUTES celles
   * que l'équipe porte déjà, celles tapées à la volée dans cette session, et
   * celles de la fiche en cours.
   *
   * Les deux dernières sources ne sont pas du zèle : sans « tapées à la
   * volée », une étiquette qu'on vient d'écrire disparaîtrait si on la décoche
   * avant d'enregistrer ; sans « celles de l'équipe », une étiquette posée
   * depuis l'écran Règles (`poserEtiquetteSurVetos`) s'effaçait du choix au
   * premier décochage — c'est exactement ce que MiKL a constaté avec
   * « veteran » sur la fiche de Victor, le 2026-08-02.
   *
   * Dédoublonnage sur la forme minuscule : la base peut contenir « Senior »
   * et « senior », qui sont la même étiquette pour le moteur.
   */
  const [tagsSession, setTagsSession] = useState<string[]>([])

  const tagsProposes = useMemo(() => {
    const vus = new Map<string, string>()
    for (const t of [
      ...TAGS_PRESETS,
      ...vets.flatMap((v) => v.tags ?? []),
      ...tagsSession,
      ...form.tags,
    ]) {
      const cle = t.trim().toLowerCase()
      if (cle !== '' && !vus.has(cle)) vus.set(cle, t)
    }
    return [...vus.values()]
  }, [vets, tagsSession, form.tags])

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
    // L'adresse est FACULTATIVE : on crée souvent la fiche avant d'avoir
    // l'adresse de la personne. Elle n'est exigée qu'au moment d'inviter. Mais
    // si elle est saisie, elle doit tenir debout — une adresse à moitié tapée
    // ne se signale que le jour où l'invitation part.
    if (email !== '' && !adresseBienFormee(email)) {
      return setErreur("L'e-mail n'a pas l'air valide — c'est lui qui sert à inviter.")
    }
    setErreur(null)

    // `actif` : on ne le pilote pas depuis ce formulaire. Une fiche naît
    // active ; on la désactive par le bouton dédié, qui a son garde-fou.
    const cible = edition.veto
    const donnees: VeterinaireFormData = {
      prenom,
      nom,
      // `null` et non `''` : une chaîne vide se comporterait comme une adresse
      // partout en aval (contrôle d'unicité, envois).
      email: email === '' ? null : email,
      statut: form.statut,
      role_app: form.role_app,
      couleur: form.couleur,
      actif: cible ? cible.actif : true,
      dernier_recours: form.dernier_recours,
      tags: form.tags,
      couleurGoogle: form.couleurGoogle,
      // Champ vide = on revient au calcul automatique des initiales : c'est
      // l'action serveur (`normaliserLibelleAgenda`) qui transforme la chaîne
      // vide en `null`, comme pour l'e-mail plus haut.
      libelleAgenda: form.libelleAgenda,
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
        // Un refus PORTEUR d'impact s'explique en fenêtre, avec ses gestes de
        // correction (palier 3) ; les autres restent des toasts.
        if ('impact' in res && res.impact) {
          setImpactVeto({ veto: v, impact: res.impact })
          return
        }
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

  /** Le refus du contrôle d'impact sur un retrait d'équipe, s'il y en a un. */
  const relancerDesactivation = (v: Veterinaire, confirme: boolean) => {
    startTransition(async () => {
      const res = await toggleVeterinaireActif(v.id, false, confirme)
      if ('error' in res && res.error) {
        if ('impact' in res && res.impact) {
          setImpactVeto({ veto: v, impact: res.impact })
          return
        }
        toast.error(res.error)
        return
      }
      setImpactVeto(null)
      toast.success(`${v.prenom} n’entre plus dans les prochaines générations`)
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

  /** « Senior » et « senior » sont la même étiquette pour le moteur : toute
   *  comparaison passe donc par la forme minuscule, jamais par l'égalité
   *  stricte — sinon une pastille se montrerait décochée alors que la fiche
   *  porte bien l'étiquette, dans une autre casse. */
  const memeTag = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

  const porte = (tag: string) => form.tags.some((t) => memeTag(t, tag))

  const basculerTag = (tag: string) => {
    setForm((f) => ({
      ...f,
      tags: f.tags.some((t) => memeTag(t, tag))
        ? f.tags.filter((t) => !memeTag(t, tag))
        : [...f.tags, tag],
    }))
  }

  const ajouterTagLibre = () => {
    const t = tagLibre.trim().toLowerCase()
    setTagLibre('')
    if (t === '') return
    // Mémorisée pour la session : décocher une étiquette qu'on vient d'écrire
    // ne doit pas la faire disparaître du choix — sinon il faut la retaper.
    setTagsSession((s) => (s.some((x) => memeTag(x, t)) ? s : [...s, t]))
    if (porte(t)) return
    setForm((f) => ({ ...f, tags: [...f.tags, t] }))
  }

  const panneauOuvert = edition !== null
  const enModification = edition?.veto ?? null

  return (
    <>
      {/* Filou explique un retrait d'équipe qui casserait la génération, et
          porte les gestes pour le régler sur place (palier 3). */}
      <GardienImpact
        impact={impactVeto?.impact ?? null}
        geste={`retirer ${impactVeto?.veto.prenom ?? 'ce vétérinaire'} de l’équipe de garde`}
        origine="equipe"
        vets={vets.filter((v) => v.actif)}
        enCours={isPending}
        onAnnuler={() => setImpactVeto(null)}
        onCorrige={() => { if (impactVeto) relancerDesactivation(impactVeto.veto, false) }}
        onPasserOutre={() => { if (impactVeto) relancerDesactivation(impactVeto.veto, true) }}
      />

      {/* ── Tête de page ─────────────────────────────────────────────── */}
      <div className="page-head rise">
        <div>
          <h1>Équipe</h1>
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
              <label htmlFor="cf-email">E-mail (facultatif)</label>
              <input
                id="cf-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="lea.marchand@cabinet.fr"
                autoComplete="off"
                aria-describedby="cf-email-aide"
              />
              {/* Trois lignes d'aide pour dire ce que l'étiquette « (facultatif) »
                  dit déjà à moitié : il en reste ce qu'elle ne dit pas — à quel
                  moment l'adresse finit par manquer. */}
              <p id="cf-email-aide" className="cf-aide">
                Nécessaire seulement pour inviter la personne.
              </p>
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
            {/* La couleur est un CHAMP, pas un atelier posé au milieu du
                formulaire. Elle occupait toute la largeur (`gridColumn: 1/-1`)
                pour loger l'outil déplié, et laissait la moitié droite vide —
                l'asymétrie que MiKL a relevée en recette. Elle reprend ici sa
                place de cellule ordinaire ; l'outil complet s'ouvre au clic.
                Plus de « couleur hors palette » à rattraper : il n'y a plus de
                palette dont on puisse être dehors. La teinte en base est la
                teinte affichée, d'où qu'elle vienne — et la pastille montre les
                initiales de la personne, avec l'encre que le planning posera
                vraiment dessus. */}
            <div className="field">
              <label id="cf-couleur-label">Couleur</label>
              <SelecteurCouleur
                valeur={form.couleur}
                onChange={(hex) => setForm((f) => ({ ...f, couleur: hex }))}
                initiales={
                  `${form.prenom.trim().charAt(0)}${form.nom.trim().charAt(0)}`.toUpperCase() || '?'
                }
                ariaLabelledBy="cf-couleur-label"
                disabled={isPending}
              />
            </div>
            {/* Les étiquettes tiennent la ligne de la couleur.
                Le champ couleur, redevenu une cellule ordinaire, ouvrait une
                rangée à lui seul et laissait quatre colonnes vides à sa droite —
                le déséquilibre relevé en recette le 2026-08-25 : « même si tu as
                compacté, ça fait déséquilibre ». Les étiquettes occupent
                exactement ce vide (`grid-column: 2 / -1`), sans rien perdre de
                leur largeur : elles restent le seul bloc qui ait besoin de place
                pour aligner ses jetons. En dessous de 720 px la grille n'a plus
                assez de colonnes pour partager la ligne : elles repassent en
                pleine largeur. */}
            <div className="field cf-etiquettes">
              <label>Étiquettes d&apos;équipe</label>
              <div className="tag-picker">
                {tagsProposes.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="tag-pick"
                    aria-pressed={porte(tag)}
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
                Lues par les règles de composition (« un junior jamais seul »), écran Règles.
              </p>
            </div>
            {/* Chantier agenda Google (2026-08-27) — DEUX couleurs, deux
                usages. La couleur ci-dessus est celle DANS GuardVeto (planning,
                pastilles, filtres) : un choix libre, n'importe quel
                hexadécimal. Celle-ci ne sert QUE dans Google Agenda, parce que
                Google n'accepte que 11 teintes fermées — pas la peine de
                lire le libellé pour comprendre, la phrase le dit. */}
            <div className="cf-bloc-agenda">
              {/* Recette MiKL (2026-08-27) : cette phrase était coupée à
                  droite en plein mot. Elle vivait DANS la grille à deux
                  colonnes du dessous (`grid-column: 1/-1`) — sortie ici, en
                  bloc normal au-dessus, elle n'a plus aucune piste de
                  colonne pour se faire rogner : un `<p>` de flux normal
                  s'étire sur toute la largeur du conteneur et retombe à la
                  ligne, point final. */}
              <p className="cf-agenda-explication">
                La couleur ci-dessus est celle de GuardVeto. Celle-ci ne sert que dans{' '}
                <strong>Google Agenda</strong>, qui n&apos;accepte que 11 teintes fixes.
              </p>
              <div className="cf-bloc-agenda-grille">
                <div className="field">
                  <label id="cf-couleur-google-label">Couleur Google Agenda</label>
                  <Select
                    value={form.couleurGoogle ?? COULEUR_GOOGLE_DEFAUT}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        couleurGoogle: v === COULEUR_GOOGLE_DEFAUT ? null : v,
                      }))
                    }
                  >
                    {/* JAMAIS de `<select>` natif sur ce projet — le composant
                        `Select` partagé, comme partout ailleurs dans cet écran
                        (cf. « Période à renvoyer » de Réglages).
                        Recette MiKL : ce bouton débordait de sa cellule. Deux
                        parades, pas une seule : un libellé COURT (« Par
                        défaut » plutôt que la phrase entière) et une
                        troncature CSS qui tient même si un futur libellé
                        français est plus long que prévu (`.cgs-trigger`). */}
                    <SelectTrigger aria-labelledby="cf-couleur-google-label" className="w-full">
                      <span className="cgs-trigger">
                        {form.couleurGoogle ? (
                          <>
                            <span
                              className="cgs-pastille"
                              style={{ background: couleurGooglePar(form.couleurGoogle)?.hex }}
                              aria-hidden="true"
                            />
                            <span className="cgs-trigger-texte">
                              {couleurGooglePar(form.couleurGoogle)?.libelleFr}
                            </span>
                          </>
                        ) : (
                          <span className="cgs-trigger-texte">Par défaut</span>
                        )}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={COULEUR_GOOGLE_DEFAUT}>
                        Couleur par défaut de l&apos;agenda
                      </SelectItem>
                      {COULEURS_GOOGLE.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span
                            className="cgs-pastille"
                            style={{ background: c.hex }}
                            aria-hidden="true"
                          />
                          {c.libelleFr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="field">
                  <label htmlFor="cf-libelle-agenda">Nom dans Google Agenda</label>
                  <input
                    id="cf-libelle-agenda"
                    type="text"
                    value={form.libelleAgenda}
                    onChange={(e) => setForm({ ...form, libelleAgenda: e.target.value })}
                    placeholder={initialesVeto(form.prenom, form.nom) || 'Initiales'}
                    autoComplete="off"
                    aria-describedby="cf-libelle-agenda-aide"
                  />
                  <p id="cf-libelle-agenda-aide" className="cf-aide">
                    Laisse vide pour utiliser les initiales.
                  </p>
                </div>
              </div>
            </div>
            {/* B-057 — la case et son explication forment UN bloc, sur toute la
                largeur. Empilées l'une sous l'autre dans la grille, elles
                laissaient la moitié droite vide et le texte se lisait en colonne
                de journal (MiKL : « c'est encore tout déséquilibré »). */}
            <div className="cf-bloc-recours">
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
              {/* B-046 — la case était nue. Sans un mot, « dernier recours » se
                  lit comme « en dernier », alors que le moteur ne la mobilise
                  JAMAIS. Une exclusion qui ne se dit pas se découvre sur une
                  impasse, et on cherche ailleurs. */}
              <p className="cf-aide cf-aide-recours">
                Cette personne <strong>n&apos;entre jamais dans une génération de planning</strong> —
                même s&apos;il ne reste personne d&apos;autre : le moteur préfère annoncer qu&apos;il
                est bloqué. Elle reste proposée quand tu modifies une garde à la main ou que tu
                remplaces quelqu&apos;un, et elle reçoit les appels aux volontaires comme les autres.
              </p>
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

          return (
            <article key={v.id} className={`vet-card${v.actif ? '' : ' inactive'}`}>
              {/* (A) Qui c'est — et, dans le coin, les deux gestes qui portent
                  sur la FICHE elle-même. Ils étaient en toutes lettres tout en
                  bas, où ils pesaient autant que « Ses contraintes » alors
                  qu'on ne s'en sert presque jamais. En icônes ici, ils libèrent
                  le bas de la carte (MiKL : « l'histoire d'aérer encore plus le
                  visuel »). La phrase de rôle a sauté : elle répétait mot pour
                  mot la pastille « Admin » posée 30 px plus bas. */}
              <div className="vet-card-top">
                <span className="vet-avatar" style={stylePastille(v.couleur)} aria-hidden="true">
                  {v.prenom.charAt(0).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <h3>
                    {v.prenom} {v.nom}
                  </h3>
                  {adresseUtilisable(v.email) ? (
                    <p className="vet-mail">{v.email}</p>
                  ) : (
                    <p className="vet-mail sans-adresse">
                      Pas encore d&apos;adresse e-mail
                    </p>
                  )}
                </div>

                <div className="vet-outils">
                  <button
                    type="button"
                    onClick={() => ouvrirModification(v)}
                    disabled={isPending}
                    title={`Modifier la fiche de ${v.prenom}`}
                    aria-label={`Modifier la fiche de ${v.prenom}`}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  {v.actif && (
                    <button
                      type="button"
                      className="vo-danger"
                      onClick={() => basculerActif(v)}
                      disabled={isPending || cestMoi}
                      title={
                        cestMoi
                          ? 'Tu ne peux pas désactiver ta propre fiche.'
                          : `Désactiver la fiche de ${v.prenom} — elle n'entrera plus dans les générations`
                      }
                      aria-label={`Désactiver la fiche de ${v.prenom}`}
                    >
                      <Power aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {/* (B) Ce qu'elle est. Trois natures d'information, trois formes
                  visuelles — au lieu d'une file de mots gris où « dernier
                  recours » se fondait dans « Associé·e » (retour MiKL) :
                    · le statut, en texte : c'est le fond de la fiche ;
                    · « Admin », en jeton plein : c'est un POUVOIR, ça se voit ;
                    · « dernier recours », en jeton ambre à bouée : c'est une
                      exception de planning, elle doit sauter aux yeux ;
                    · les étiquettes, en jetons sable : ce sont des mots libres
                      que lisent les règles de composition.
                  « Véto » n'est plus écrit : c'est le cas de tout le monde, et
                  nommer le cas par défaut n'apprend rien. */}
              <p className="vet-ligne">
                {v.role_app === 'admin' && <span className="vl-jeton vl-admin">Admin</span>}
                <span
                  className={`vl-jeton ${v.statut === 'associe' ? 'vl-associe' : 'vl-salarie'}`}
                >
                  {v.statut === 'associe' ? 'Associé·e' : 'Salarié·e'}
                </span>
                {v.dernier_recours && (
                  <span className="vl-jeton vl-recours">
                    <span aria-hidden="true">🛟</span> Dernier recours
                  </span>
                )}
                {(v.tags ?? []).map((t) => (
                  <span key={t} className="vl-jeton vl-tag">
                    {t}
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

                {/* Sans adresse, l'invitation n'a nulle part où aller. Le
                    bouton est désactivé plutôt que masqué : masqué, il ne dirait
                    pas POURQUOI, et l'admin chercherait du côté des droits. Le
                    `title` porte le geste à faire — le serveur refuse de toute
                    façon, avec exactement la même phrase. */}
                {etat === 'sans' && (
                  <button
                    type="button"
                    className="acct-cta"
                    onClick={() => inviter(v)}
                    disabled={isPending || !!motifInvitationImpossible(v)}
                    title={motifInvitationImpossible(v) ?? `Inviter ${v.prenom}`}
                  >
                    Inviter
                  </button>
                )}
                {etat === 'invite' && (
                  <button
                    type="button"
                    className="acct-cta"
                    onClick={() => inviter(v)}
                    disabled={isPending || !!motifInvitationImpossible(v)}
                    title={motifInvitationImpossible(v) ?? `Relancer l'invitation de ${v.prenom}`}
                  >
                    Relancer
                  </button>
                )}
                {etat === 'inactif' && (
                  <button type="button" className="acct-cta" onClick={() => basculerActif(v)} disabled={isPending}>
                    Réactiver
                  </button>
                )}
              </div>

              {/* (D) La seule chose qu'on vient VRAIMENT faire ici, donc seule
                  sur sa ligne et en toutes lettres. « Modifier » et
                  « Désactiver » sont remontés en icônes dans le coin. */}
              <div className="vet-actions">
                <button type="button" onClick={() => setFicheContraintes(v)}>
                  Ses contraintes
                  <span className="va-nb">{nb}</span>
                </button>
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
            // Fait remonter les règles qui le visent PAR ÉTIQUETTE : elles le
            // contraignent autant que les nominatives, mais `reglesDuVeto` ne
            // peut pas les voir (leur `qui` est nul, la cible est un tag).
            tags: ficheContraintes.tags,
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
