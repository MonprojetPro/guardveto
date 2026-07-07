// ============================================================
// GUARDVETO — Synchro `attributions` (V2) après toute mutation V1
// ============================================================
// (P6 — verrou n°7, étape 3 : rendre `attributions` V2 fiable et lisible)
//
// LE PROBLÈME RÉSOLU. Après la génération (persisterResultat), PLUS RIEN ne
// mettait V2 à jour : l'édition manuelle, la réparation de crise, le dépannage
// volontaire et les échanges de gardes n'écrivaient QUE `gardes` (V1) +
// `garde_placements`. V2 divergeait à la première édition → données fausses
// garanties au futur cutover V1 → V2.
//
// LA SOLUTION. UN helper unique, appelé par TOUS les chemins de mutation
// (tous convergent déjà vers `appliquerChangementGarde`) : il RE-SYNCHRONISE
// les lignes `attributions` des JOURS impactés à partir de la V1 — source de
// vérité actuelle — via la MÊME reconstruction que la re-validation
// (`gardesVersPlanningPartiel`) et le MÊME constructeur de lignes que la
// génération (`construireLignesAttributions`). Par construction, ce que V2
// reçoit = ce que le validateur et les écrans voient.
//
// MAPPING V1 → V2 (rappel) :
//   - V1 stocke le week-end sur le SAMEDI et n'a PAS de ligne vendredi ;
//     V2 a le `vendredi_soir` EXPLICITE. Quand l'équipe d'un week-end change,
//     les lignes V2 du vendredi lié SUIVENT (relations du profil appliquées,
//     défaut = inversion R8 — même dérivation que `resoudrePlanningAffichage`).
//   - V1 'ferie'/'semaine' → moteur 'semaine_soir' (le moteur n'émet jamais de
//     slot 'ferie' : reclassification purement V1).
//   - Types sur-mesure : placements relus du miroir `garde_placements`.
//
// STRATÉGIE D'ÉCRITURE : resynchro PAR JOUR (delete fenêtre-jour + insert) —
// idempotente, insensible aux horodatages historiques (un changement d'horaires
// de profil postérieur à la génération ne laisse pas de lignes fantômes).
//
// BEST-EFFORT : ne lève JAMAIS (comme le miroir garde_placements P3b-2) —
// la V1 reste la source de vérité, un échec de synchro V2 ne doit pas casser
// le cycle d'édition. L'échec est retourné à l'appelant (qui signale un
// incident in-app) ET rattrapé par le détecteur de dérive V1↔V2 branché dans
// `revaliderPlanning` (contrôle continu en prod).
//
// RLS : écrit `attributions` (policy attributions_admin_write, F5-003) — tous
// les chemins appelants sont soit une session ADMIN (édition, crise, échanges),
// soit un client SERVICE_ROLE (dépannage volontaire) → écriture autorisée.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  construireLignesPourJours,
  toUTCString,
  addDaysISO,
  type ContexteLignesAttributions,
} from '@/data/attributionRows'
import { chargerStructureProfil } from '@/data/chargerStructureCabinet'
import {
  chargerCreneauModele,
  chargerRelationsCreneau,
} from '@/data/chargerCreneauModele'
import { resoudreRelationsStructure } from '@/engine/relations-structure'
import type { RelationStructure } from '@/engine/structure-config'
import type { GardeRow, PlacementRow } from '@/engine/validation/gardesVersPlanning'

// ── Résultat structuré (l'appelant décide de signaler ou non) ──

export interface SyncAttributionsResultat {
  ok: boolean
  /** Nombre de lignes V2 réécrites (0 si échec ou aucun jour). */
  nbLignes: number
  /** Message d'erreur si !ok. */
  erreur?: string
}

// ── Jours impactés par la mutation d'une garde ───────────────

/**
 * Jours calendaires dont les lignes V2 doivent être resynchronisées quand la
 * garde (date, type) change. Un week-end (samedi V1) emporte AUSSI la veille :
 * le `vendredi_soir` V2 explicite est DÉRIVÉ de l'équipe du week-end.
 */
export function joursImpactesGarde(date: string, type: string): string[] {
  return type === 'weekend' ? [addDaysISO(date, -1), date] : [date]
}

// ── Synchro par garde (point d'entrée des writers) ───────────

/**
 * syncAttributionsPourGarde — resynchronise les lignes `attributions` (V2)
 * impactées par la mutation d'UNE garde V1. À appeler APRÈS l'écriture V1
 * (gardes + garde_placements). Ne lève jamais.
 */
export async function syncAttributionsPourGarde(
  supabase: SupabaseClient,
  gardeId: string,
): Promise<SyncAttributionsResultat> {
  try {
    const { data: garde, error } = await supabase
      .from('gardes')
      .select('id, date, type, periode_id, cabinet_id')
      .eq('id', gardeId)
      .single()

    if (error || !garde) {
      return { ok: false, nbLignes: 0, erreur: `garde introuvable (${error?.message ?? gardeId})` }
    }

    const g = garde as { date: string; type: string; periode_id: string; cabinet_id: string | null }
    if (!g.cabinet_id) {
      // Donnée legacy hors-tenant : pas de V2 possible (cabinet_id NOT NULL côté attributions).
      return { ok: false, nbLignes: 0, erreur: 'garde sans cabinet_id (legacy) — synchro V2 impossible' }
    }

    return await syncAttributionsPourJours(
      supabase,
      g.periode_id,
      g.cabinet_id,
      joursImpactesGarde(g.date, g.type),
    )
  } catch (e) {
    return { ok: false, nbLignes: 0, erreur: e instanceof Error ? e.message : String(e) }
  }
}

// ── Synchro par jours (cœur — utilisée aussi à la régénération) ──

/**
 * syncAttributionsPourJours — réécrit les lignes `attributions` des jours
 * donnés à partir de l'état V1 COURANT de la période. Idempotente.
 *
 * Utilisée par :
 *   - syncAttributionsPourGarde (toute mutation d'une garde) ;
 *   - la régénération (gardes VERROUILLÉES préservées en V1 mais écrasées en
 *     V2 par persisterResultat : on réaligne V2 sur les verrous conservés).
 */
export async function syncAttributionsPourJours(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
  jours: readonly string[],
): Promise<SyncAttributionsResultat> {
  try {
    const joursUniques = [...new Set(jours)].sort()
    if (joursUniques.length === 0) return { ok: true, nbLignes: 0 }

    // 1. Période → profil + snapshot lié (traçabilité conservée sur les lignes réécrites).
    const { data: per, error: perErr } = await supabase
      .from('periodes')
      .select('cabinet_id, profil_id, snapshot_id')
      .eq('id', periodeId)
      .single()

    if (perErr || !per) {
      return { ok: false, nbLignes: 0, erreur: `période introuvable (${perErr?.message ?? periodeId})` }
    }
    const periode = per as { cabinet_id: string | null; profil_id: string | null; snapshot_id: string | null }

    // 2. Contexte de conversion — MÊMES sources que la génération :
    //    horaires du profil (chargerStructureProfil), catalogue V2
    //    (creneaux_catalogue) pour creneau_id, catalogue du profil
    //    (creneau_modele) pour les rôles sur-mesure + gating des relations.
    const profilId = periode.profil_id ?? undefined
    const structure = await chargerStructureProfil(supabase, cabinetId, profilId)

    const creneauxProfil = await chargerCreneauModele(supabase, cabinetId, profilId)
    // Gating IDENTIQUE au loader moteur + à l'aval d'affichage : sans catalogue
    // (contexte legacy) → undefined → couple historique câblé (byte-identique).
    let relations: RelationStructure[] | undefined
    if (creneauxProfil.length > 0) {
      const relationsRows = await chargerRelationsCreneau(supabase, cabinetId, profilId)
      relations = resoudreRelationsStructure(relationsRows, creneauxProfil)
    }
    const rolesParCode: Record<string, string[]> = {}
    for (const c of creneauxProfil) {
      if (c.code) rolesParCode[c.code] = c.roles
    }

    const { data: catalogue } = await supabase
      .from('creneaux_catalogue')
      .select('id, code')
    const creneauIdParCode = new Map<string, string>()
    for (const row of ((catalogue ?? []) as { id: string; code: string }[])) {
      creneauIdParCode.set(row.code, row.id)
    }

    // 3. Gardes V1 des jours demandés + week-ends du LENDEMAIN de chaque jour
    //    (leur vendredi dérivé atterrit dans la fenêtre à réécrire).
    const datesACharger = [
      ...new Set([...joursUniques, ...joursUniques.map((j) => addDaysISO(j, 1))]),
    ]
    const { data: gardesData, error: gardesErr } = await supabase
      .from('gardes')
      .select('id, date, type, premier_id, second_id')
      .eq('periode_id', periodeId)
      .eq('cabinet_id', cabinetId)
      .in('date', datesACharger)

    if (gardesErr) {
      return { ok: false, nbLignes: 0, erreur: `lecture gardes : ${gardesErr.message}` }
    }
    const gardes = (gardesData ?? []) as GardeRow[]

    // 3b. Miroir garde_placements des gardes SUR-MESURE (labels réels, places 3+).
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

    // 4. Lignes V2 attendues pour ces jours (reconstruction partagée).
    const ctx: ContexteLignesAttributions = {
      cabinetId,
      planningId: periodeId,
      snapshotId: periode.snapshot_id ?? null,
      structure,
      creneauIdParCode,
    }
    const rows = construireLignesPourJours(gardes, joursUniques, ctx, {
      rolesParCode,
      placementsParGarde,
      relations,
    })

    // 5. Réécriture PAR FENÊTRE-JOUR (Europe/Paris) : delete → insert.
    //    On borne par date_debut_reel ∈ [J 00:00, J+1 00:00) — toute ligne V2
    //    d'un créneau démarre le jour calendaire de sa garde (cf. calculerHoraires).
    for (const jour of joursUniques) {
      const { error: delErr } = await supabase
        .from('attributions')
        .delete()
        .eq('planning_id', periodeId)
        .eq('cabinet_id', cabinetId)
        .gte('date_debut_reel', toUTCString(jour, '00:00'))
        .lt('date_debut_reel', toUTCString(addDaysISO(jour, 1), '00:00'))

      if (delErr) {
        return { ok: false, nbLignes: 0, erreur: `purge attributions du ${jour} : ${delErr.message}` }
      }
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('attributions').insert(rows)
      if (insErr) {
        return { ok: false, nbLignes: 0, erreur: `insertion attributions : ${insErr.message}` }
      }
    }

    return { ok: true, nbLignes: rows.length }
  } catch (e) {
    return { ok: false, nbLignes: 0, erreur: e instanceof Error ? e.message : String(e) }
  }
}
