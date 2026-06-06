// ============================================================
// GUARDVETO — Règles d'optimisation (R11–R15, R20)
// ============================================================
// Ce module collecte les compteurs par vétérinaire et expose
// des fonctions de mesure d'équité pour chaque dimension.
// ============================================================

import type { PlanningPartiel, VetEngine, AttributionGarde } from '../types'
import { estJourFerie } from '../utils'

// ── Types ────────────────────────────────────────────────

/** Compteurs d'activité d'un vétérinaire sur un planning donné */
export interface CompteurVet {
  vetId: string
  /** R11 — Nombre de week-ends de garde (type 'weekend') */
  weGardes: number
  /** R11b — Nombre de week-ends en qualité de 1er (avantage financier — à équilibrer) */
  weekendPremier: number
  /** R12 — Nombre de gardes sur jours fériés */
  feriesGardes: number
  /** R13 — Nombre de gardes de semaine en qualité de 1er */
  semainePremier: number
  /** R14 — Nombre de gardes de semaine en qualité de 2nd */
  semaineSecond: number
  /**
   * R15 — Pour les salariés : nombre de WE où ils étaient de garde
   * (= WE "perdus" sans grand week-end libre).
   * Non pertinent pour les associés.
   */
  grandsWePerdus: number
}

// ── Helpers internes ─────────────────────────────────────

function estWEGarde(attr: AttributionGarde, vetId: string): boolean {
  return attr.type === 'weekend' && (attr.premier_id === vetId || attr.second_id === vetId)
}

function estFerieGarde(attr: AttributionGarde, vetId: string): boolean {
  return estJourFerie(attr.date) && (attr.premier_id === vetId || attr.second_id === vetId)
}

function estSemainePremier(attr: AttributionGarde, vetId: string): boolean {
  return (attr.type === 'semaine_soir' || attr.type === 'vendredi_soir') &&
    attr.premier_id === vetId
}

function estSemaineSecond(attr: AttributionGarde, vetId: string): boolean {
  return (attr.type === 'semaine_soir' || attr.type === 'vendredi_soir') &&
    attr.second_id === vetId
}

// ── Compteurs ────────────────────────────────────────────

/**
 * compterParVet — Calcule les compteurs de chaque dimension d'équité
 * pour tous les vétérinaires sur le planning donné.
 *
 * @param planning  Planning (partiel ou complet)
 * @param vets      Liste de tous les vétérinaires
 */
export function compterParVet(
  planning: PlanningPartiel,
  vets: VetEngine[]
): CompteurVet[] {
  return vets.map((vet) => {
    const compteur: CompteurVet = {
      vetId: vet.id,
      weGardes: 0,
      weekendPremier: 0,
      feriesGardes: 0,
      semainePremier: 0,
      semaineSecond: 0,
      grandsWePerdus: 0,
    }

    for (const attr of planning.attributions) {
      if (estWEGarde(attr, vet.id)) {
        compteur.weGardes++
        // R15 : pour les salariés, un WE de garde = grand WE "perdu"
        if (vet.statut === 'salarie') compteur.grandsWePerdus++
      }
      // R11b : être 1er le week-end (rôle à avantage financier)
      if (attr.type === 'weekend' && attr.premier_id === vet.id) {
        compteur.weekendPremier++
      }
      if (estFerieGarde(attr, vet.id)) compteur.feriesGardes++
      if (estSemainePremier(attr, vet.id)) compteur.semainePremier++
      if (estSemaineSecond(attr, vet.id)) compteur.semaineSecond++
    }

    return compteur
  })
}

// ── Mesures d'équité ─────────────────────────────────────

/**
 * Variance d'une liste de valeurs — mesure de déséquilibre.
 * Plus la variance est haute, plus les vétérinaires sont inégaux.
 */
export function variance(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  const moy = valeurs.reduce((s, v) => s + v, 0) / valeurs.length
  return valeurs.reduce((s, v) => s + (v - moy) ** 2, 0) / valeurs.length
}

/**
 * Écart max–min d'une liste de valeurs — mesure simple de déséquilibre.
 */
export function ecartMaxMin(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  return Math.max(...valeurs) - Math.min(...valeurs)
}

/**
 * R11 — Déséquilibre des WE de garde (tous vétos)
 * Retourne la variance du nombre de WE par vétérinaire.
 */
export function desequilibreWE(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.weGardes))
}

/**
 * R11b — Déséquilibre du rôle 1er le week-end (avantage financier).
 * On cherche à ce que chacun ait, autant que possible, le même nombre de
 * week-ends en tant que 1er (et pas seulement le même nombre total de WE).
 */
export function desequilibreWeekendPremier(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.weekendPremier))
}

/**
 * R12 — Déséquilibre des gardes sur fériés
 */
export function desequilibreFeries(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.feriesGardes))
}

/**
 * R13 — Déséquilibre des gardes de semaine en 1er
 */
export function desequilibreSemainePremier(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.semainePremier))
}

/**
 * R14 — Déséquilibre des gardes de semaine en 2nd
 */
export function desequilibreSemaineSecond(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.semaineSecond))
}

/**
 * R15 — Déséquilibre des grands WE perdus (salariés uniquement)
 */
export function desequilibreGrandsWeSalaries(compteurs: CompteurVet[], vets: VetEngine[]): number {
  const salaries = compteurs.filter((c) => {
    const vet = vets.find((v) => v.id === c.vetId)
    return vet?.statut === 'salarie'
  })
  if (salaries.length === 0) return 0
  return variance(salaries.map((c) => c.grandsWePerdus))
}
