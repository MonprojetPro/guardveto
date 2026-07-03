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

// ── Détection des créneaux ignorés par le moteur (backlog n°4, tranche 1) ──

/**
 * Codes que le solver sait effectivement planifier aujourd'hui (cf.
 * `stepsForDay` dans solver.ts). `ferie` est À PART : il ne génère pas de slot
 * propre (le férié est une reclassification au scoring), c'est voulu — il ne
 * doit donc jamais déclencher d'avertissement.
 */
const CODES_PLANIFIABLES = new Set(['semaine_soir', 'vendredi_soir', 'weekend'])

/**
 * Un créneau du catalogue que la génération va ignorer EN SILENCE, et pourquoi.
 * - `type_inconnu`   : code sur-mesure (ou null) que le moteur ne sait pas encore
 *                      planifier → aucun slot généré pour ce créneau.
 * - `jour_masque`    : un autre créneau actif couvre le(s) même(s) jour(s) et
 *                      passe avant lui (stepsForDay ne retient que le PREMIER
 *                      créneau actif d'un jour) → ignoré ces jours-là.
 */
export interface CreneauIgnore {
  id: string
  nom: string
  raison: 'type_inconnu' | 'jour_masque'
  /** Jours concernés (0=dim … 6=sam). Vide si le créneau ne couvre aucun jour. */
  jours: number[]
}

/**
 * Recense les créneaux ACTIFS du catalogue que le moteur ignorera à la
 * génération. MIROIR EXACT de la sélection de `stepsForDay` (solver.ts) :
 * pour chaque jour, seul le premier créneau actif non-férié est retenu, et
 * seulement si son code fait partie des codes planifiables.
 *
 * Catalogue par DÉFAUT (seed 4 types, aucun chevauchement) → tableau vide,
 * garanti par test — aucun bruit pour les cabinets existants.
 */
export function detecterCreneauxIgnores(creneaux: CreneauModele[]): CreneauIgnore[] {
  const ignores = new Map<string, CreneauIgnore>()
  const signaler = (c: CreneauModele, raison: CreneauIgnore['raison'], jour?: number) => {
    const existant = ignores.get(c.id)
    if (existant) {
      if (jour !== undefined && !existant.jours.includes(jour)) existant.jours.push(jour)
      return
    }
    ignores.set(c.id, {
      id: c.id, nom: c.nom, raison, jours: jour === undefined ? [] : [jour],
    })
  }

  // Créneaux au type non planifiable : ignorés partout, quel que soit le jour.
  for (const c of creneaux) {
    if (!c.actif) continue
    if (c.code !== null && (c.code === 'ferie' || CODES_PLANIFIABLES.has(c.code))) continue
    for (const j of c.joursSemaine) signaler(c, 'type_inconnu', j)
    if (c.joursSemaine.length === 0) signaler(c, 'type_inconnu')
  }

  // Créneaux masqués : couvrent un jour dont le créneau RETENU est un autre.
  for (let jour = 0; jour <= 6; jour++) {
    const couvrants = creneaux.filter(
      (cr) => cr.actif && !cr.surFeries && cr.joursSemaine.includes(jour),
    )
    for (const masque of couvrants.slice(1)) {
      // Un type inconnu est déjà signalé plus haut (raison plus parlante).
      if (masque.code === null || !CODES_PLANIFIABLES.has(masque.code)) continue
      signaler(masque, 'jour_masque', jour)
    }
  }

  return [...ignores.values()]
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
