// ============================================================
// GUARDVETO — Contraintes souples (R10)
// ============================================================
// Retourne un score de pénalité numérique (0 = parfait).
// Contrairement aux contraintes dures, une pénalité non nulle
// ne bloque pas l'attribution — elle aide le solver à choisir
// la meilleure solution parmi plusieurs valides.
// ============================================================

import type { SlotGarde, VetEngine, PlanningPartiel } from '../types'
import { samediDeSemaine, addDays } from '../utils'

// ── Scores de pénalité ───────────────────────────────────

export const PENALITE = {
  /** R10 — 2 WE de garde consécutifs (pénalité forte) */
  WE_CONSECUTIF: 50,
} as const

// ── Helpers ──────────────────────────────────────────────

/** Samedi du week-end précédant la date donnée */
function samediPrecedent(dateWE: string): string {
  return addDays(samediDeSemaine(dateWE), -7)
}

/** Vérifie si le véto a une garde WE (vendredi soir ou weekend) le week-end donné */
function aGardeWE(vetId: string, samedi: string, planning: PlanningPartiel): boolean {
  for (const attr of planning.attributions) {
    if (attr.date !== samedi) continue
    if (attr.type !== 'weekend' && attr.type !== 'vendredi_soir') continue
    if (attr.premier_id === vetId || attr.second_id === vetId) return true
  }
  // Vendredi soir est planifié sur la date du vendredi, mais on cherche par samedi
  // Cherchons aussi le vendredi soir associé (vendredi = samedi - 1)
  const vendredi = addDays(samedi, -1)
  for (const attr of planning.attributions) {
    if (attr.date !== vendredi) continue
    if (attr.type !== 'vendredi_soir') continue
    if (attr.premier_id === vetId || attr.second_id === vetId) return true
  }
  return false
}

// ── Contraintes souples individuelles ────────────────────

/**
 * R10 — Pas 2 WE de garde de suite
 * Si le véto a déjà une garde WE le week-end précédent → pénalité forte.
 */
function penaliteR10WEConsecutif(
  slot: SlotGarde,
  vet: VetEngine,
  planning: PlanningPartiel
): number {
  if (slot.type !== 'weekend' && slot.type !== 'vendredi_soir') return 0

  const samCourant = slot.type === 'weekend'
    ? slot.date
    : addDays(slot.date, 1) // vendredi soir → samedi associé

  const samPrec = samediPrecedent(samCourant)
  if (aGardeWE(vet.id, samPrec, planning)) {
    return PENALITE.WE_CONSECUTIF
  }
  return 0
}

// ── Point d'entrée ───────────────────────────────────────

/**
 * penalite — Score de pénalité souple pour une attribution candidate.
 *
 * @param slot      Le créneau candidat
 * @param vet       Le vétérinaire candidat
 * @param planning  Le planning partiellement construit
 * @returns         Score ≥ 0 (0 = aucune pénalité souple)
 */
export function penalite(
  slot: SlotGarde,
  vet: VetEngine,
  planning: PlanningPartiel
): number {
  return penaliteR10WEConsecutif(slot, vet, planning)
}

// Export individuel pour les tests
export { penaliteR10WEConsecutif }
