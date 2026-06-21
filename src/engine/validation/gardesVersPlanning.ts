// ============================================================
// GUARDVETO — Reconstruction gardes (V1) → PlanningPartiel (Chantier B)
// ============================================================
// Transform PUR (zéro dépendance Supabase/Next) : convertit les gardes
// publiées de la table `gardes` (V1) en PlanningPartiel tel que l'attend le
// validateur indépendant `validerPlanning`.
//
// Pourquoi non trivial : `gardes` ne connaît que 'semaine' | 'weekend' |
// 'ferie'. Le créneau `vendredi_soir` n'y existe PAS — le vendredi soir est
// porté par la garde de week-end (samedi). La vue d'affichage `planning_semaine`
// (migration 014) synthétise donc le vendredi à partir du week-end AVEC LES
// RÔLES INVERSÉS (règle R8 : le 1er du WE est 2nd le vendredi, et inversement).
//
// On reproduit ICI exactement cette synthèse, pour que le validateur voie la
// composition RÉELLE du vendredi. Sans ça, il lèverait une fausse violation R8
// (ou un vendredi « non couvert ») à chaque week-end.
// ============================================================

import type { PlanningPartiel, AttributionGarde } from '../types'

export interface GardeRow {
  date: string
  type: 'semaine' | 'weekend' | 'ferie'
  premier_id: string | null
  second_id: string | null
}

/** Recule une date ISO yyyy-mm-dd de `n` jours (UTC, pur). */
export function moinsJours(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Convertit les gardes publiées en PlanningPartiel (forme validateur).
 * Miroir EXACT de la vue `planning_semaine` (migration 014) :
 *   - 'semaine' / 'ferie' → attribution `semaine_soir` (rôles natifs)
 *   - 'weekend' (samedi)  → attribution `weekend` (rôles natifs)
 *                         + attribution `vendredi_soir` la veille, rôles INVERSÉS
 */
export function gardesVersPlanningPartiel(gardes: GardeRow[]): PlanningPartiel {
  const attributions: AttributionGarde[] = []

  for (const g of gardes) {
    if (g.type === 'weekend') {
      attributions.push({
        date: g.date,
        type: 'weekend',
        premier_id: g.premier_id,
        second_id: g.second_id,
      })
      // Vendredi soir = veille, rôles inversés (cf. vue 014).
      attributions.push({
        date: moinsJours(g.date, 1),
        type: 'vendredi_soir',
        premier_id: g.second_id, // 2nd du WE → 1er le vendredi
        second_id: g.premier_id, // 1er du WE → 2nd le vendredi
      })
    } else {
      // 'semaine' et 'ferie' (férié en semaine) → garde de nuit en semaine.
      attributions.push({
        date: g.date,
        type: 'semaine_soir',
        premier_id: g.premier_id,
        second_id: g.second_id,
      })
    }
  }

  return { attributions }
}
