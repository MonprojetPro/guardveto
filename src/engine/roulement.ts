// ============================================================
// GUARDVETO — Roulement ordonné par place (Fondation B)
// ============================================================
// Modèle « par place » (décision MiKL) : chaque PLACE d'une garde
// (type de créneau × rôle 1er/2nd) est soit GÉNÉRÉE (le moteur optimise,
// défaut historique) soit FIGÉE en ROULEMENT (un ordre choisi qui tourne).
//
// Ce module ne porte QUE les types + helpers purs (aucune dépendance DB,
// aucun accès au solver). Le loader vit dans src/data/chargerRoulementCabinet.
// La consommation par le moteur (pré-placer le figé, optimiser le reste) est
// la story B4 — pas encore branchée. Table vide = comportement inchangé.
// ============================================================

import type { TypeGardeEngine, RoleGarde } from './types'

/** Mode de génération d'une place. */
export type ModePlace = 'genere' | 'roulement'

/**
 * Que faire quand le véto dont c'est le tour est en congé (mode roulement) :
 *  - 'saute'       : on passe au suivant, le tour est perdu pour lui.
 *  - 'garde_place' : un autre prend ce créneau, mais l'absent repasse en
 *                    priorité dès qu'il est de nouveau disponible.
 */
export type PolitiqueConge = 'saute' | 'garde_place'

/** Réglage d'une place (type de créneau × rôle) pour un cabinet. */
export interface RoulementPlace {
  code: TypeGardeEngine
  role: RoleGarde
  mode: ModePlace
  politiqueConge: PolitiqueConge
  /** Ordre du roulement (ids vétérinaires). Vide si mode = 'genere'. */
  sequenceVets: string[]
  /** Index de reprise du roulement d'une période à l'autre. */
  positionReprise: number
  actif: boolean
}

/** Config roulement d'un cabinet, indexée par `code:role` (cf. clePlace). */
export type RoulementCabinet = Map<string, RoulementPlace>

/** Clé d'indexation d'une place. */
export function clePlace(code: TypeGardeEngine, role: RoleGarde): string {
  return `${code}:${role}`
}

/**
 * Une place est-elle réellement FIGÉE en roulement ? (active, mode roulement,
 * et au moins un véto dans la séquence). Sinon, le moteur la génère normalement.
 */
export function estPlaceFigee(place: RoulementPlace | undefined): boolean {
  return !!place && place.actif && place.mode === 'roulement' && place.sequenceVets.length > 0
}

/** Réglage d'une place donnée, ou undefined si non configurée (= générée). */
export function placePour(
  roulement: RoulementCabinet | undefined,
  code: TypeGardeEngine,
  role: RoleGarde,
): RoulementPlace | undefined {
  return roulement?.get(clePlace(code, role))
}
