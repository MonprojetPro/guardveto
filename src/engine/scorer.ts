// ============================================================
// GUARDVETO — Scorer : agrégation des scores d'équité
// ============================================================
// scoreEquite() combine toutes les dimensions d'optimisation
// en un score global. Score plus bas = planning plus équitable.
// Le solver minimise ce score parmi les solutions valides.
// ============================================================

import type { PlanningPartiel, VetEngine } from './types'
import {
  compterParVet,
  desequilibreWE,
  desequilibreWeekendPremier,
  desequilibreFeries,
  desequilibreSemainePremier,
  desequilibreSemaineSecond,
  desequilibreGrandsWeSalaries,
  type CompteurVet,
} from './rules/optimization'

// ── Poids de chaque critère d'optimisation ───────────────
// Ces constantes sont configurables pour ajuster les priorités.

export const POIDS = {
  /** R11 — Équité WE de garde (priorité absolue) */
  WE_GARDE: 100,
  /** R11b — Équité du rôle 1er le week-end (avantage financier) — tie-breaker
   *  secondaire : n'intervient qu'à égalité de nombre total de week-ends, pour
   *  ne pas dégrader la priorité absolue R11. */
  WE_PREMIER_ROLE: 25,
  /** R12 — Équité jours fériés (poids fort) */
  FERIES: 60,
  /** R13 — Équité gardes semaine en 1er (poids moyen) */
  SEMAINE_PREMIER: 30,
  /** R14 — Équité 2nd de garde (poids faible) */
  SEMAINE_SECOND: 10,
  /** R15 — Équité grands WE salariés (poids fort) */
  GRANDS_WE_SALARIES: 60,
  /** R20 — Bonus/malus inter-périodes (poids fort) */
  BONUS_MALUS: 80,
} as const

// ── Types ────────────────────────────────────────────────

/**
 * Bonus/malus inter-périodes par vétérinaire.
 * - Valeur positive : le véto doit faire PLUS de gardes cette période
 *   (il en a fait moins que sa quote-part la période précédente).
 * - Valeur négative : le véto doit faire MOINS de gardes cette période
 *   (il en a fait plus que sa quote-part — il a du crédit).
 */
export interface BonusMalusMap {
  [vetId: string]: number
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Variance pondérée par les bonus/malus.
 * Ajuste les compteurs de WE pour tenir compte du déséquilibre inter-périodes.
 */
function desequilibreWEAjuste(compteurs: CompteurVet[], bonusMalus: BonusMalusMap): number {
  const valeursAjustees = compteurs.map((c) => {
    const bm = bonusMalus[c.vetId] ?? 0
    // Soustrait le bonus/malus pour obtenir la "position relative" du véto
    // Si bm > 0 (doit faire plus), son nombre effectif de gardes est réduit artificiellement
    // → le score l'incite à faire plus de gardes cette période
    return c.weGardes - bm
  })

  if (valeursAjustees.length === 0) return 0
  const moy = valeursAjustees.reduce((s, v) => s + v, 0) / valeursAjustees.length
  return valeursAjustees.reduce((s, v) => s + (v - moy) ** 2, 0) / valeursAjustees.length
}

// ── Score global ─────────────────────────────────────────

/**
 * scoreEquite — Calcule le score d'équité global d'un planning.
 *
 * Un score plus bas signifie un planning plus équitable.
 * Le solver doit minimiser ce score parmi les solutions valides.
 *
 * @param planning    Le planning (partiel ou complet) à évaluer
 * @param bonusMalus  Bonus/malus inter-périodes (R20) — passer {} si aucun
 * @param vets        Liste de tous les vétérinaires
 * @returns           Score ≥ 0 (0 = équité parfaite)
 */
export function scoreEquite(
  planning: PlanningPartiel,
  bonusMalus: BonusMalusMap,
  vets: VetEngine[]
): number {
  const compteurs = compterParVet(planning, vets)

  // R20 : déséquilibre WE ajusté par les bonus/malus inter-périodes
  const scoreR20 = desequilibreWEAjuste(compteurs, bonusMalus) * POIDS.BONUS_MALUS

  // R11 : déséquilibre WE brut (sur le planning courant uniquement)
  const scoreR11 = desequilibreWE(compteurs) * POIDS.WE_GARDE

  // R11b : déséquilibre du rôle 1er le week-end (avantage financier)
  const scoreR11b = desequilibreWeekendPremier(compteurs) * POIDS.WE_PREMIER_ROLE

  // R12 : déséquilibre fériés
  const scoreR12 = desequilibreFeries(compteurs) * POIDS.FERIES

  // R13 : déséquilibre gardes semaine en 1er
  const scoreR13 = desequilibreSemainePremier(compteurs) * POIDS.SEMAINE_PREMIER

  // R14 : déséquilibre gardes semaine en 2nd
  const scoreR14 = desequilibreSemaineSecond(compteurs) * POIDS.SEMAINE_SECOND

  // R15 : déséquilibre grands WE perdus (salariés uniquement)
  const scoreR15 = desequilibreGrandsWeSalaries(compteurs, vets) * POIDS.GRANDS_WE_SALARIES

  return scoreR11 + scoreR11b + scoreR12 + scoreR13 + scoreR14 + scoreR15 + scoreR20
}

// ── Export des poids et compteurs pour les tests ─────────
export { compterParVet }
export type { CompteurVet }
