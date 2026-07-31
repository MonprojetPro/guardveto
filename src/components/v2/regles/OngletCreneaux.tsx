'use client'

// ============================================================
// GUARDVETO V2 — Onglet « Types de garde » (le catalogue d'un profil)
// ============================================================
// C'est ce que le moteur consomme réellement : une ligne de `creneau_modele`
// par type de garde, avec ses jours, ses places et ses horaires. Tout ce qui
// est réglé ici change ce que la prochaine génération produira.
//
// ── CE QU'ON CORRIGE (la raison d'être de cet onglet) ─────────────────────
//
// En V1, le MÊME créneau vivait dans DEUX sections éloignées :
//   · `CatalogueCreneauxAdmin` — « Vos types de garde » : on y lisait les
//     jours, les places et les horaires, on pouvait activer/désactiver et
//     créer du sur-mesure, mais RIEN n'était modifiable ;
//   · `HorairesProfilEditor` — « Horaires par profil » : on y modifiait les
//     horaires… et rien d'autre.
//
// Deux conséquences, toutes les deux vécues :
//   1. Pour corriger « la garde du samedi finit à 8h » il fallait quitter la
//      carte qu'on regardait et retrouver le même créneau plus bas, dans une
//      autre liste, sous un autre nom de section.
//   2. Chaque section avait SON sélecteur de profil, et les deux se
//      désynchronisaient : on lisait le catalogue d'« Hiver » en réglant les
//      horaires d'« Été ». Ici, le profil est le contexte de la PAGE
//      (`ReglesStructureV2`) — cet onglet ne fait qu'en recevoir un.
//
// Une carte par créneau, dépliable pour éditer. On modifie le créneau qu'on
// regarde, pas son homonyme dans une autre liste. D'où l'édition en place
// plutôt qu'en modale.
//
// ── DEUX GARDE-FOUS QU'ON EXPLIQUE PLUTÔT QUE DE LES SUBIR ────────────────
//
// · Les JOURS et les FÉRIÉS d'un créneau du seed sont figés. L'ancrage
//   « tel jour → tel type de garde » est ré-implémenté exprès dans le
//   validateur indépendant, en contrôle croisé du moteur : les déplacer
//   depuis l'écran désaligne silencieusement les deux. Le chemin prévu est
//   de désactiver le seed et de créer du sur-mesure — c'est écrit dans le
//   formulaire, à l'endroit où le champ est grisé.
// · Les 4 créneaux du seed sont insupprimables. Le bouton n'est pas là plutôt
//   que désactivé sans un mot : on dit pourquoi, et on renvoie sur
//   « Désactiver », qui fait ce que l'utilisateur cherchait.
//
// La suppression passe par une vraie modale. La V1 posait DEUX
// `window.confirm()` — une boîte grise du navigateur, hors du terrier, qui ne
// disait pas ce qu'on perdait.
// ============================================================

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { GripVertical, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  creerCreneauSurMesure,
  modifierCreneau,
  reordonnerCreneaux,
  setCreneauActif,
  supprimerCreneauSurMesure,
} from '@/app/(protected)/admin/structure/actions'
import type { CreneauUI, ProfilUI } from './types'

// ── Référentiels d'affichage ────────────────────────────────────────────────

/**
 * Les sept jours dans l'ORDRE HUMAIN (lundi d'abord, dimanche en dernier).
 * La base indexe 0 = dimanche : c'est une convention de stockage, pas une
 * façon de lire une semaine.
 */
const JOURS = [
  { idx: 1, court: 'Lun', long: 'lundi' },
  { idx: 2, court: 'Mar', long: 'mardi' },
  { idx: 3, court: 'Mer', long: 'mercredi' },
  { idx: 4, court: 'Jeu', long: 'jeudi' },
  { idx: 5, court: 'Ven', long: 'vendredi' },
  { idx: 6, court: 'Sam', long: 'samedi' },
  { idx: 0, court: 'Dim', long: 'dimanche' },
]

/** Les quatre valeurs d'`offset_jours_fin`, en français. */
const FIN_LABELS: Record<number, string> = {
  0: 'le jour même',
  1: 'le lendemain',
  2: 'le surlendemain',
  3: 'trois jours après',
}

/** Libellés proposés d'office pour les places — renommables. */
const ROLES_AUTO = ['premier', 'second', 'troisieme', 'quatrieme']

/** Bornes du serveur, reprises ici pour ne pas proposer l'invalide. */
const PLACES_MAX = 4

// ── L'état d'un formulaire (création comme édition) ─────────────────────────

interface FormCreneau {
  nom: string
  jours: number[]
  surFeries: boolean
  heureDebut: string
  heureFin: string
  offset: number
  nbPlaces: number
  roles: string[]
}

const FORM_VIDE: FormCreneau = {
  nom: '',
  jours: [],
  surFeries: false,
  heureDebut: '08:30',
  heureFin: '18:30',
  offset: 0,
  nbPlaces: 1,
  roles: [ROLES_AUTO[0]],
}

function formDepuisCreneau(c: CreneauUI): FormCreneau {
  return {
    nom: c.nom,
    jours: [...c.joursSemaine].sort((a, b) => a - b),
    surFeries: c.surFeries,
    heureDebut: c.heureDebut,
    heureFin: c.heureFin,
    offset: c.offsetJoursFin,
    nbPlaces: c.nbPlaces,
    roles: [...c.roles],
  }
}

/** Empreinte d'un formulaire — sert au « rien n'a changé, rien à enregistrer ». */
function empreinte(f: FormCreneau): string {
  return JSON.stringify({
    nom: f.nom.trim(),
    jours: [...f.jours].sort((a, b) => a - b),
    surFeries: f.surFeries,
    heureDebut: f.heureDebut,
    heureFin: f.heureFin,
    offset: f.offset,
    nbPlaces: f.nbPlaces,
    roles: f.roles.map((r) => r.trim()),
  })
}

/**
 * Redimensionne la liste des libellés de places : on garde ce qui a été saisi,
 * on complète avec les noms d'office. Sans ça, passer de 1 à 3 places puis
 * revenir à 1 effacerait un libellé renommé à la main.
 */
function ajusterRoles(roles: string[], n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const saisi = roles[i]
    if (saisi !== undefined && saisi !== '') return saisi
    return ROLES_AUTO[i] ?? `place ${i + 1}`
  })
}

/** Ce qui manque pour pouvoir enregistrer — null si le formulaire est complet. */
function formIncomplet(f: FormCreneau, joursFiges: boolean): boolean {
  if (!f.nom.trim()) return true
  if (!joursFiges && f.jours.length === 0) return true
  const roles = f.roles.map((r) => r.trim())
  if (roles.length !== f.nbPlaces || roles.some((r) => !r)) return true
  if (new Set(roles).size !== roles.length) return true
  return false
}

// ── Les champs, partagés entre création et édition ──────────────────────────

interface ChampsProps {
  /** Préfixe des `id` — deux formulaires peuvent être ouverts en même temps. */
  cle: string
  form: FormCreneau
  setForm: (f: FormCreneau) => void
  /** Créneau du seed : jours et fériés figés (cf. en-tête). */
  joursFiges: boolean
  bloque: boolean
}

function ChampsCreneau({ cle, form, setForm, joursFiges, bloque }: ChampsProps) {
  const basculerJour = (idx: number) => {
    setForm({
      ...form,
      jours: form.jours.includes(idx)
        ? form.jours.filter((j) => j !== idx)
        : [...form.jours, idx],
    })
  }

  return (
    <div className="grille">
      <div className="large">
        <label htmlFor={`${cle}-nom`}>Nom du type de garde</label>
        <input
          id={`${cle}-nom`}
          type="text"
          value={form.nom}
          maxLength={60}
          autoComplete="off"
          disabled={bloque}
          onChange={(e) => setForm({ ...form, nom: e.target.value })}
          placeholder="Ex. : Garde de jour, Samedi matin…"
        />
      </div>

      <div className="large">
        <label id={`${cle}-jours-label`}>Jours couverts</label>
        <div className="jours-pick" role="group" aria-labelledby={`${cle}-jours-label`}>
          {JOURS.map((j) => (
            <button
              key={j.idx}
              type="button"
              aria-pressed={form.jours.includes(j.idx)}
              aria-label={j.long}
              disabled={bloque || joursFiges}
              onClick={() => basculerJour(j.idx)}
            >
              {j.court}
            </button>
          ))}
        </div>

        {/* La case fériés vit avec les jours : c'est le même sujet — « quand ce
            créneau s'applique-t-il ? ». */}
        <label
          htmlFor={`${cle}-feries`}
          className={`case-ligne${joursFiges || bloque ? ' inerte' : ''}`}
        >
          <input
            id={`${cle}-feries`}
            type="checkbox"
            checked={form.surFeries}
            disabled={bloque || joursFiges}
            onChange={(e) => setForm({ ...form, surFeries: e.target.checked })}
          />
          S&apos;applique aussi les jours fériés
        </label>

        {joursFiges && (
          <p className="note">
            Les jours et les fériés de ce type de garde sont figés. L&apos;association
            « tel jour → tel type de garde » est écrite à deux endroits volontairement : dans
            le moteur, et dans le validateur qui le contrôle après coup. Les déplacer d&apos;ici
            ne changerait qu&apos;un des deux, et le planning serait refusé sans qu&apos;on
            comprenne pourquoi. Pour couvrir d&apos;autres jours : désactive ce type de garde
            et crée un type sur-mesure. Le nom, les horaires et les places restent modifiables.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${cle}-debut`}>Prise de garde</label>
        <input
          id={`${cle}-debut`}
          type="time"
          value={form.heureDebut}
          disabled={bloque}
          onChange={(e) => setForm({ ...form, heureDebut: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor={`${cle}-fin`}>Fin de garde</label>
        <input
          id={`${cle}-fin`}
          type="time"
          value={form.heureFin}
          disabled={bloque}
          onChange={(e) => setForm({ ...form, heureFin: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor={`${cle}-offset`}>La garde se rend…</label>
        <select
          id={`${cle}-offset`}
          value={form.offset}
          disabled={bloque}
          onChange={(e) => setForm({ ...form, offset: Number(e.target.value) })}
        >
          {[0, 1, 2, 3].map((o) => (
            <option key={o} value={o}>
              {FIN_LABELS[o]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${cle}-places`}>Vétérinaires de garde</label>
        <select
          id={`${cle}-places`}
          value={form.nbPlaces}
          disabled={bloque}
          onChange={(e) => {
            const n = Number(e.target.value)
            setForm({ ...form, nbPlaces: n, roles: ajusterRoles(form.roles, n) })
          }}
        >
          {Array.from({ length: PLACES_MAX }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="large">
        <label id={`${cle}-roles-label`}>Nom de chaque place</label>
        <div className="places-champs" role="group" aria-labelledby={`${cle}-roles-label`}>
          {form.roles.map((r, i) => (
            <input
              // L'index EST l'identité ici : ces champs sont les places 1, 2, 3…
              // d'un même créneau, pas une liste d'objets réordonnables.
              key={i}
              type="text"
              value={r}
              maxLength={30}
              autoComplete="off"
              disabled={bloque}
              aria-label={`Nom de la place ${i + 1}`}
              onChange={(e) => {
                const roles = [...form.roles]
                roles[i] = e.target.value
                setForm({ ...form, roles })
              }}
            />
          ))}
        </div>
        <p className="note">
          Ces noms se retrouvent partout : sur le planning, dans le PDF, dans l&apos;agenda et
          dans les compteurs d&apos;équité. Ils doivent être différents les uns des autres.
        </p>
      </div>

      {/* Au-delà de deux places, tout suit SAUF la réattribution à la main
          depuis la grille du planning. On le dit avant, pas après publication. */}
      {form.nbPlaces > 2 && (
        <p className="note attention large">
          À partir de 3 vétérinaires, les places suivantes ne se réattribuent pas une par une
          depuis le planning : il faut régénérer. L&apos;affichage, le PDF, l&apos;agenda et les
          compteurs, eux, les suivent normalement.
        </p>
      )}
    </div>
  )
}

// ── L'onglet ────────────────────────────────────────────────────────────────

interface Props {
  /** Le profil courant, avec son catalogue déjà trié par `ordre`. */
  profil: ProfilUI
}

export function OngletCreneaux({ profil }: Props) {
  const router = useRouter()
  const [enCours, startTransition] = useTransition()

  /**
   * L'ordre affiché. Il part du serveur, et le glisser-déposer le change
   * localement AVANT la réponse (sinon la carte revient à sa place le temps de
   * l'aller-retour, et on croit que le geste a raté). Le serveur reste maître :
   * chaque `router.refresh()` réaligne cette liste.
   */
  // La resynchronisation se fait PENDANT LE RENDU et non dans un effet : après
  // un `router.refresh()`, un effet afficherait d'abord l'ancien ordre puis le
  // nouveau — la carte qu'on vient de déplacer sauterait une fois de plus.
  // (Pattern « ajuster un état quand une prop change » de la doc React.)
  const [liste, setListe] = useState<CreneauUI[]>(profil.creneaux)
  const [listeServeur, setListeServeur] = useState<CreneauUI[]>(profil.creneaux)
  if (listeServeur !== profil.creneaux) {
    setListeServeur(profil.creneaux)
    setListe(profil.creneaux)
  }

  // Panneau de création (en tête de liste) et son formulaire.
  const [creation, setCreation] = useState(false)
  const [formNouveau, setFormNouveau] = useState<FormCreneau>(FORM_VIDE)

  // Édition en place : l'id du créneau déplié, et son formulaire.
  const [editId, setEditId] = useState<string | null>(null)
  const [formEdit, setFormEdit] = useState<FormCreneau>(FORM_VIDE)
  const [empreinteInitiale, setEmpreinteInitiale] = useState('')

  // Confirmation de suppression.
  const [aSupprimer, setASupprimer] = useState<CreneauUI | null>(null)

  // Glisser-déposer : la carte tirée, la position visée, et la carte dont la
  // poignée est enfoncée. Cette dernière est un ÉTAT et non une ref : c'est
  // elle qui pose `draggable` sur la carte, donc elle doit provoquer un rendu.
  // Sans ça, on ne peut tirer une carte qu'à partir du deuxième essai —
  // et seulement une carte qui n'est pas la sienne.
  const [prise, setPrise] = useState<number | null>(null)
  const [cible, setCible] = useState<number | null>(null)
  const [poigneeId, setPoigneeId] = useState<string | null>(null)

  const total = liste.length
  const actifs = liste.filter((c) => c.actif).length

  // ── Création ─────────────────────────────────────────────────────────────
  const ouvrirCreation = () => {
    if (creation) {
      setCreation(false)
      return
    }
    setFormNouveau(FORM_VIDE)
    setEditId(null)
    setCreation(true)
  }

  const creer = () => {
    const f = formNouveau
    startTransition(async () => {
      const res = await creerCreneauSurMesure({
        profil_id: profil.id,
        nom: f.nom.trim(),
        jours_semaine: f.jours,
        heure_debut: f.heureDebut,
        heure_fin: f.heureFin,
        offset_jours_fin: f.offset,
        nb_places: f.nbPlaces,
        roles: f.roles.map((r) => r.trim()),
      })
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(
        `« ${f.nom.trim()} » ajouté au profil ${profil.nom} — il sera planifié dès la prochaine génération.`,
      )
      setCreation(false)
      setFormNouveau(FORM_VIDE)
      router.refresh()
    })
  }

  // ── Édition ──────────────────────────────────────────────────────────────
  const ouvrirEdition = (c: CreneauUI) => {
    if (editId === c.id) {
      setEditId(null)
      return
    }
    const f = formDepuisCreneau(c)
    setFormEdit(f)
    setEmpreinteInitiale(empreinte(f))
    setCreation(false)
    setEditId(c.id)
  }

  const enregistrer = (c: CreneauUI) => {
    const f = formEdit
    startTransition(async () => {
      const res = await modifierCreneau({
        id: c.id,
        nom: f.nom.trim(),
        jours_semaine: f.jours,
        sur_feries: f.surFeries,
        heure_debut: f.heureDebut,
        heure_fin: f.heureFin,
        offset_jours_fin: f.offset,
        nb_places: f.nbPlaces,
        roles: f.roles.map((r) => r.trim()),
      })
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`« ${f.nom.trim()} » enregistré — effet à la prochaine génération.`)
      setEditId(null)
      router.refresh()
    })
  }

  // ── Activation ───────────────────────────────────────────────────────────
  const basculerActif = (c: CreneauUI) => {
    startTransition(async () => {
      const res = await setCreneauActif(c.id, !c.actif)
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(
        c.actif
          ? `« ${c.nom} » désactivé — il n'émettra plus aucune garde.`
          : `« ${c.nom} » réactivé — il émettra de nouveau des gardes.`,
      )
      router.refresh()
    })
  }

  // ── Suppression ──────────────────────────────────────────────────────────
  const supprimer = () => {
    if (!aSupprimer) return
    const c = aSupprimer
    startTransition(async () => {
      const res = await supprimerCreneauSurMesure(c.id)
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`« ${c.nom} » supprimé du profil ${profil.nom}.`)
      setASupprimer(null)
      if (editId === c.id) setEditId(null)
      router.refresh()
    })
  }

  // ── Réordonnancement ─────────────────────────────────────────────────────
  /**
   * Déplace un créneau de `depuis` vers `vers`. Optimiste : on montre le
   * nouvel ordre tout de suite, et on revient exactement à l'ancien si le
   * serveur refuse (catalogue modifié ailleurs, droits, réseau).
   */
  const deplacer = (depuis: number, vers: number) => {
    if (depuis === vers || vers < 0 || vers >= liste.length) return
    const avant = liste
    const apres = [...liste]
    const [tire] = apres.splice(depuis, 1)
    apres.splice(vers, 0, tire)
    setListe(apres)

    startTransition(async () => {
      const res = await reordonnerCreneaux(
        profil.id,
        apres.map((c) => c.id),
      )
      if (res && 'error' in res) {
        setListe(avant)
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  /** Flèches Haut/Bas sur la poignée — un glisser sans clavier est inaccessible. */
  const clavierPoignee = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault()
      deplacer(i, i - 1)
    } else if (e.key === 'ArrowDown' && i < liste.length - 1) {
      e.preventDefault()
      deplacer(i, i + 1)
    }
  }

  const finDuGlisser = () => {
    setPrise(null)
    setCible(null)
    setPoigneeId(null)
  }

  const rienAEnregistrer = empreinte(formEdit) === empreinteInitiale

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Types de garde</h2>
          <span className={`section-count${total === 0 ? ' zero' : ''}`}>
            {actifs} actif{actifs > 1 ? 's' : ''}
            {total !== actifs ? ` / ${total}` : ''}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={ouvrirCreation}
            aria-expanded={creation}
            disabled={enCours}
          >
            <Plus size={16} aria-hidden="true" />
            Créer un type sur-mesure
          </button>
          <p className="sub">
            Le catalogue du profil « {profil.nom} » : ce que le moteur a le droit de planifier,
            avec ses jours, ses places et ses horaires. L&apos;ordre de cette liste est celui de
            l&apos;affichage — glisse une carte pour le changer.
          </p>
        </div>

        {/* ── Création d'un type sur-mesure ────────────────────────────── */}
        {creation && (
          <div className="panneau">
            <p className="panneau-titre">Nouveau type de garde dans « {profil.nom} »</p>

            <ChampsCreneau
              cle="cre-nouveau"
              form={formNouveau}
              setForm={setFormNouveau}
              joursFiges={false}
              bloque={enCours}
            />

            <p className="note">
              Il sera planifié dès la prochaine génération, avec les mêmes garanties que les
              autres : un vétérinaire différent par place, jamais deux gardes le même jour pour
              une même personne, congés respectés, attributions réparties équitablement.
            </p>

            <div className="panneau-pied">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCreation(false)}
                disabled={enCours}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={creer}
                disabled={enCours || formIncomplet(formNouveau, false)}
              >
                {enCours ? 'Un instant…' : 'Créer le type de garde'}
              </button>
            </div>
          </div>
        )}

        {/* ── Le catalogue ─────────────────────────────────────────────── */}
        {liste.length === 0 ? (
          <p className="empty-row">
            Le profil « {profil.nom} » n&apos;a aucun type de garde : le moteur n&apos;aurait rien
            à placer et la génération ne produirait aucune garde. Crée-en au moins un.
          </p>
        ) : (
          <div className="cre-liste">
            {liste.map((c, i) => {
              const ouvert = editId === c.id
              const classes = [
                'cre-carte',
                c.actif ? '' : 'eteint',
                prise === i ? 'prise' : '',
                cible === i && prise !== null && prise !== i ? 'cible' : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <article
                  key={c.id}
                  className={classes}
                  draggable={poigneeId === c.id}
                  onDragStart={(e) => {
                    if (poigneeId !== c.id) {
                      e.preventDefault()
                      return
                    }
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', c.id)
                    setPrise(i)
                  }}
                  onDragOver={(e) => {
                    if (prise === null) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setCible(i)
                  }}
                  onDrop={(e) => {
                    if (prise === null) return
                    e.preventDefault()
                    const depuis = prise
                    finDuGlisser()
                    deplacer(depuis, i)
                  }}
                  onDragEnd={finDuGlisser}
                >
                  <div className="cre-tete">
                    <button
                      type="button"
                      className="cre-poignee"
                      aria-label={`Déplacer « ${c.nom} » dans la liste — position ${i + 1} sur ${liste.length}. Flèches Haut et Bas pour changer d'ordre.`}
                      disabled={enCours || liste.length < 2}
                      onMouseDown={() => setPoigneeId(c.id)}
                      onTouchStart={() => setPoigneeId(c.id)}
                      onKeyDown={(e) => clavierPoignee(e, i)}
                      onBlur={finDuGlisser}
                    >
                      <GripVertical size={17} aria-hidden="true" />
                    </button>

                    <div className="cre-titre">
                      <span className="cre-nom">{c.nom}</span>
                      {!c.estSeed && <span className="etiq neutre">Sur-mesure</span>}
                      {!c.actif && <span className="etiq eteint">Désactivé</span>}
                    </div>

                    <div className="cre-actions">
                      <button
                        type="button"
                        className="icon-btn doux"
                        onClick={() => ouvrirEdition(c)}
                        disabled={enCours}
                        aria-expanded={ouvert}
                        title={`Modifier « ${c.nom} »`}
                        aria-label={`Modifier « ${c.nom} »`}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn doux"
                        onClick={() => basculerActif(c)}
                        disabled={enCours}
                        title={
                          c.actif
                            ? `Désactiver « ${c.nom} » — il n'émettra plus aucune garde`
                            : `Réactiver « ${c.nom} »`
                        }
                        aria-label={
                          c.actif ? `Désactiver « ${c.nom} »` : `Réactiver « ${c.nom} »`
                        }
                      >
                        <Power size={15} aria-hidden="true" />
                      </button>
                      {!c.estSeed && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setASupprimer(c)}
                          disabled={enCours}
                          title={`Supprimer « ${c.nom} »`}
                          aria-label={`Supprimer « ${c.nom} »`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Les trois faits, toujours dans le même ordre : on les
                      compare d'une carte à l'autre. Ils sont mis en clair côté
                      serveur — cet écran les affiche, il ne les recalcule pas. */}
                  <div className="cre-faits">
                    <div className="fait">
                      <span>Jours</span>
                      <b>{c.joursClair}</b>
                    </div>
                    <div className="fait">
                      <span>Places</span>
                      <b>{c.placesClair}</b>
                    </div>
                    <div className="fait">
                      <span>Horaires</span>
                      <b>{c.horairesClair}</b>
                    </div>
                  </div>

                  {/* L'édition se déplie DANS la carte : on veut voir le créneau
                      qu'on modifie. C'est tout l'objet de cet onglet — la V1
                      obligeait à le retrouver dans une seconde liste. */}
                  {ouvert && (
                    <div className="cre-form">
                      <ChampsCreneau
                        cle={`cre-${c.id}`}
                        form={formEdit}
                        setForm={setFormEdit}
                        joursFiges={c.estSeed}
                        bloque={enCours}
                      />

                      {c.estSeed && (
                        <p className="note">
                          Ce type de garde fait partie des quatre de base : il ne peut pas être
                          supprimé, parce qu&apos;il sert de filet au cabinet — sans lui, une
                          période entière pourrait ne plus être couverte sans que personne ne le
                          remarque. Si tu ne veux plus qu&apos;il produise de gardes, désactive-le
                          : c&apos;est réversible et il reste ici.
                        </p>
                      )}

                      <div className="panneau-pied">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setEditId(null)}
                          disabled={enCours}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent"
                          onClick={() => enregistrer(c)}
                          disabled={
                            enCours || rienAEnregistrer || formIncomplet(formEdit, c.estSeed)
                          }
                        >
                          {enCours ? 'Un instant…' : 'Enregistrer'}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Confirmation de suppression ──────────────────────────────────
          Une vraie modale, pas un `window.confirm()` : elle dit ce qu'on perd,
          et elle propose le geste réversible que l'utilisateur cherchait
          probablement. */}
      <Dialog
        open={Boolean(aSupprimer)}
        onOpenChange={(o) => {
          if (!o && !enCours) setASupprimer(null)
        }}
      >
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle>Supprimer « {aSupprimer?.nom} » ?</DialogTitle>
            <DialogDescription>
              C&apos;est définitif. Ce type de garde disparaît du profil « {profil.nom} », et avec
              lui ses horaires, ses places et les enchaînements qui le désignent. Le moteur
              n&apos;en produira plus aucune garde. Pour l&apos;arrêter sans rien perdre, préfère
              « Désactiver » : il reste dans la liste, éteint, et se rallume d&apos;un clic.
            </DialogDescription>
          </DialogHeader>

          {aSupprimer && (
            <p className="note">
              {aSupprimer.joursClair} · {aSupprimer.placesClair} · {aSupprimer.horairesClair}
            </p>
          )}

          <p className="note">
            Les plannings déjà générés ne sont pas modifiés : les gardes publiées restent telles
            quelles.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setASupprimer(null)} disabled={enCours}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={supprimer} disabled={enCours}>
              {enCours ? 'Un instant…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
