// ============================================================
// GUARDVETO — Contraintes souples (R10, R10b, R8b)
// ============================================================
// Retourne un score de pénalité numérique (0 = parfait).
// Contrairement aux contraintes dures, une pénalité non nulle
// ne bloque pas l'attribution — elle aide le solver à choisir
// la meilleure solution parmi plusieurs valides.
// ============================================================

import type { SlotGarde, VetEngine, PlanningPartiel, RoleGarde } from '../types'
import { samediDeSemaine, addDays, estJourFerie, estFeteFinAnnee } from '../utils'

// ── Scores de pénalité ───────────────────────────────────

export const PENALITE = {
  /** R10 — 2 WE de garde consécutifs (pénalité forte) */
  WE_CONSECUTIF: 50,
  /** R10c — Garde le week-end qui précède immédiatement des vacances du véto */
  WE_AVANT_VACANCES: 45,
  /** R10b — Garde un soir de réveillon (24 déc ou 31 déc) — à éviter si possible */
  FETE_FIN_ANNEE: 30,
  /** R8b — Même rôle (1er/2nd) la veille d'un jour férié — inversion "si possible" (§7) */
  INVERSION_FERIE: 20,
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

/**
 * R10c — Pas de garde le week-end qui précède des vacances (« au maximum du possible »).
 * Si le véto part en vacances la semaine qui suit immédiatement ce week-end
 * (congé de type 'vacances' débutant du lundi au vendredi suivant), on pénalise
 * fortement le fait de le mettre de garde ce week-end-là — pour qu'il parte reposé.
 * Le congé lui-même reste géré en dur par R16 (aucune garde pendant le congé).
 */
function penaliteWEAvantVacances(
  slot: SlotGarde,
  vet: VetEngine,
  planning: PlanningPartiel
): number {
  void planning
  if (slot.type !== 'weekend' && slot.type !== 'vendredi_soir') return 0

  // Samedi de référence du week-end concerné
  const sam = slot.type === 'weekend' ? slot.date : addDays(slot.date, 1)
  // Fenêtre « semaine suivante » : du lundi (sam+2) au vendredi (sam+6)
  const lundiSuivant = addDays(sam, 2)
  const vendrediSuivant = addDays(sam, 6)

  for (const conge of vet.conges) {
    if (conge.type !== 'vacances') continue
    if (conge.date_debut >= lundiSuivant && conge.date_debut <= vendrediSuivant) {
      return PENALITE.WE_AVANT_VACANCES
    }
  }
  return 0
}

/**
 * R10b — Pénalité pour les veilles de fête (24 déc, 31 déc)
 * On essaie de dégager des repos autour de Noël et du Jour de l'An (§6).
 * Seules les veilles (soirs "normaux") sont pénalisées — Dec 25 et Jan 1
 * sont déjà des fériés gérés par le système d'équité.
 */
function penaliteFeteFinAnnee(slot: SlotGarde): number {
  if (slot.type !== 'semaine_soir') return 0
  const mmjj = slot.date.substring(5)
  if (mmjj === '12-24' || mmjj === '12-31') {
    return PENALITE.FETE_FIN_ANNEE
  }
  return 0
}

/**
 * R8b — Inversion 1er/2nd sur jours fériés "si possible" (§7)
 * Pour une garde sur un jour férié en semaine, si le véto avait un rôle
 * la nuit précédente → pénalité pour qu'il prenne le rôle inverse.
 * Analogue à R8 (vendredi/WE) mais en contrainte souple car "si possible".
 */
function penaliteInversionFerie(
  slot: SlotGarde,
  vet: VetEngine,
  role: RoleGarde,
  planning: PlanningPartiel
): number {
  if (slot.type !== 'semaine_soir') return 0
  if (!estJourFerie(slot.date)) return 0

  // Garde du soir précédent (la nuit avant le jour férié)
  const veille = addDays(slot.date, -1)
  const attrVeille = planning.attributions.find(
    (a) => a.date === veille && (a.type === 'semaine_soir' || a.type === 'vendredi_soir')
  )
  if (!attrVeille) return 0

  const etait1er = attrVeille.premier_id === vet.id
  const etait2nd = attrVeille.second_id === vet.id

  // Pénalité si même rôle que la veille (devrait s'inverser)
  if (etait1er && role === 'premier') return PENALITE.INVERSION_FERIE
  if (etait2nd && role === 'second') return PENALITE.INVERSION_FERIE

  return 0
}

// ── Point d'entrée ───────────────────────────────────────

/**
 * penalite — Score de pénalité souple pour une attribution candidate.
 *
 * @param slot      Le créneau candidat
 * @param vet       Le vétérinaire candidat
 * @param role      Le rôle visé (premier ou second)
 * @param planning  Le planning partiellement construit
 * @returns         Score ≥ 0 (0 = aucune pénalité souple)
 */
export function penalite(
  slot: SlotGarde,
  vet: VetEngine,
  role: RoleGarde,
  planning: PlanningPartiel
): number {
  return (
    penaliteR10WEConsecutif(slot, vet, planning) +
    penaliteWEAvantVacances(slot, vet, planning) +
    penaliteFeteFinAnnee(slot) +
    penaliteInversionFerie(slot, vet, role, planning)
  )
}

// Export individuel pour les tests
export {
  penaliteR10WEConsecutif,
  penaliteWEAvantVacances,
  penaliteFeteFinAnnee,
  penaliteInversionFerie,
}
