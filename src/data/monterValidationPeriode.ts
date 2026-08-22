// ============================================================
// GUARDVETO — Montage PARTAGÉ « période → entrée du validateur »
// ============================================================
// Deux appelants ont besoin d'exactement la même chose : recharger l'état réel
// d'une période publiée et le remettre dans la forme qu'attend `validerPlanning`.
//
//   • `revaliderPlanning.ts`  — re-valide en continu ce qui EST écrit ;
//   • `PATCH /api/gardes/[id]` — confronte aux règles ce qui VA être écrit.
//
// POURQUOI CE FICHIER EXISTE
//
// Le lot 1 est né d'un manque de gardien sur le chemin manuel. La tentation
// évidente — écrire un contrôle « léger » dans la route — aurait produit un
// TROISIÈME gardien, qui aurait dérivé des deux autres exactement comme le
// solver et le validateur ont fini par diverger. On ne réimplémente donc rien :
// on extrait le MONTAGE (le chargement + la reconstruction), et le contrôle
// lui-même reste `validerPlanning`, un seul et unique juge.
//
// Le montage est délicat pour trois raisons qu'il ne faut pas re-découvrir :
//   ① `gardes` ne connaît pas `vendredi_soir` — il est SYNTHÉTISÉ depuis le
//      week-end, rôles inversés, via `gardesVersPlanningPartiel` ;
//   ② les créneaux SUR-MESURE portent leurs places dans `garde_placements`,
//      pas dans les deux colonnes V1 ;
//   ③ le lookback inter-périodes (#17) vient de `resoudreContexte` : sans lui,
//      les règles de rythme sont aveugles à la jonction de deux périodes.
//
// ACCÈS : ce module ne contrôle NI l'auth NI le rôle. L'appelant doit avoir
// validé « admin + ce cabinet » avant (comme `appliquerChangementGarde`).
// ============================================================

import { resoudreContexte } from '@/data/resoudreContexte'
import type { ValidationInput } from '@/engine/validation/validerPlanning'
import {
  gardesVersPlanningPartiel,
  type GardeRow,
  type PlacementRow,
} from '@/engine/validation/gardesVersPlanning'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanningPartiel } from '@/engine/types'

export interface MontageValidation {
  /** Les gardes RÉELLEMENT écrites en base pour cette période. */
  gardes: GardeRow[]
  /** Entrée du validateur (contexte, calendrier, structure, lookback #17). */
  input: ValidationInput
  /**
   * Reconstruit un PlanningPartiel à partir d'un jeu de gardes — celui qu'on
   * vient de lire, ou une VARIANTE (changement simulé avant écriture).
   *
   * `gardesSansMiroir` : ids des gardes dont le miroir `garde_placements` ne
   * décrit plus la réalité (typiquement celle qu'on est en train de modifier).
   * Pour celles-là on retombe sur la reconstruction positionnelle depuis
   * premier_id/second_id — sinon la simulation validerait l'ANCIENNE paire.
   */
  construirePlanning: (
    gardes: GardeRow[],
    gardesSansMiroir?: readonly string[],
  ) => PlanningPartiel
}

/**
 * Charge tout ce qu'il faut pour juger une période, et rend de quoi reconstruire
 * son planning. `null` = période introuvable, inaccessible, ou sans garde (rien
 * à juger) — l'appelant décide s'il continue en silence ou s'il s'arrête.
 */
export async function monterValidationPeriode(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
): Promise<MontageValidation | null> {
  // 1. Contexte (vets + contraintes + congés + calendrier + structure + effectif).
  //    autoriserVerrouille : une période publiée peut aussi être verrouillée.
  let ctx
  try {
    ctx = await resoudreContexte(periodeId, cabinetId, { autoriserVerrouille: true })
  } catch {
    return null
  }

  // 2. Gardes de la période (source de vérité V1 — celle que voient les écrans).
  const { data: gardesDb, error } = await supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id')
    .eq('periode_id', periodeId)
    .eq('cabinet_id', cabinetId)
  if (error || !gardesDb || gardesDb.length === 0) return null
  const gardes = gardesDb as GardeRow[]

  // 3. Reconstruction SUR-MESURE (P3b) : rôles du catalogue + miroir
  //    garde_placements (les colonnes V1 ne portent que 2 places, et des labels
  //    premier/second — la couverture attend les rôles réels).
  const rolesParCode: Record<string, string[]> = {}
  for (const c of ctx.creneaux ?? []) {
    if (c.code) rolesParCode[c.code] = c.roles
  }
  const typesV1 = new Set(['semaine', 'weekend', 'ferie'])
  const idsSurMesure = gardes
    .filter((g) => !typesV1.has(g.type))
    .map((g) => g.id)
    .filter((id): id is string => Boolean(id))

  const placementsParGarde: Record<string, PlacementRow[]> = {}
  if (idsSurMesure.length > 0) {
    const { data: placs } = await supabase
      .from('garde_placements')
      .select('garde_id, place_index, role, veterinaire_id')
      .in('garde_id', idsSurMesure)
    for (const p of ((placs ?? []) as PlacementRow[])) {
      (placementsParGarde[p.garde_id] ??= []).push(p)
    }
  }

  const construirePlanning = (
    jeu: GardeRow[],
    gardesSansMiroir?: readonly string[],
  ): PlanningPartiel => {
    let miroir = placementsParGarde
    if (gardesSansMiroir && gardesSansMiroir.length > 0) {
      miroir = { ...placementsParGarde }
      for (const id of gardesSansMiroir) delete miroir[id]
    }
    return gardesVersPlanningPartiel(jeu, {
      rolesParCode,
      placementsParGarde: miroir,
      // P6 (verrou n°3) : la synthèse du vendredi APPLIQUE les MÊMES relations
      // que le validateur — sinon reconstruction et contrôle divergeraient pour
      // un cabinet qui pilote ses relations. undefined → couple historique.
      relations: ctx.structureConfig?.relations,
    })
  }

  const input: ValidationInput = {
    dateDebut: ctx.dateDebut,
    dateFin: ctx.dateFin,
    saison: ctx.saison,
    vets: ctx.vets,
    calendrier: ctx.calendrier,
    nbVetosSemaineSoir: ctx.nbVetosSemaineSoir,
    structureConfig: ctx.structureConfig,
    // Catalogue-aware (P0) : MÊME source que le moteur.
    creneaux: ctx.creneaux,
    // #17 — MÊME lookback inter-périodes que le solver a vu à la génération.
    contexteAnterieur: ctx.contexteAnterieur,
  }

  return { gardes, input, construirePlanning }
}
