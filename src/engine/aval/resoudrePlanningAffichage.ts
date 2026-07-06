// ============================================================
// GUARDVETO — Aval GÉNÉRIQUE : dérivation d'affichage pilotée par les relations
// ============================================================
// (P6 — verrou n°3 : rendre l'aval générique, étapes 0→1→2)
//
// LE PROBLÈME.
//   La table V1 `gardes` est la source de vérité (~20 lecteurs). Elle stocke le
//   week-end sur le SAMEDI (`type='weekend'`, premier_id/second_id = rôles du
//   week-end) et n'y stocke PAS le `vendredi_soir`. Le vendredi (et le dimanche)
//   sont donc RE-SYNTHÉTISÉS à l'affichage. Historiquement, cette synthèse
//   codait EN DUR l'inversion R8 (« le 1er du WE devient 2nd le vendredi ») à 4
//   endroits indépendants : la vue SQL `planning_semaine`, le validateur
//   (`gardesVersPlanning`), l'agenda Google (`google-calendar`) et le PDF
//   (`pdf.tsx`).
//
//   Depuis RG4, les relations entre créneaux sont PILOTABLES (`relation_creneau`,
//   genres `inversion_role` ex-R8 / `meme_binome` ex-R9). Un cabinet peut donc
//   désactiver l'inversion → les 4 synthèses EN DUR afficheraient alors un
//   vendredi FAUX en silence (rôles inversés alors que le cabinet ne le veut
//   plus). Ce module remplace la MAGIE R8 en dur par une dérivation qui APPLIQUE
//   les relations. DÉFAUT (couple historique actif) → sortie byte-identique.
//
// PÉRIMÈTRE (verrou n°3). On reste sur V1 `gardes` comme SOURCE (débrancher V1 =
//   étape 4, un autre checkpoint). On ne touche qu'à la DÉRIVATION du vendredi
//   (et du dimanche, qui est indépendant des relations — cf. plus bas).
//
// CE QUI EST PILOTABLE ICI (sensible aux relations) : le VENDREDI.
//   - `meme_binome` actif  → le vendredi porte la MÊME équipe que le week-end.
//   - `inversion_role` actif → les rôles sont permutés (réversion de l'ordre —
//     swap 1er↔2nd pour 2 places). Défaut (les deux actifs) = inversion R8.
//   - meme_binome absent → l'équipe du vendredi n'est PAS dérivable de V1 (le
//     vendredi serait un créneau planifié à part, non stocké en V1) → on ne
//     matérialise PAS le vendredi. Le défaut a toujours meme_binome → sûr.
//
// CE QUI N'EST PAS PILOTABLE (indépendant des relations) : le DIMANCHE.
//   Le dimanche est la CONTINUATION de la garde de week-end (le créneau
//   `weekend` couvre samedi+dimanche : joursSemaine=[6], offsetJoursFin=2). Il
//   porte TOUJOURS la même équipe/rôles que le samedi, quel que soit le réglage
//   R8/R9 — ce n'est donc jamais un affichage « faux » quand un cabinet change
//   ses relations. On le matérialise comme une continuation d'affichage.
//
// PURETÉ. Zéro dépendance Supabase/Next : (gardes + relations résolues +
//   catalogue) → grille. Testable en isolation, réutilisable par les 4 avals.
// ============================================================

import type { AttributionGarde, Placement } from '../types'
import type { RelationStructure, GenreRelationStructure } from '../structure-config'
import { RELATIONS_STRUCTURE_DEFAUT } from '../structure-config'
import type { CreneauModele } from '../creneau-modele'

// ── Ligne brute de la table V1 `gardes` (forme minimale partagée) ──
export interface GardeRowAval {
  id?: string
  date: string
  /** Type V1 ('semaine'/'weekend'/'ferie') ou code sur-mesure (P3b). */
  type: string
  premier_id: string | null
  second_id: string | null
}

// ── Helpers de dates PURS (T12:00:00Z, comme les autres avals) ──

/** Recule une date ISO yyyy-mm-dd de `n` jours (UTC, pur). */
export function moinsJoursAval(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Avance une date ISO yyyy-mm-dd de `n` jours (UTC, pur). */
export function plusJoursAval(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ============================================================
// LE KERNEL — réordonnancement d'une occurrence SOURCE liée à une CIBLE
// ============================================================
// Générique sur l'OCCUPANT (T) : le validateur passe des vetIds, le PDF des
// objets d'affichage (prénom/nom/couleur), l'agenda des prénoms. La logique de
// permutation est la MÊME partout — un seul endroit à faire évoluer.

/** Genres de relation actifs entre un couple (source → cible) donné. */
function genresPourCouple(
  relations: readonly RelationStructure[],
  sourceCode: string,
  cibleCode: string,
): Set<GenreRelationStructure> {
  const set = new Set<GenreRelationStructure>()
  for (const r of relations) {
    if (r.sourceCode === sourceCode && r.cibleCode === cibleCode) set.add(r.genre)
  }
  return set
}

/**
 * Ordonne les occupants de la SOURCE liée, dérivés de ceux de la CIBLE, en
 * appliquant les relations du couple (source → cible).
 *
 *  - `meme_binome`  : même équipe → on reprend les occupants de la cible.
 *  - `inversion_role` : rôles permutés → RÉVERSION de l'ordre (swap 1er↔2nd
 *     pour 2 places ; pour N places, réversion — miroir exact de l'ancienne
 *     magie sur le couple historique à 2 rôles).
 *
 * Défaut (les DEUX actifs) → occupants inversés = comportement R8 historique.
 * `meme_binome` ABSENT → `null` : l'équipe de la source n'est pas dérivable de
 * la cible (V1 ne stocke pas ce créneau) → la source n'est pas matérialisée.
 *
 * @param cibleOccupants occupants de la cible, DANS L'ORDRE DES RÔLES.
 */
export function ordonnerSourceLiee<T>(
  cibleOccupants: readonly (T | null)[],
  relations: readonly RelationStructure[],
  sourceCode: string,
  cibleCode: string,
): (T | null)[] | null {
  const genres = genresPourCouple(relations, sourceCode, cibleCode)
  if (!genres.has('meme_binome')) return null
  const occ = [...cibleOccupants]
  return genres.has('inversion_role') ? occ.reverse() : occ
}

/** Codes du couple historique vendredi_soir → weekend (défaut hérité). */
export const COUPLE_HISTORIQUE = { source: 'vendredi_soir', cible: 'weekend' } as const

/**
 * Placements du VENDREDI lié à un week-end, via les relations (couple historique
 * vendredi_soir → weekend). Défaut → inversion des rôles (R8). Les labels de
 * rôle restent ceux de la source (par défaut = ceux du week-end : premier/second).
 *
 * `null` si non matérialisable (pas de `meme_binome` sur le couple) → aucun
 * vendredi synthétisé (cabinet ayant découplé ses créneaux).
 */
export function placementsVendrediLie(
  weekendPlacements: readonly Placement[],
  relations: readonly RelationStructure[] = RELATIONS_STRUCTURE_DEFAUT,
  sourceRoles?: readonly string[],
): Placement[] | null {
  const occupants = weekendPlacements.map((p) => p.vetId)
  const ordonnes = ordonnerSourceLiee(
    occupants,
    relations,
    COUPLE_HISTORIQUE.source,
    COUPLE_HISTORIQUE.cible,
  )
  if (!ordonnes) return null
  const roles = sourceRoles ?? weekendPlacements.map((p) => p.role)
  return roles.map((role, i) => ({ role, vetId: ordonnes[i] ?? null }))
}

// ============================================================
// reconstruireAttributions — forme VALIDATEUR (PlanningPartiel)
// ============================================================
// Remplace la synthèse EN DUR du vendredi de `gardesVersPlanningPartiel` :
//   - 'weekend' (samedi) → attribution `weekend` (rôles natifs)
//                        + `vendredi_soir` la veille, dérivé via les relations
//   - 'semaine' / 'ferie' → attribution `semaine_soir` (rôles natifs)
//   - autre (sur-mesure P3b) → passthrough géré par l'appelant (options).
//
// PAS de dimanche ici : le validateur raisonne sur l'attribution `weekend` du
// samedi (le dimanche est un artefact d'affichage, pas un slot à valider).

export interface OptionsReconstruction {
  /**
   * Relations résolues (codes) du profil. `undefined` → couple historique
   * (repli byte-identique : ces plannings ont été générés couple câblé).
   * `[]` → aucun couple → le vendredi n'est PAS matérialisé (découplage réel).
   */
  relations?: readonly RelationStructure[]
}

/**
 * Convertit les week-ends V1 en week-end (samedi) + vendredi lié (via relations).
 * Renvoie UNIQUEMENT les attributions issues des week-ends. Les autres types
 * ('semaine'/'ferie'/sur-mesure) restent gérés par l'appelant (gardesVersPlanning)
 * qui garde sa logique de placements sur-mesure inchangée.
 */
export function reconstruireWeekend(
  garde: GardeRowAval,
  options?: OptionsReconstruction,
): AttributionGarde[] {
  const relations = options?.relations ?? RELATIONS_STRUCTURE_DEFAUT
  const weekendPlacements: Placement[] = [
    { role: 'premier', vetId: garde.premier_id },
    { role: 'second', vetId: garde.second_id },
  ]
  const out: AttributionGarde[] = [
    { date: garde.date, type: 'weekend', placements: weekendPlacements },
  ]
  const vendredi = placementsVendrediLie(weekendPlacements, relations)
  if (vendredi) {
    out.push({
      date: moinsJoursAval(garde.date, 1),
      type: 'vendredi_soir',
      placements: vendredi,
    })
  }
  return out
}

// ============================================================
// resoudrePlanningAffichage — GRILLE d'affichage (vue / PDF / agenda)
// ============================================================
// Produit une grille de CELLULES par créneau actif, à partir des gardes V1 :
//   - chaque garde native → une cellule (native)
//   - un week-end → matérialise en plus le VENDREDI lié (via relations) et le
//     DIMANCHE (continuation d'affichage du week-end)
//
// C'est le contrat « Étape 1 » : les 4 avals dérivent de cette grille (ou de son
// kernel). Défaut → grille identique aux 4 synthèses historiques.

export type OrigineCellule = 'native' | 'lie' | 'continuation'

export interface CelluleAffichage {
  /** Id de la garde source (traçabilité) — vide pour un dimanche continuation. */
  gardeId?: string
  date: string
  /** Type/code du créneau porté par la cellule. */
  type: string
  placements: Placement[]
  origine: OrigineCellule
}

export interface OptionsAffichage extends OptionsReconstruction {
  /** Catalogue du profil — sert à dériver la portée multi-jours (dimanche). */
  creneaux?: CreneauModele[]
}

/**
 * Nombre de jours de CONTINUATION d'affichage d'un créneau (jours pleins
 * couverts APRÈS le jour de début), dérivé du catalogue si présent.
 *
 * Règle : un jour d+k (k≥1) est une continuation si le créneau couvre ce jour
 * en ENTIER — c.-à-d. offsetJoursFin > k (le jour de fin partiel, atteint à
 * `heureFin`, n'est pas une journée pleine). Pour le week-end par défaut
 * (offsetJoursFin=2 : sam 08:30 → lun 08:30) → 1 continuation = le DIMANCHE.
 * Pour un soir de semaine (offsetJoursFin=1 : nuit → lendemain matin) → 0.
 *
 * Sans catalogue → repli sur la règle historique en dur : le seul créneau à
 * continuation est `weekend` (+1 jour = dimanche).
 */
function joursContinuation(type: string, creneaux?: CreneauModele[]): number {
  if (creneaux && creneaux.length > 0) {
    const c = creneaux.find((cr) => cr.code === type)
    if (c) return Math.max(0, c.offsetJoursFin - 1)
    return 0
  }
  return type === 'weekend' ? 1 : 0
}

/**
 * Grille d'affichage complète. `relations` défaut → couple historique
 * (byte-identique). Ordre stable : par date puis type puis origine.
 */
export function resoudrePlanningAffichage(
  gardes: readonly GardeRowAval[],
  options?: OptionsAffichage,
): CelluleAffichage[] {
  const relations = options?.relations ?? RELATIONS_STRUCTURE_DEFAUT
  const cellules: CelluleAffichage[] = []

  for (const g of gardes) {
    // Type moteur natif : 'semaine'/'ferie' → semaine_soir ; le reste passe tel quel.
    const typeNatif =
      g.type === 'semaine' || g.type === 'ferie' ? 'semaine_soir' : g.type
    const placementsNatifs: Placement[] = [
      { role: 'premier', vetId: g.premier_id },
      { role: 'second', vetId: g.second_id },
    ]

    // Cellule native (le jour réel de la garde).
    cellules.push({
      gardeId: g.id,
      date: g.date,
      type: typeNatif,
      placements: placementsNatifs,
      origine: 'native',
    })

    if (g.type === 'weekend') {
      // VENDREDI lié (via relations) — matérialisé la veille.
      const vendredi = placementsVendrediLie(placementsNatifs, relations)
      if (vendredi) {
        cellules.push({
          gardeId: g.id,
          date: moinsJoursAval(g.date, 1),
          type: 'vendredi_soir',
          placements: vendredi,
          origine: 'lie',
        })
      }
    }

    // CONTINUATION(S) d'affichage (dimanche pour le week-end) — mêmes rôles.
    const nCont = joursContinuation(typeNatif, options?.creneaux)
    for (let k = 1; k <= nCont; k++) {
      cellules.push({
        gardeId: g.id,
        date: plusJoursAval(g.date, k),
        type: typeNatif,
        placements: placementsNatifs.map((p) => ({ ...p })),
        origine: 'continuation',
      })
    }
  }

  cellules.sort((a, b) =>
    a.date !== b.date
      ? a.date.localeCompare(b.date)
      : a.type !== b.type
        ? a.type.localeCompare(b.type)
        : a.origine.localeCompare(b.origine),
  )
  return cellules
}
