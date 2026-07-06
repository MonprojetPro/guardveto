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
//
// P6 (verrou n°3) — GÉNÉRIQUE : la synthèse du vendredi ne code plus l'inversion
// R8 EN DUR. Elle est déléguée à `reconstruireWeekend` (aval générique), qui
// APPLIQUE les relations (`meme_binome`/`inversion_role`). Défaut (couple
// historique) → sortie byte-identique. Passer `relations` pour piloter (un
// cabinet qui coupe l'inversion voit alors le vendredi non inversé).
// ============================================================

import type { PlanningPartiel, AttributionGarde } from '../types'
import type { RelationStructure } from '../structure-config'
import { reconstruireWeekend } from '../aval/resoudrePlanningAffichage'

export interface GardeRow {
  /** Id de la garde — sert à retrouver ses placements miroir (P3b). Optionnel. */
  id?: string
  date: string
  /** Type V1 ('semaine'/'weekend'/'ferie') ou code sur-mesure (P3b). */
  type: string
  premier_id: string | null
  second_id: string | null
}

/** Une place du miroir `garde_placements` (P3b-1). */
export interface PlacementRow {
  garde_id: string
  place_index: number
  role: string
  veterinaire_id: string | null
}

/** Options de reconstruction pour les types SUR-MESURE (P3b). */
export interface OptionsSurMesure {
  /** Rôles du catalogue par code (creneau_modele) — labels attendus par la couverture. */
  rolesParCode?: Record<string, string[]>
  /** Placements miroir par garde_id — restaure les places au-delà des 2 colonnes V1. */
  placementsParGarde?: Record<string, PlacementRow[]>
  /**
   * Relations résolues (codes) du profil, pour PILOTER la synthèse du vendredi
   * (P6 verrou n°3). `undefined` → couple historique (repli byte-identique) ;
   * `[]` → aucun couple → le vendredi n'est pas matérialisé (découplage réel).
   */
  relations?: readonly RelationStructure[]
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
export function gardesVersPlanningPartiel(
  gardes: GardeRow[],
  options?: OptionsSurMesure,
): PlanningPartiel {
  const attributions: AttributionGarde[] = []

  for (const g of gardes) {
    if (g.type === 'weekend') {
      // Week-end (samedi natif) + vendredi lié — dérivation GÉNÉRIQUE (P6) :
      // l'inversion R8 n'est plus câblée, elle vient des relations. Défaut →
      // vendredi inversé, byte-identique à l'ancienne synthèse de la vue 014.
      attributions.push(
        ...reconstruireWeekend(g, { relations: options?.relations }),
      )
    } else if (g.type === 'semaine' || g.type === 'ferie') {
      // 'semaine' et 'ferie' (férié en semaine) → garde de nuit en semaine.
      attributions.push({
        date: g.date,
        type: 'semaine_soir',
        placements: [
          { role: 'premier', vetId: g.premier_id },
          { role: 'second', vetId: g.second_id },
        ],
      })
    } else {
      // Type SUR-MESURE (P3b) : le code EST le type moteur — passthrough.
      // (L'aplatir en 'semaine_soir' créait des collisions de (date, type) et
      // des violations fantômes au gate de publication.)
      // Placements : d'abord le MIROIR garde_placements (labels réels + places
      // au-delà des 2 colonnes V1) ; sinon reconstruction POSITIONNELLE avec
      // les rôles du catalogue (place 0 → premier_id, place 1 → second_id).
      const miroir = g.id ? options?.placementsParGarde?.[g.id] : undefined
      let placements: AttributionGarde['placements']
      if (miroir && miroir.length > 0) {
        placements = [...miroir]
          .sort((a, b) => a.place_index - b.place_index)
          .map((p) => ({ role: p.role, vetId: p.veterinaire_id }))
      } else {
        const roles = options?.rolesParCode?.[g.type] ?? ['premier', 'second']
        placements = roles.map((role, i) => ({
          role,
          vetId: i === 0 ? g.premier_id : i === 1 ? g.second_id : null,
        }))
      }
      attributions.push({ date: g.date, type: g.type, placements })
    }
  }

  return { attributions }
}
