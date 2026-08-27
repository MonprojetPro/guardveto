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
//      horaires d'« Été ». Ici, la période type est le contexte de la PAGE
//      (`ReglesStructureV2`) — cet onglet ne fait qu'en recevoir un.
//
// Une carte par type de garde, dépliable pour éditer. On modifie celui qu'on
// regarde, pas son homonyme dans une autre liste. D'où l'édition en place
// plutôt qu'en modale.
//
// ── CE QUI N'EXISTE PAS ICI, ET POURQUOI ──────────────────────────────────
//
// PAS DE GLISSER-DÉPOSER. Une première version permettait de réordonner les
// cartes. Retiré : la colonne `ordre` ne pilote que l'affichage de ce
// catalogue, elle n'a aucun effet sur la génération. Un geste qui donne
// l'impression de changer le planning sans rien changer coûte plus cher qu'il
// ne rapporte. La liste s'affiche dans l'ordre reçu du serveur.
//
// PAS DE MENU DÉROULANT NATIF. Un `<select>` ouvre le menu du navigateur —
// carré, gris, hors du terrier, juste à côté de boutons arrondis. Tous les
// choix de cet écran passent par le `Select` du projet, déjà habillé de bout
// en bout.
//
// ── CE QUI SE VOIT ────────────────────────────────────────────────────────
//
// Chaque type de garde porte sa teinte et son icône (`.cre-ico`, plus le
// liseré gauche de la carte). Quatre cartes de texte sombre alignées se lisent
// comme un tableau : on relit trois mots pour retrouver la bonne. Une couleur
// se reconnaît sans lire.
//
// ── DEUX GARDE-FOUS QU'ON EXPLIQUE PLUTÔT QUE DE LES SUBIR ────────────────
//
// · Les JOURS et les FÉRIÉS d'un type de garde de base sont figés — tout le
//   calage du planning repose dessus. On le dit en français, à l'endroit où le
//   champ est grisé, et on donne le chemin de sortie (désactiver, puis créer
//   du sur-mesure).
// · Les 4 types de garde de base sont insupprimables. Le bouton n'est pas là
//   plutôt que désactivé sans un mot : on dit pourquoi, et on renvoie sur
//   « Désactiver », qui fait ce que l'utilisateur cherchait.
//
// Désactiver et supprimer passent tous les deux par une vraie modale qui NOMME
// les jours qui ne seront plus couverts. Désactiver « les soirs de semaine »,
// c'est arrêter d'engendrer des gardes du lundi au jeudi : ça ne peut pas se
// deviner au survol d'un interrupteur. La V1 posait deux `window.confirm()` —
// une boîte grise du navigateur, qui ne disait pas ce qu'on perdait.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarClock,
  Moon,
  PartyPopper,
  Pencil,
  Plus,
  Power,
  Sun,
  Sunset,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import {
  creerCreneauSurMesure,
  modifierCreneau,
  setCreneauActif,
  supprimerCreneauSurMesure,
} from '@/app/(protected)/admin/structure/actions'
import type { CreneauUI, ProfilUI } from './types'
import { useErreurBloquante } from './ErreurBloquante'

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
const FIN_LABELS: Record<string, string> = {
  '0': 'le jour même',
  '1': 'le lendemain',
  '2': 'le surlendemain',
  '3': 'trois jours après',
}

/** Libellés proposés d'office pour les places — renommables. */
const ROLES_AUTO = ['premier', 'second', 'troisieme', 'quatrieme']

/** Borne du serveur, reprise ici pour ne pas proposer l'invalide. */
const PLACES_MAX = 4

/**
 * La teinte et l'icône d'un type de garde. Les quatre types de base ont la
 * leur ; tout le sur-mesure partage la sarcelle, qui n'est prise par aucun des
 * quatre — un cabinet peut en créer autant qu'il veut, on ne va pas lui
 * distribuer des couleurs au hasard.
 */
function identite(code: string | null): { teinte: string; Icone: LucideIcon } {
  switch (code) {
    case 'semaine_soir':
      return { teinte: '#5B6B8C', Icone: Moon }
    case 'vendredi_soir':
      return { teinte: '#8A5A9B', Icone: Sunset }
    case 'weekend':
      return { teinte: '#C7530F', Icone: Sun }
    case 'ferie':
      return { teinte: '#3E7A2E', Icone: PartyPopper }
    default:
      return { teinte: '#2F7D7A', Icone: CalendarClock }
  }
}

/** La variable locale `--c` que lisent `.cre-ico` et le liseré de `.cre-carte`. */
function teinteCss(teinte: string): React.CSSProperties {
  return { '--c': teinte } as React.CSSProperties
}

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

/** Vrai s'il manque quelque chose pour pouvoir enregistrer. */
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
  /** Type de garde de base : jours et fériés figés (cf. en-tête). */
  joursFiges: boolean
  bloque: boolean
  /** Code du créneau édité — `semaine_soir` a un plafond à part (cf. plus bas). */
  code?: string | null
}

function ChampsCreneau({ cle, form, setForm, joursFiges, bloque, code }: ChampsProps) {
  const basculerJour = (idx: number) => {
    setForm({
      ...form,
      jours: form.jours.includes(idx)
        ? form.jours.filter((j) => j !== idx)
        : [...form.jours, idx],
    })
  }

  const joursBloques = bloque || joursFiges

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
              disabled={joursBloques}
              onClick={() => basculerJour(j.idx)}
            >
              {j.court}
            </button>
          ))}
        </div>

        {/* La case fériés suit immédiatement les jours : c'est la même question
            — « quand ce type de garde s'applique-t-il ? ». */}
        <label
          htmlFor={`${cle}-feries`}
          className={`case-ligne${joursBloques ? ' inerte' : ''}`}
        >
          <input
            id={`${cle}-feries`}
            type="checkbox"
            checked={form.surFeries}
            disabled={joursBloques}
            onChange={(e) => setForm({ ...form, surFeries: e.target.checked })}
          />
          S&apos;applique aussi les jours fériés
        </label>

        {joursFiges && (
          <p className="note">
            Les jours de ce type de garde ne se modifient pas : c&apos;est sur eux que tout le
            planning est calé. Pour couvrir d&apos;autres jours, désactive-le et crée un type
            sur-mesure — le nom, les horaires et les places restent modifiables ici.
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
        <label id={`${cle}-offset-label`}>La garde se rend…</label>
        <Select
          value={String(form.offset)}
          onValueChange={(v) => v && setForm({ ...form, offset: Number(v) })}
          disabled={bloque}
        >
          <SelectTrigger className="w-full" aria-labelledby={`${cle}-offset-label`}>
            {FIN_LABELS[String(form.offset)]}
          </SelectTrigger>
          <SelectContent>
            {['0', '1', '2', '3'].map((o) => (
              <SelectItem key={o} value={o}>
                {FIN_LABELS[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        {/* « au maximum » : ce réglage est le PLAFOND du socle. Chaque période
            type choisit ensuite combien elle en utilise, et le moteur retient
            le plus petit des deux (B-069). */}
        <label id={`${cle}-places-label`}>Vétérinaires de garde, au maximum</label>
        <Select
          value={String(form.nbPlaces)}
          onValueChange={(v) => {
            if (!v) return
            const n = Number(v)
            setForm({ ...form, nbPlaces: n, roles: ajusterRoles(form.roles, n) })
          }}
          disabled={bloque}
        >
          <SelectTrigger className="w-full" aria-labelledby={`${cle}-places-label`}>
            {form.nbPlaces} vétérinaire{form.nbPlaces > 1 ? 's' : ''}
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: PLACES_MAX }, (_, i) => String(i + 1)).map((n) => (
              <SelectItem key={n} value={n}>
                {n} vétérinaire{n === '1' ? '' : 's'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          dans les compteurs. Ils doivent être différents les uns des autres.
        </p>
      </div>

      {/* Au-delà de deux places, trois choses ne suivent pas encore. On les dit
          AVANT, au moment où le chiffre est saisi — pas après publication,
          quand le planning est déjà sorti à côté de ce qui était attendu. */}
      {form.nbPlaces > 2 && (
        <p className="note attention large">
          À partir de 3 vétérinaires par garde, deux limites à connaître : on ne peut plus changer
          une personne à la main depuis le planning (il faut relancer une génération), et sur les
          nuits de semaine, la 3ᵉ et la 4ᵉ place ne sont pas encore comptées dans l&apos;équilibrage
          des charges — ces gardes-là ne seront donc pas réparties équitablement. Le week-end et les
          jours fériés, eux, comptent bien tout le monde.
        </p>
      )}

      {/* ⚠️ LE SOIR DE SEMAINE A DEUX MAÎTRES. C'est le seul créneau dont le
          nombre de places est PLAFONNÉ par un second réglage : « Le soir en
          semaine », porté par la période type et surchargeable par planning. Le moteur
          retient le plus petit des deux. Déclarer 4 places ici sans toucher à
          l'autre réglage ne produit donc pas 4 gardes — et rien ne le disait
          jusqu'ici : le planning sortait simplement plus petit que demandé. */}
      {code === 'semaine_soir' && (
        <p className="note attention large">
          Ce type de garde est le seul à dépendre aussi du réglage «&nbsp;Le soir en
          semaine&nbsp;» de l&apos;onglet Périodes types : c&apos;est le plus petit des deux qui
          s&apos;applique. Pour {form.nbPlaces} vétérinaire{form.nbPlaces > 1 ? 's' : ''} par
          nuit, réglez-le sur {form.nbPlaces} lui aussi — sinon la génération s&apos;arrêtera au
          plus petit chiffre.
        </p>
      )}
    </div>
  )
}

// ── L'onglet ────────────────────────────────────────────────────────────────

interface Props {
  /** La période type courante, avec son catalogue déjà trié par `ordre`. */
  profil: ProfilUI
}

export function OngletCreneaux({ profil }: Props) {
  const router = useRouter()
  const [enCours, startTransition] = useTransition()

  // Panneau de création (en tête de liste) et son formulaire.
  const [creation, setCreation] = useState(false)
  const [formNouveau, setFormNouveau] = useState<FormCreneau>(FORM_VIDE)

  // Édition en place : l'id du type de garde déplié, et son formulaire.
  const [editId, setEditId] = useState<string | null>(null)
  const [formEdit, setFormEdit] = useState<FormCreneau>(FORM_VIDE)
  const [empreinteInitiale, setEmpreinteInitiale] = useState('')

  // Les deux confirmations : arrêter un type de garde, et l'effacer.
  const [aDesactiver, setADesactiver] = useState<CreneauUI | null>(null)
  const [aSupprimer, setASupprimer] = useState<CreneauUI | null>(null)

  // Les refus s'affichent en modale (cf. `ErreurBloquante`).
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  // Le catalogue arrive trié du serveur : on l'affiche tel quel, sans état
  // local. Rien ne le réordonne côté écran.
  const liste = profil.creneaux
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
        ouvrirErreur(res.error)
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
        ouvrirErreur(res.error)
        return
      }
      toast.success(`« ${f.nom.trim()} » enregistré — effet à la prochaine génération.`)
      setEditId(null)
      router.refresh()
    })
  }

  // ── Arrêt / reprise ──────────────────────────────────────────────────────
  /**
   * Réactiver est sans risque : on le fait tout de suite. Désactiver arrête
   * d'engendrer des gardes sur des jours entiers — ça passe par la modale, qui
   * nomme ces jours.
   */
  const cliquerInterrupteur = (c: CreneauUI) => {
    if (c.actif) {
      setADesactiver(c)
      return
    }
    startTransition(async () => {
      const res = await setCreneauActif(c.id, true)
      if (res && 'error' in res) {
        ouvrirErreur(res.error)
        return
      }
      toast.success(`« ${c.nom} » réactivé — il engendrera de nouveau des gardes.`)
      router.refresh()
    })
  }

  const confirmerDesactivation = () => {
    if (!aDesactiver) return
    const c = aDesactiver
    startTransition(async () => {
      const res = await setCreneauActif(c.id, false)
      if (res && 'error' in res) {
        ouvrirErreur(res.error)
        return
      }
      toast.success(`« ${c.nom} » désactivé — plus aucune garde ne sera engendrée dessus.`)
      setADesactiver(null)
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
        ouvrirErreur(res.error)
        return
      }
      toast.success(`« ${c.nom} » supprimé du profil ${profil.nom}.`)
      setASupprimer(null)
      if (editId === c.id) setEditId(null)
      router.refresh()
    })
  }

  const rienAEnregistrer = empreinte(formEdit) === empreinteInitiale

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Structure des gardes</h2>
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
            Ajouter une garde
          </button>
          <p className="sub">
            Les gardes de la période type « {profil.nom} » : ce que le moteur a le droit de
            planifier, avec leurs jours, leurs places et leurs horaires. Tout ce qui change ici
            s&apos;applique au prochain planning généré — ceux déjà publiés ne bougent pas.
          </p>
        </div>

        {/* ── Ajouter une garde à la structure ─────────────────────────── */}
        {creation && (
          <div className="panneau">
            <p className="panneau-titre">Nouvelle garde dans « {profil.nom} »</p>

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
              une même personne, congés respectés, tours répartis équitablement.
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
                {enCours ? 'Un instant…' : 'Ajouter la garde'}
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
            {liste.map((c) => {
              const ouvert = editId === c.id
              const { teinte, Icone } = identite(c.code)

              return (
                <article
                  key={c.id}
                  className={`cre-carte${c.actif ? '' : ' eteint'}`}
                  style={teinteCss(teinte)}
                >
                  <div className="cre-tete">
                    <span className="cre-ico" aria-hidden="true">
                      <Icone size={19} />
                    </span>

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
                        onClick={() => cliquerInterrupteur(c)}
                        disabled={enCours}
                        title={c.actif ? `Désactiver « ${c.nom} »` : `Réactiver « ${c.nom} »`}
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
                    {/* « Places MAXIMUM », jamais « Places » tout court : ce
                        chiffre est un plafond, et c'est la période type qui dit
                        combien elle en utilise. Sans ce mot, un cabinet ayant
                        affiné à 1 véto lisait « 2 places » ici et croyait que
                        le moteur en poserait deux (B-069). */}
                    <div className="fait">
                      <span>Places maximum</span>
                      <b>{c.placesClair}</b>
                      {c.emploiReel && <em className="fait-nuance">{c.emploiReel}</em>}
                    </div>
                    <div className="fait">
                      <span>Horaires</span>
                      <b>{c.horairesClair}</b>
                    </div>
                  </div>

                  {/* Une carte éteinte doit DIRE ce qu'elle a arrêté. Une
                      étiquette « Désactivé » nomme un état ; elle ne dit pas
                      que des jours entiers ne sont plus couverts. */}
                  {!c.actif && (
                    <div className="cre-form">
                      <p className="consequence">
                        <Power size={15} aria-hidden="true" />
                        <span>
                          Aucune garde n&apos;est engendrée sur ce type : <b>{c.joursClair}</b> ne
                          sont plus couverts par la génération. Les plannings déjà publiés ne
                          changent pas. Réactive-le quand tu veux.
                        </span>
                      </p>
                    </div>
                  )}

                  {/* L'édition se déplie DANS la carte : on veut voir le type de
                      garde qu'on modifie. C'est tout l'objet de cet onglet — la
                      V1 obligeait à le retrouver dans une seconde liste. */}
                  {ouvert && (
                    <div className="cre-form">
                      <ChampsCreneau
                        cle={`cre-${c.id}`}
                        form={formEdit}
                        setForm={setFormEdit}
                        joursFiges={c.estSeed}
                        bloque={enCours}
                        code={c.code}
                      />

                      {c.estSeed && (
                        <p className="note">
                          Ce type de garde fait partie des quatre de base : il ne peut pas être
                          supprimé, parce qu&apos;il sert de filet au cabinet — sans lui, des
                          semaines entières pourraient se retrouver sans garde sans que personne
                          ne le remarque. Si tu ne veux plus qu&apos;il engendre de gardes,
                          désactive-le : c&apos;est réversible et il reste dans la liste.
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

      {/* ── Confirmation de désactivation ────────────────────────────────
          Un interrupteur de 34 pixels arrête la production de gardes sur des
          jours entiers. Personne ne peut le deviner : on l'écrit, avec les
          vrais jours du type de garde sous les yeux. */}
      <Dialog
        open={Boolean(aDesactiver)}
        onOpenChange={(o) => {
          if (!o && !enCours) setADesactiver(null)
        }}
      >
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle>Désactiver « {aDesactiver?.nom} » ?</DialogTitle>
            <DialogDescription>
              À la prochaine génération, plus aucune garde de ce type ne sera créée.
              C&apos;est réversible à tout moment : il reste dans la liste, éteint, et se
              rallume d&apos;un clic.
            </DialogDescription>
          </DialogHeader>

          {aDesactiver && (
            <p className="gv-rappel">
              <span>
                Jours qui ne seront plus couverts : <b>{aDesactiver.joursClair}</b>
              </span>
              <span className="gv-appoint">
                {aDesactiver.placesClair} · {aDesactiver.horairesClair}
              </span>
            </p>
          )}

          <ul className="gv-consequences">
            <li>Les plannings déjà générés ne bougent pas : les gardes publiées restent.</li>
            <li>Les périodes générées ensuite n&apos;auront plus aucune garde de ce type.</li>
            <li>
              Si aucun autre type de garde ne couvre ces jours-là, ils resteront sans
              vétérinaire de garde.
            </li>
          </ul>

          <DialogFooter>
            <Button variant="outline" onClick={() => setADesactiver(null)} disabled={enCours}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={confirmerDesactivation} disabled={enCours}>
              {enCours ? 'Un instant…' : 'Désactiver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              C&apos;est définitif. Pour l&apos;arrêter sans rien perdre, préfère
              « Désactiver » : il reste dans la liste et se rallume d&apos;un clic.
            </DialogDescription>
          </DialogHeader>

          {aSupprimer && (
            <p className="gv-rappel">
              <span>
                Jours qui ne seront plus couverts : <b>{aSupprimer.joursClair}</b>
              </span>
              <span className="gv-appoint">
                {aSupprimer.placesClair} · {aSupprimer.horairesClair}
              </span>
            </p>
          )}

          <ul className="gv-consequences">
            <li>Ses horaires et le nom de ses places sont perdus.</li>
            <li>Les enchaînements qui le désignent disparaissent avec lui.</li>
            <li>Les plannings déjà générés ne bougent pas : les gardes publiées restent.</li>
          </ul>

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

      {dialogueErreur}
    </>
  )
}
