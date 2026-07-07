// ============================================================
// GUARDVETO — persisterResultat
// ============================================================
// Convertit le planning produit par le solver en attributions V2
// et les insère en base (table `attributions`), puis prend un
// snapshot des règles actives (table `snapshots_regles` via RPC
// `prendre_snapshot`).
//
// Horaires appliqués (Europe/Paris) :
//   semaine_soir / vendredi_soir : début = 18h30, fin = +1j 08h30
//   weekend                      : début = 08h30 (samedi), fin = +2j 08h30
//   ferie                        : début = 08h30, fin = +1j 08h30
//
// Note de transition V1 → V2 :
//   - Cette fonction écrit dans `attributions` (table V2).
//   - La route continue d'écrire dans `gardes` (table V1) en
//     parallèle jusqu'à la fin de la migration F1-002.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { PlanningPartiel } from '@/engine/types'
import { chargerStructureProfilPeriode } from '@/data/chargerStructureCabinet'
import { construireLignesAttributions } from '@/data/attributionRows'

// ── Calcul des horodatages / conversion en lignes ────────────
// DÉPLACÉS dans src/data/attributionRows.ts (P6 verrou n°7, étape 3) :
// la conversion PlanningPartiel → lignes `attributions` est désormais
// PARTAGÉE avec la synchro post-mutation (syncAttributions), à
// l'identique — le test syncAttributions.test.ts fige l'équivalence
// avec l'implémentation historique de ce fichier.

// ── Chargement du catalogue de créneaux ─────────────────────

type CreneauCatalogueRow = { id: string; code: string }

async function chargerCreneauxCatalogue(): Promise<Map<string, string>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('creneaux_catalogue')
    .select('id, code')

  if (error || !data) return new Map()

  const map = new Map<string, string>()
  for (const row of data as CreneauCatalogueRow[]) {
    map.set(row.code, row.id)
  }
  return map
}

// ── API publique ─────────────────────────────────────────────

export interface PersistenceResultat {
  snapshotId: string
  nbAttributions: number
}

/**
 * persisterResultat — Convertit le planning du solver en attributions V2
 * et les insère en base (idempotent via ON CONFLICT DO NOTHING sur l'index
 * idx_attributions_garde_role).
 *
 * Ensuite, prend un snapshot des règles actives du cabinet pour
 * garantir la traçabilité de la génération (F8-001).
 *
 * @param planning    Planning produit par genererPlanningPur()
 * @param periodeId   UUID de la période (= planning_id dans attributions)
 * @param cabinetId   UUID du cabinet (lu depuis app_metadata — règle C1)
 * @throws            Si l'insertion ou le snapshot échoue
 */
export async function persisterResultat(
  planning: PlanningPartiel,
  periodeId: string,
  cabinetId: string
): Promise<PersistenceResultat> {
  const supabase = await createClient()

  // 1. Charger le catalogue de créneaux (pour résoudre creneau_id)
  const creneauMap = await chargerCreneauxCatalogue()

  // 1b. Structure des créneaux résolue pour le PROFIL de la période (P5 slice 4b) :
  //     les horaires viennent du catalogue du profil (creneau_modele), plus de la
  //     surcharge cabinet. Profil défaut = horaires par défaut → byte-identique.
  const structure = await chargerStructureProfilPeriode(supabase, periodeId)

  // 2. Prendre un snapshot des règles actives AVANT l'insertion
  //    (F8-002 : le snapshot_id doit être connu au moment de construire les lignes)
  const { data: snapshotId, error: snapshotErr } = await supabase.rpc('prendre_snapshot', {
    p_planning_id: periodeId,
    p_cabinet_id:  cabinetId,
  })

  if (snapshotErr || !snapshotId) {
    throw new Error(
      `Erreur snapshot des règles : ${snapshotErr?.message ?? 'snapshotId null'}`
    )
  }

  const snapshotIdStr = snapshotId as string

  // 3. Supprimer les attributions existantes de cette période (régénération)
  const { error: deleteErr } = await supabase
    .from('attributions')
    .delete()
    .eq('planning_id', periodeId)
    .eq('cabinet_id', cabinetId)

  if (deleteErr) {
    throw new Error(`Erreur suppression des attributions existantes : ${deleteErr.message}`)
  }

  // 4. Construire les lignes à insérer
  //    Une ligne par (attribution × rôle occupé), avec snapshot_id (F8-002).
  //    Constructeur PUR PARTAGÉ avec la synchro post-mutation (attributionRows).
  const rows = construireLignesAttributions(planning, {
    cabinetId,
    planningId: periodeId,
    snapshotId: snapshotIdStr,
    structure,
    creneauIdParCode: creneauMap,
  })

  // 5. Insérer en bloc (idempotent via index unique idx_attributions_garde_role)
  if (rows.length > 0) {
    const { error: insertErr } = await supabase
      .from('attributions')
      .insert(rows)

    if (insertErr) {
      throw new Error(`Erreur insertion des attributions : ${insertErr.message}`)
    }
  }

  // 6. Lier la période à son snapshot (F8-002 : periodes.snapshot_id)
  const { error: updatePeriodeErr } = await supabase
    .from('periodes')
    .update({ snapshot_id: snapshotIdStr })
    .eq('id', periodeId)

  if (updatePeriodeErr) {
    throw new Error(
      `Erreur mise à jour periodes.snapshot_id : ${updatePeriodeErr.message}`
    )
  }

  return {
    snapshotId: snapshotIdStr,
    nbAttributions: rows.length,
  }
}
