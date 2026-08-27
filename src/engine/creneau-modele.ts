// ============================================================
// GUARDVETO — Créneau modèle : le fondamental universel (Phase 1)
// ============================================================
// Un CRÉNEAU est le primitif unique du moteur pour représenter n'importe
// quelle garde d'un cabinet : quels jours, quelle fenêtre horaire, combien
// de places/rôles. Les 4 types historiques ne sont plus du code — ce sont
// des lignes de `creneau_modele` (seed par cabinet).
//
// PRINCIPE (MiKL) : le moteur garde ses fondamentaux universels ; l'IA traduit
// le langage du cabinet vers ces fondamentaux (comme pour les règles). Ce
// module ne porte que le TYPE côté moteur. Le loader vit dans
// src/data/chargerCreneauModele. La consommation par le moteur = Phase 2.
// ============================================================

/** Genre de relation entre deux créneaux (remplace R8/R9 en dur). */
export type GenreRelationCreneau = 'meme_binome' | 'inversion_role' | 'repos_apres'

/** Un créneau planifiable — le fondamental universel du moteur. */
export interface CreneauModele {
  id: string
  /** Code des 4 créneaux par défaut (semaine_soir…) ; null si sur-mesure. */
  code: string | null
  nom: string
  /** Jours d'application (0=dim … 6=sam). */
  joursSemaine: number[]
  /** S'applique les jours fériés. */
  surFeries: boolean
  /** Fenêtre horaire 'HH:MM' (locale Europe/Paris) — libre (matin/aprèm/nuit). */
  heureDebut: string
  heureFin: string
  /** Jours entre début et fin (0 = même jour, 1 = lendemain, 2 = surlendemain). */
  offsetJoursFin: number
  /** Nombre de places (vétos) et noms des rôles. */
  nbPlaces: number
  roles: string[]
  actif: boolean
  ordre: number
  /**
   * Chantier agenda Google (2026-08-27) — base de l'intitulé Google Agenda
   * pour ce créneau (ex. « garde »). NULL/absent = on reprend `nom`. Porté
   * par le créneau et non codé en dur : c'est l'anticipation V3 — un créneau
   * de journée ajouté plus tard (planning de journée, pas seulement les
   * gardes) apporte directement son propre libellé, sans reprise de code.
   */
  libelleAgenda?: string | null
}

/** Relation universelle entre deux créneaux d'un cabinet. */
export interface RelationCreneau {
  id: string
  sourceId: string
  cibleId: string
  genre: GenreRelationCreneau
  actif: boolean
}

/** Ce créneau s'applique-t-il à un jour donné (index 0=dim…6=sam, férié ?) ? */
export function creneauCouvreJour(c: CreneauModele, jourIdx: number, estFerie: boolean): boolean {
  if (!c.actif) return false
  if (estFerie && c.surFeries) return true
  return c.joursSemaine.includes(jourIdx)
}

// ── Détection des créneaux ignorés par le moteur (backlog n°4) ──

/**
 * Un créneau du catalogue que la génération va ignorer EN SILENCE, et pourquoi.
 *
 * Depuis P3b (créneaux sur-mesure réellement planifiables), tout code non-null
 * génère de vrais slots — y compris plusieurs créneaux le même jour. Restent
 * ignorés :
 * - `sans_code`   : créneau jamais codifié (code null) → aucun slot généré.
 * - `aucun_jour`  : créneau actif qui ne couvre aucun jour (hors férié) → rien
 *                   à planifier (configuration probablement incomplète).
 * `ferie` reste À PART, par design : le férié est une reclassification au
 * scoring, pas un slot propre — jamais d'avertissement.
 */
export interface CreneauIgnore {
  id: string
  nom: string
  raison: 'sans_code' | 'aucun_jour'
  /** Jours concernés (0=dim … 6=sam). Vide si le créneau ne couvre aucun jour. */
  jours: number[]
}

/**
 * Recense les créneaux ACTIFS du catalogue que le moteur ignorera à la
 * génération. MIROIR EXACT du filtre de `stepsForDay` (solver.ts) et de
 * `slotsAttendus` (validateur) : actif, non-férié, code non-null → planifié.
 *
 * Catalogue par DÉFAUT (seed 4 types) → tableau vide, garanti par test —
 * aucun bruit pour les cabinets existants.
 */
export function detecterCreneauxIgnores(creneaux: CreneauModele[]): CreneauIgnore[] {
  const ignores: CreneauIgnore[] = []
  for (const c of creneaux) {
    if (!c.actif || c.surFeries || c.code === 'ferie') continue
    if (c.code === null) {
      ignores.push({ id: c.id, nom: c.nom, raison: 'sans_code', jours: [...c.joursSemaine] })
    } else if (c.joursSemaine.length === 0) {
      ignores.push({ id: c.id, nom: c.nom, raison: 'aucun_jour', jours: [] })
    }
  }
  return ignores
}

/**
 * Type de créneau (code) couvrant un jour de semaine donné (0=dim…6=sam),
 * DÉRIVÉ du catalogue au lieu du mapping en dur. Ignore les créneaux « fériés »
 * (qui ne génèrent pas de slot propre dans le modèle actuel — le férié est une
 * reclassification au scoring, pas un slot). Renvoie le code du premier créneau
 * (par ordre) couvrant ce jour, ou null.
 *
 * P2 : pour le catalogue PAR DÉFAUT (4 types seed), le résultat est IDENTIQUE à
 * typeGardePourJour (prouvé par test) → bascule sans changement de comportement.
 */
export function typeGardePourJourCatalogue(creneaux: CreneauModele[], jourIdx: number): string | null {
  const c = creneaux.find(
    (cr) => cr.actif && !cr.surFeries && cr.joursSemaine.includes(jourIdx),
  )
  return c ? c.code : null
}
